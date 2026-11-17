'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { URL } = require('url');

const MAX_ARCHIVE = 256 * 1024 * 1024;
const MAX_UNCOMPRESSED = 1024 * 1024 * 1024;
const MAX_FILES = 20000;
const MAX_FILE_SIZE = 64 * 1024 * 1024;
const ALLOWED_ENTRIES = new Set(['server.js', 'bin', 'lib', 'public', 'embedded', 'docs', 'update', 'README.md', 'CHANGELOG.md', 'LICENSE', 'version.json', 'package.json', 'start-batcave.cmd', 'start-batcave.vbs']);
const FORBIDDEN_NAMES = new Set(['.tsowner', 'OWNER.pin', 'auth.json', 'system.db']);
const DEFAULT_ALLOWED_HOSTS = [
  'raw.githubusercontent.com',
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'raw.gitcode.com',
  'gitcode.com',
  'api.gitcode.com',
  'file-cdn.gitcode.com',
  'file.gitcode.com'
];

let cfg = null;
let stateDir = null;
let job = null;
let lastCheck = null;

function configure(options) {
  cfg = Object.assign({}, options);
  stateDir = path.join(cfg.dataDir, 'updates');
}

function loadSources() {
  const file = path.join(cfg.root, 'update', 'sources.json');
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error('update/sources.json unreadable: ' + e.message); }
  if (!parsed || !parsed.sources || !parsed.sources.github || !parsed.sources.gitcode) {
    throw new Error('update/sources.json missing github/gitcode sources');
  }
  const allowed = new Set(DEFAULT_ALLOWED_HOSTS);
  for (const h of (parsed.allowedHosts || [])) allowed.add(String(h).toLowerCase());
  return { sources: parsed.sources, allowedHosts: allowed };
}

function normalizeSource(source) {
  const s = String(source || '').toLowerCase();
  if (s !== 'github' && s !== 'gitcode') throw Object.assign(new Error('unknown update source'), { status: 400 });
  return s;
}

function otherSource(source) {
  return source === 'github' ? 'gitcode' : 'github';
}

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

function inside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function safeChild(base, rel) {
  const clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.includes('\0')) throw new Error('bad zip entry name');
  if (/^[A-Za-z]:/.test(clean)) throw new Error('absolute zip entry: ' + rel);
  const parts = clean.split('/');
  if (parts.some(p => p === '..' || p === '')) throw new Error('unsafe zip entry: ' + rel);
  const out = path.resolve(base, ...parts);
  if (!inside(path.resolve(base), out) || path.resolve(base) === out) throw new Error('zip entry escapes destination: ' + rel);
  return out;
}

function hostAllowed(url, allowedHosts) {
  const u = url instanceof URL ? url : new URL(url);
  if (u.protocol !== 'https:') return false;
  return allowedHosts.has(u.hostname.toLowerCase());
}

async function openAllowed(rawUrl, allowedHosts, timeoutMs = 30000, signal) {
  let current = new URL(rawUrl);
  for (let i = 0; i < 6; i++) {
    if (!hostAllowed(current, allowedHosts)) throw new Error('update host not allowed: ' + current.hostname);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'BATCAVE-OS/' + (cfg ? cfg.version : 'unknown'), 'accept': '*/*' }
      });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('redirect without location');
      current = new URL(loc, current);
      continue;
    }
    return { res, url: current };
  }
  throw new Error('too many redirects');
}

function validateAsset(asset, key, allowedHosts) {
  if (!asset || typeof asset !== 'object') throw new Error('manifest asset missing: ' + key);
  if (typeof asset.url !== 'string') throw new Error('manifest asset url missing: ' + key);
  let u;
  try { u = new URL(asset.url); } catch { throw new Error('invalid asset url: ' + key); }
  if (!hostAllowed(u, allowedHosts)) throw new Error('asset host not allowed: ' + u.hostname);
  if (!/^[a-f0-9]{64}$/i.test(String(asset.sha256 || ''))) throw new Error('asset sha256 invalid: ' + key);
  const size = Number(asset.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_ARCHIVE) throw new Error('asset size invalid: ' + key);
  return { url: u.toString(), sha256: String(asset.sha256).toLowerCase(), size };
}

function validateManifest(m, allowedHosts) {
  if (!m || typeof m !== 'object') throw new Error('manifest is not an object');
  if (!parseVersion(m.version)) throw new Error('manifest version invalid');
  if (!m.assets || typeof m.assets !== 'object') throw new Error('manifest assets missing');
  const out = { assets: {} };
  for (const key of ['github', 'gitcode']) {
    if (m.assets[key]) out.assets[key] = validateAsset(m.assets[key], key, allowedHosts);
  }
  if (!out.assets.github && !out.assets.gitcode) throw new Error('manifest has no usable asset');
  return {
    schema: Number(m.schema || 1),
    version: m.version,
    codename: String(m.codename || '').slice(0, 64),
    released: String(m.released || '').slice(0, 64),
    notes: String(m.notes || '').slice(0, 30000),
    notesUrl: String(m.notesUrl || '').slice(0, 500),
    notesUrls: m.notesUrls && typeof m.notesUrls === 'object' ? m.notesUrls : {},
    assets: out.assets
  };
}

function parseManifestText(text) {
  let data = JSON.parse(text);
  if (data && data.encoding === 'base64' && typeof data.content === 'string') {
    data = JSON.parse(Buffer.from(data.content.replace(/\s+/g, ''), 'base64').toString('utf8'));
  }
  return data;
}

async function loadManifestUrl(raw, allowedHosts) {
  const { res } = await openAllowed(raw, allowedHosts, 8000);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 128 * 1024) throw new Error('manifest too large');
  let data;
  try { data = parseManifestText(buf.toString('utf8')); }
  catch { throw new Error('manifest is not JSON'); }
  return validateManifest(data, allowedHosts);
}

async function loadManifest(source, allowedHosts) {
  const src = (loadSources()).sources[source];
  const urls = [];
  if (Array.isArray(src.manifests)) urls.push(...src.manifests);
  if (src.manifest) urls.push(src.manifest);
  if (!urls.length) throw new Error('no manifest URL for ' + source);
  const results = await Promise.allSettled(urls.map(raw => loadManifestUrl(raw, allowedHosts)));
  for (const r of results) if (r.status === 'fulfilled') return r.value;
  const errors = results.map((r, i) => urls[i] + ': ' + (r.reason && r.reason.message || r.reason));
  throw new Error('manifest unavailable (' + source + '): ' + errors.join(' | '));
}

async function check(source) {
  if (!cfg) throw new Error('update module not configured');
  const requested = normalizeSource(source);
  const loaded = loadSources();
  const order = [requested, otherSource(requested)];
  const errors = [];
  for (const key of order) {
    try {
      const m = await loadManifest(key, loaded.allowedHosts);
      const asset = m.assets[key] || m.assets[otherSource(key)];
      lastCheck = { at: new Date().toISOString(), source: key, version: m.version, ok: true };
      return {
        ok: true,
        source: key,
        requestedSource: requested,
        fallback: key !== requested,
        current: cfg.version,
        codename: cfg.codename,
        latest: m.version,
        latestCodename: m.codename,
        released: m.released,
        notes: m.notes,
        notesUrl: (m.notesUrls && m.notesUrls[key]) || m.notesUrl || '',
        size: asset ? asset.size : 0,
        updateAvailable: compareVersions(m.version, cfg.version) > 0,
        checkedAt: lastCheck.at
      };
    } catch (e) { errors.push(key + ': ' + e.message); }
  }
  lastCheck = { at: new Date().toISOString(), source: requested, ok: false, error: errors.join(' | ') };
  throw new Error('update check failed: ' + errors.join(' | '));
}

function crc32Table() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crc32Table();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function extractZip(zipPath, destDir, onProgress, options = {}) {
  const maxFileSize = Number(options.maxFileSize) || MAX_FILE_SIZE;
  const maxUncompressed = Number(options.maxUncompressed) || MAX_UNCOMPRESSED;
  const keep = typeof options.filter === 'function' ? options.filter : null;
  const buf = await fsp.readFile(zipPath);
  if (buf.length < 22) throw new Error('zip is too small');
  let eocd = -1;
  const start = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip end-of-central-directory not found');
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) throw new Error('zip64 is not supported');
  if (entries > MAX_FILES) throw new Error('zip has too many entries');
  if (cdOffset + cdSize > buf.length) throw new Error('zip central directory out of range');
  await fsp.mkdir(destDir, { recursive: true });
  let pos = cdOffset;
  let files = 0;
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('bad zip central directory');
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const expectedCrc = buf.readUInt32LE(pos + 16);
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const externalAttrs = buf.readUInt32LE(pos + 38);
    const localOffset = buf.readUInt32LE(pos + 42);
    const nameBuf = buf.subarray(pos + 46, pos + 46 + nameLen);
    const name = nameBuf.toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error('encrypted zip entry: ' + name);
    if (compSize === 0xFFFFFFFF || uncompSize === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) throw new Error('zip64 entry is not supported');
    if (((externalAttrs >>> 16) & 0xF000) === 0xA000) throw new Error('zip symlink is not allowed: ' + name);
    const cleanName = name.replace(/\\/g, '/');
    if (keep && !keep(cleanName)) continue;
    if (cleanName.endsWith('/')) {
      await fsp.mkdir(safeChild(destDir, cleanName.replace(/\/+$/, '')), { recursive: true });
      continue;
    }
    if (!cleanName) throw new Error('empty zip entry name');
    const target = safeChild(destDir, cleanName);
    if (uncompSize > maxFileSize) throw new Error('zip entry too large: ' + name);
    total += uncompSize;
    if (total > maxUncompressed) throw new Error('zip expands beyond limit');
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('bad zip local header: ' + name);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > buf.length) throw new Error('zip entry data out of range: ' + name);
    const comp = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = Buffer.from(comp);
    else if (method === 8) data = zlib.inflateRawSync(comp, { maxOutputLength: maxFileSize });
    else throw new Error('unsupported zip compression method ' + method + ': ' + name);
    if (data.length !== uncompSize) throw new Error('zip entry size mismatch: ' + name);
    if (crc32(data) !== expectedCrc) throw new Error('zip entry crc mismatch: ' + name);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data, { mode: 0o644 });
    files++;
    if (onProgress && (files % 25 === 0 || files === entries)) onProgress(files, entries, total);
  }
  return { files, bytes: total };
}

async function walk(dir, rel = '') {
  const out = [];
  const list = await fsp.readdir(dir, { withFileTypes: true });
  for (const ent of list) {
    const r = rel ? rel + '/' + ent.name : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) throw new Error('symlink in update payload: ' + r);
    if (ent.isDirectory()) out.push(...await walk(full, r));
    else if (ent.isFile()) out.push({ rel: r, full, size: (await fsp.stat(full)).size });
  }
  return out;
}

async function validateStaging(staging, manifestVersion) {
  for (const required of ['server.js', 'version.json', 'lib/update.js', 'public/index.html', 'public/js/apps-update.js', 'update/sources.json']) {
    const p = safeChild(staging, required);
    let st;
    try { st = await fsp.stat(p); } catch { throw new Error('update payload missing ' + required); }
    if (!st.isFile() || st.size < 16) throw new Error('update payload file invalid: ' + required);
  }
  let vj;
  try { vj = JSON.parse(await fsp.readFile(safeChild(staging, 'version.json'), 'utf8')); }
  catch { throw new Error('update payload version.json is invalid'); }
  if (String(vj.version) !== String(manifestVersion)) throw new Error('update payload version mismatch: ' + vj.version + ' != ' + manifestVersion);
  const files = await walk(staging);
  for (const f of files) {
    const base = path.basename(f.rel).toLowerCase();
    if (FORBIDDEN_NAMES.has(f.rel) || FORBIDDEN_NAMES.has(base)) throw new Error('update payload contains forbidden file: ' + f.rel);
    if (f.rel === 'node.exe' || f.rel.startsWith('data/') || f.rel.startsWith('iso/out/')) throw new Error('update payload contains forbidden path: ' + f.rel);
    if (f.size > MAX_FILE_SIZE) throw new Error('update payload file too large: ' + f.rel);
  }
  return files;
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch { return fallback; }
}

async function writeJson(file, obj) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

async function readHistory() {
  const h = await readJson(path.join(stateDir, 'history.json'), []);
  return Array.isArray(h) ? h : [];
}

async function writeHistory(entry) {
  const h = await readHistory();
  h.unshift(entry);
  await writeJson(path.join(stateDir, 'history.json'), h.slice(0, 30));
}

async function status() {
  const installed = await readJson(path.join(stateDir, 'installed.json'), null);
  const history = await readHistory();
  return {
    ok: true,
    current: cfg.version,
    codename: cfg.codename,
    root: cfg.root,
    stateDir,
    lastCheck,
    installed,
    restartRequired: !!(installed && installed.restartRequired),
    history
  };
}

async function recover() {
  const txFile = path.join(stateDir, 'transaction.json');
  const tx = await readJson(txFile, null);
  if (!tx) return null;
  if (tx.status === 'done') { await fsp.rm(txFile, { force: true }); return null; }
  const actions = [];
  for (const entry of (tx.entries || [])) {
    const current = path.join(cfg.root, entry);
    const rollback = path.join(tx.rollbackDir || '', entry);
    let hasCurrent = false, hasRollback = false;
    try { await fsp.access(current); hasCurrent = true; } catch {}
    try { await fsp.access(rollback); hasRollback = true; } catch {}
    if (!hasRollback) {
      if (hasCurrent && tx.status === 'applying') {
        await fsp.rm(current, { recursive: true, force: true });
        actions.push('removed-new:' + entry);
      }
      continue;
    }
    if (hasCurrent) {
      await fsp.rm(current, { recursive: true, force: true });
      actions.push('removed-new:' + entry);
    }
    await fsp.rename(rollback, current);
    actions.push('restored:' + entry);
  }
  await writeJson(path.join(stateDir, 'recovery.json'), { at: new Date().toISOString(), version: tx.version, actions });
  await fsp.rm(txFile, { force: true });
  return actions;
}

async function swapEntry(root, staging, rollbackDir, entry) {
  const current = path.join(root, entry);
  const staged = path.join(staging, entry);
  const backup = path.join(rollbackDir, entry);
  let currentStat = null, stagedStat = null;
  try { currentStat = await fsp.lstat(current); } catch {}
  try { stagedStat = await fsp.lstat(staged); } catch {}
  if (!stagedStat) return { entry, skipped: true };
  await fsp.mkdir(rollbackDir, { recursive: true });
  const stagedIsDir = stagedStat.isDirectory();
  const currentIsDir = !!(currentStat && currentStat.isDirectory());
  if (currentStat && currentIsDir !== stagedIsDir) {
    if (currentIsDir) await fsp.rename(current, backup);
    else { await fsp.copyFile(current, backup); await fsp.unlink(current); }
    currentStat = null;
  }
  if (currentStat) {
    if (stagedIsDir) {
      await fsp.rename(current, backup);
      try { await fsp.rename(staged, current); }
      catch (e) {
        await fsp.rename(backup, current).catch(() => {});
        throw e;
      }
    } else {
      await fsp.copyFile(current, backup);
      await fsp.copyFile(staged, current);
      await fsp.unlink(staged);
    }
    return { entry, mode: stagedIsDir ? 'dir' : 'file' };
  }
  if (stagedIsDir) await fsp.rename(staged, current);
  else {
    await fsp.mkdir(path.dirname(current), { recursive: true });
    await fsp.copyFile(staged, current);
    await fsp.unlink(staged);
  }
  return { entry, mode: 'new-' + (stagedIsDir ? 'dir' : 'file') };
}

async function applyStaging(staging, manifest, source, jobRef) {
  const version = manifest.version;
  const rollbackDir = path.join(stateDir, 'rollback-' + version + '-' + jobRef.id);
  const entries = [];
  for (const ent of await fsp.readdir(staging, { withFileTypes: true })) {
    if (ALLOWED_ENTRIES.has(ent.name)) entries.push(ent.name);
  }
  if (!entries.includes('server.js') || !entries.includes('version.json')) throw new Error('update payload is incomplete');
  const tx = {
    status: 'applying',
    version,
    source,
    entries,
    rollbackDir,
    stagingDir: staging,
    startedAt: new Date().toISOString(),
    pid: process.pid
  };
  await writeJson(path.join(stateDir, 'transaction.json'), tx);
  const done = [];
  try {
    for (const entry of entries) {
      await swapEntry(cfg.root, staging, rollbackDir, entry);
      done.push(entry);
      if (jobRef) {
        jobRef.percent = Math.min(99, 92 + Math.floor(done.length / entries.length * 5));
        jobRef.message = '已替换 ' + entry;
      }
    }
    tx.status = 'done';
    tx.finishedAt = new Date().toISOString();
    await writeJson(path.join(stateDir, 'transaction.json'), tx);
  } catch (e) {
    for (const entry of done.reverse()) {
      const current = path.join(cfg.root, entry);
      const backup = path.join(rollbackDir, entry);
      let st = null;
      try { st = await fsp.lstat(backup); } catch {}
      try {
        if (!st) {
          await fsp.rm(current, { recursive: true, force: true });
        } else if (st.isDirectory()) {
          await fsp.rm(current, { recursive: true, force: true });
          await fsp.rename(backup, current);
        } else {
          await fsp.copyFile(backup, current);
        }
      } catch {}
    }
    tx.status = 'failed';
    tx.error = e.message;
    tx.failedAt = new Date().toISOString();
    await writeJson(path.join(stateDir, 'transaction.json'), tx);
    throw e;
  }
  const previous = await readJson(path.join(stateDir, 'installed.json'), null);
  const installed = {
    version,
    codename: manifest.codename,
    source,
    installedAt: new Date().toISOString(),
    previousVersion: previous && previous.version ? previous.version : cfg.version,
    rollbackDir,
    restartRequired: true,
    notes: manifest.notes,
    notesUrl: manifest.notesUrl
  };
  await writeJson(path.join(stateDir, 'installed.json'), installed);
  await writeHistory({ version, codename: manifest.codename, source, installedAt: installed.installedAt, previousVersion: installed.previousVersion });
  return installed;
}

function setJob(patch) {
  if (!job) return;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

async function runApply(jobRef, requestedSource, expectedVersion, localZip) {
  try {
    setJob({ phase: 'checking', percent: 1, message: '读取更新清单' });
    const requested = normalizeSource(requestedSource);
    const loaded = loadSources();
    let manifest = null;
    let sourceUsed = requested;
    const errors = [];
    for (const key of [requested, otherSource(requested)]) {
      try { manifest = await loadManifest(key, loaded.allowedHosts); sourceUsed = key; break; }
      catch (e) { errors.push(key + ': ' + e.message); }
    }
    if (!manifest) throw new Error('manifest unavailable: ' + errors.join(' | '));
    if (expectedVersion && String(expectedVersion) !== String(manifest.version)) throw new Error('manifest version changed: ' + manifest.version);
    if (compareVersions(manifest.version, cfg.version) <= 0) throw new Error('already latest: ' + cfg.version);
    setJob({ version: manifest.version, source: sourceUsed, total: 0, message: '准备下载 ' + manifest.version });
    const asset = manifest.assets[requested] || manifest.assets[sourceUsed] || manifest.assets[otherSource(sourceUsed)];
    if (!asset) throw new Error('no asset for source ' + requested);
    setJob({ total: asset.size, phase: 'downloading', percent: 3, message: '下载 ' + manifest.version + ' · ' + sourceUsed });
    const zipPath = localZip || path.join(stateDir, 'download-' + manifest.version + '-' + jobRef.id + '.zip');
    let sha = asset.sha256;
    let received = 0;
    if (!localZip) {
      const { res } = await openAllowed(asset.url, loaded.allowedHosts, 10 * 60 * 1000);
      if (!res.ok) throw new Error('download HTTP ' + res.status);
      const len = Number(res.headers.get('content-length') || 0);
      if (len && len > MAX_ARCHIVE) throw new Error('download too large');
      const fh = await fsp.open(zipPath, 'w');
      const hash = crypto.createHash('sha256');
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || !value.length) continue;
          received += value.length;
          if (received > MAX_ARCHIVE) { try { await reader.cancel(); } catch {} throw new Error('download exceeded limit'); }
          hash.update(value);
          await fh.write(value);
          setJob({ received, percent: 3 + Math.min(65, (received / asset.size) * 65), message: '下载中 ' + (received / 1048576).toFixed(1) + ' / ' + (asset.size / 1048576).toFixed(1) + ' MiB' });
        }
      } finally { await fh.close(); }
      sha = hash.digest('hex');
    } else {
      const st = await fsp.stat(zipPath);
      received = st.size;
      const hash = crypto.createHash('sha256');
      hash.update(await fsp.readFile(zipPath));
      sha = hash.digest('hex');
      setJob({ total: st.size, received: st.size, percent: 68, message: '校验本地更新包' });
    }
    setJob({ phase: 'verifying', percent: 70, message: '校验 SHA-256' });
    if (received !== asset.size) throw new Error('size mismatch: ' + received + ' != ' + asset.size);
    if (sha.toLowerCase() !== asset.sha256.toLowerCase()) throw new Error('sha256 mismatch');
    setJob({ phase: 'extracting', percent: 72, message: '解压更新包' });
    const staging = path.join(stateDir, 'staging-' + manifest.version + '-' + jobRef.id);
    await fsp.rm(staging, { recursive: true, force: true });
    await extractZip(zipPath, staging, (files, totalFiles) => {
      setJob({ percent: 72 + Math.min(14, (files / totalFiles) * 14), message: '解压 ' + files + ' / ' + totalFiles + ' 个文件' });
    });
    setJob({ phase: 'validating', percent: 88, message: '校验新版本结构' });
    await validateStaging(staging, manifest.version);
    setJob({ phase: 'applying', percent: 91, message: '备份当前版本并替换文件' });
    const installed = await applyStaging(staging, manifest, sourceUsed, jobRef);
    setJob({ phase: 'done', percent: 100, message: '更新已安装，重启 BATCAVE 后生效', restartRequired: true, installed });
    try { await fsp.rm(zipPath, { force: true }); } catch {}
    try { await fsp.rm(staging, { recursive: true, force: true }); } catch {}
  } catch (e) {
    setJob({ phase: 'error', percent: 0, error: e.message || String(e), message: '更新失败：' + (e.message || e) });
    try { await writeJson(path.join(stateDir, 'last-error.json'), { at: new Date().toISOString(), error: e.message, version: jobRef.version || '', source: requestedSource }); } catch {}
  }
}

function startApply(source, version) {
  if (job && ['checking', 'downloading', 'verifying', 'extracting', 'validating', 'applying'].includes(job.phase)) {
    throw Object.assign(new Error('update already running'), { status: 409 });
  }
  job = {
    id: Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'),
    phase: 'checking',
    percent: 0,
    message: '排队中',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: '',
    source: '',
    total: 0,
    received: 0,
    restartRequired: false,
    error: ''
  };
  const ref = job;
  runApply(ref, source, version, null).catch(() => {});
  return { ok: true, jobId: ref.id };
}

function getJob(id) {
  if (!job) return null;
  if (id && String(id) !== job.id) return null;
  return Object.assign({}, job);
}

function restart() {
  const helper = path.join(__dirname, 'restart-helper.js');
  const args = [
    helper,
    process.execPath,
    cfg.serverPath,
    '--port', String(cfg.port),
    '--host', String(cfg.host),
    '--home', String(cfg.home),
    '--data', String(cfg.dataDir),
    '--no-open'
  ];
  if (cfg.allowLocalNet) args.push('--allow-local-net');
  if (cfg.allowDestructive) args.push('--allow-destructive');
  const env = Object.assign({}, process.env, { BATCAVE_TOKEN: cfg.token, BATCAVE_UPDATE_LOG: path.join(stateDir, 'restart.log') });
  setTimeout(() => {
    try {
      const child = spawn(process.execPath, args, { cwd: cfg.root, detached: true, stdio: 'ignore', env });
      child.unref();
      setTimeout(() => { try { process.exit(0); } catch {} }, 800);
    } catch (e) {
      try { fs.appendFileSync(path.join(stateDir, 'restart-error.log'), new Date().toISOString() + ' ' + e.message + '\n'); } catch {}
    }
  }, 250);
  return { ok: true, message: 'restarting', pid: process.pid };
}

async function init() {
  await fsp.mkdir(stateDir, { recursive: true });
  const recovered = await recover();
  const installed = await readJson(path.join(stateDir, 'installed.json'), null);
  if (installed && installed.restartRequired && String(installed.version) === String(cfg.version)) {
    installed.restartRequired = false;
    await writeJson(path.join(stateDir, 'installed.json'), installed);
  }
  return { recovered, installed };
}

async function applyLocalForTest(zipPath, manifest, source) {
  if (!job) job = { id: 'test-' + Date.now().toString(36), phase: 'idle', percent: 0, message: '', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: '', source: '', total: 0, received: 0, restartRequired: false, error: '' };
  const staging = path.join(stateDir, 'test-staging-' + job.id);
  await fsp.rm(staging, { recursive: true, force: true });
  await extractZip(zipPath, staging);
  await validateStaging(staging, manifest.version);
  const installed = await applyStaging(staging, manifest, source || 'test', job);
  await fsp.rm(staging, { recursive: true, force: true });
  return installed;
}

module.exports = {
  configure,
  init,
  status,
  check,
  startApply,
  getJob,
  restart,
  recover,
  openAllowed,
  extractZip,
  safeChild,
  parseVersion,
  compareVersions,
  _test: { extractZip, validateStaging, applyStaging, applyLocalForTest, compareVersions, crc32, safeChild, validateManifest, parseManifestText, setStateDir: (d) => { stateDir = d; } }
};
