'use strict';
/* BATCAVE OS // 内嵌应用更新：GitHub / GitCode 发布包 + SHA-256 + 数据保留 + 回滚 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const embedded = require('./embedded');
const { openAllowed, extractZip, compareVersions, parseVersion } = require('./update');

const MAX_ARCHIVE = 256 * 1024 * 1024;
const MAX_EXTRACT_FILE = 256 * 1024 * 1024;
const MAX_EXTRACT_TOTAL = 1024 * 1024 * 1024;
const FORBIDDEN = new Set(['.tsowner', 'owner.pin', 'auth.json', 'system.db']);
const ALLOWED_HOSTS = new Set([
  'api.github.com', 'github.com', 'objects.githubusercontent.com',
  'release-assets.githubusercontent.com', 'raw.githubusercontent.com',
  'api.gitcode.com', 'gitcode.com', 'file-cdn.gitcode.com', 'file.gitcode.com', 'raw.gitcode.com'
]);

const APPS = {
  tensaint: {
    id: 'tensaint',
    name: 'TenSaint73OS',
    github: 'IAMMEZSH/TenSaint73OS',
    gitcode: 'gcw_So3EkhfR/TenSaint73OS',
    asset: /^TenSaint73OS-Windows-x64\.zip$/i,
    packageName: 'tensaint73os',
    preserve: ['data', 'node_modules']
  },
  reading: {
    id: 'reading',
    name: '环球报阁',
    github: 'IAMMEZSH/global-reading-room',
    gitcode: 'gcw_So3EkhfR/global-reading-room',
    asset: /^global-reading-room-[\d.]+-windows-x64\.zip$/i,
    packageName: 'global-reading-room',
    preserve: ['data', 'runtime', 'node_modules']
  },
  codeforge: {
    id: 'codeforge',
    name: 'CodeForge AI',
    github: 'IAMMEZSH/CodeForge-AI',
    gitcode: 'gcw_So3EkhfR/CodeForge-AI',
    asset: /^CodeForge-AI-[\d.]+-windows-x64\.zip$/i,
    packageName: '',
    preserve: ['data', 'config.json', 'models', 'memory', 'workspace', 'logs', 'runtime', '.git', 'native/toolchains']
  }
};

let DATA_DIR = '';
let jobs = new Map();
const checkCache = new Map();

function init(dataDir) {
  DATA_DIR = dataDir || DATA_DIR;
}

function stateDir() {
  return path.join(DATA_DIR || path.join(__dirname, '..', 'data'), 'updates', 'apps');
}

function normalizeSource(source) {
  const s = String(source || '').toLowerCase();
  if (s !== 'github' && s !== 'gitcode') throw Object.assign(new Error('unknown update source'), { status: 400 });
  return s;
}

function appOf(id) {
  const app = APPS[String(id || '')];
  if (!app) throw Object.assign(new Error('unknown app'), { status: 400 });
  return app;
}

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function inside(base, target) {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function safeJoin(base, rel) {
  const clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = clean.split('/');
  if (!clean || parts.some(p => !p || p === '..') || /^[A-Za-z]:/.test(clean)) throw new Error('unsafe update path: ' + rel);
  const out = path.resolve(base, ...parts);
  if (!inside(base, out) || path.resolve(base) === out) throw new Error('update path escapes target: ' + rel);
  return out;
}

function isPreserved(rel, app) {
  const clean = String(rel).replace(/\\/g, '/');
  for (const p of app.preserve) {
    if (clean === p || clean.startsWith(p + '/')) return true;
  }
  return false;
}

function isForbidden(rel) {
  return FORBIDDEN.has(path.basename(String(rel)).toLowerCase());
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch { return fallback; }
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

async function walk(dir, rel = '') {
  const out = [];
  const list = await fsp.readdir(dir, { withFileTypes: true });
  for (const ent of list) {
    const r = rel ? rel + '/' + ent.name : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) throw new Error('更新包包含符号链接: ' + r);
    if (ent.isDirectory()) out.push(...await walk(full, r));
    else if (ent.isFile()) out.push({ rel: r, full, size: (await fsp.stat(full)).size });
  }
  return out;
}

function versionFromTag(tag) {
  const v = String(tag || '').trim().replace(/^v/i, '');
  return parseVersion(v) ? v : '';
}

function cacheKey(app, source) { return app.id + ':' + source; }

async function fetchJson(url) {
  const { res } = await openAllowed(url, ALLOWED_HOSTS, 20000);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' · ' + url);
  const text = await res.text();
  if (text.length > 4 * 1024 * 1024) throw new Error('发布信息过大');
  try { return JSON.parse(text); }
  catch { throw new Error('发布信息不是 JSON'); }
}

function normalizeAsset(raw, source) {
  if (!raw || !raw.name) return null;
  const size = Number(raw.size || raw.file_size || 0);
  const digest = String(raw.digest || raw.sha256 || '').replace(/^sha256:/i, '').toLowerCase();
  const url = source === 'github'
    ? (raw.browser_download_url || raw.url)
    : (raw.url || raw.browser_download_url || raw.download_url);
  return {
    name: String(raw.name),
    size: Number.isFinite(size) ? size : 0,
    sha256: /^[a-f0-9]{64}$/.test(digest) ? digest : '',
    url: url ? String(url) : ''
  };
}

async function downloadBuffer(url, sha256, maxBytes) {
  const { res } = await openAllowed(url, ALLOWED_HOSTS, 15000);
  if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('文件超过大小限制');
    chunks.push(Buffer.from(chunk));
  }
  const buf = Buffer.concat(chunks);
  if (sha256) {
    const got = crypto.createHash('sha256').update(buf).digest('hex');
    if (got !== sha256) throw new Error('SHA-256 校验失败: ' + url);
  }
  return buf;
}

async function assetDigest(release, asset, source) {
  if (asset.sha256) return asset.sha256;
  const sums = (release.assets || []).map(a => normalizeAsset(a, source)).find(a => a && /^SHA256SUMS\.txt$/i.test(a.name));
  if (!sums) throw new Error('发布包没有 SHA-256，且未找到 SHA256SUMS.txt');
  const buf = await downloadBuffer(sums.url, sums.sha256, 256 * 1024);
  const base = path.posix.basename(asset.url.split('?')[0]);
  for (const line of buf.toString('utf8').split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line.trim());
    if (!m) continue;
    const name = m[2].split(/[\\/]/).pop();
    if (name === asset.name || name === base) return m[1].toLowerCase();
  }
  throw new Error('SHA256SUMS.txt 中没有 ' + asset.name);
}

async function releaseInfo(app, source) {
  const key = cacheKey(app, source);
  const cached = checkCache.get(key);
  if (cached && Date.now() - cached.at < 60000) return cached.release;

  const repo = source === 'github' ? app.github : app.gitcode;
  const api = source === 'github'
    ? 'https://api.github.com/repos/' + repo + '/releases/latest'
    : 'https://api.gitcode.com/api/v5/repos/' + repo + '/releases/latest';
  const data = await fetchJson(api);
  const latest = versionFromTag(data.tag_name);
  if (!latest) throw new Error('无法识别发布版本: ' + (data.tag_name || '—'));
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const raw = assets.find(a => app.asset.test(String(a.name || '')) && Number(a.size || a.file_size || 0) > 0);
  if (!raw) throw new Error('发布中没有 Windows x64 更新包');
  const asset = normalizeAsset(raw, source);
  if (!asset.url) throw new Error('更新包缺少下载地址');
  if (!asset.size || asset.size > MAX_ARCHIVE) throw new Error('更新包大小异常: ' + asset.size);
  asset.sha256 = await assetDigest(data, asset, source);
  const releaseUrl = data.html_url || data.web_url || (source === 'github'
    ? 'https://github.com/' + app.github + '/releases/tag/' + encodeURIComponent(data.tag_name)
    : 'https://gitcode.com/' + app.gitcode + '/releases/' + encodeURIComponent(data.tag_name));
  const release = {
    source,
    latest,
    tag: String(data.tag_name || ''),
    title: String(data.name || (app.name + ' v' + latest)),
    notes: String(data.body || '').slice(0, 20000),
    published: String(data.published_at || data.created_at || ''),
    releaseUrl: String(releaseUrl),
    asset
  };
  checkCache.set(key, { at: Date.now(), release });
  return release;
}

async function currentVersion(app) {
  return String(await embedded.appVersion(app.id, DATA_DIR) || '');
}

async function check(appId, source) {
  const app = appOf(appId);
  const src = normalizeSource(source);
  const release = await releaseInfo(app, src);
  const current = await currentVersion(app);
  return {
    ok: true,
    app: app.id,
    appName: app.name,
    source: src,
    current,
    latest: release.latest,
    title: release.title,
    notes: release.notes,
    published: release.published,
    releaseUrl: release.releaseUrl,
    asset: { name: release.asset.name, size: release.asset.size, sha256: release.asset.sha256 },
    updateAvailable: compareVersions(release.latest, current) > 0
  };
}

function setJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

async function download(asset, file, job) {
  const { res } = await openAllowed(asset.url, ALLOWED_HOSTS, 10 * 60 * 1000);
  if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
  const fh = await fsp.open(file, 'w');
  const hash = crypto.createHash('sha256');
  let received = 0;
  try {
    for await (const chunk of res.body) {
      received += chunk.length;
      if (received > MAX_ARCHIVE) throw new Error('更新包超过大小限制');
      hash.update(chunk);
      await fh.write(chunk);
      setJob(job, {
        phase: 'downloading',
        percent: 3 + Math.min(62, (received / asset.size) * 62),
        received,
        total: asset.size,
        message: '下载中 ' + (received / 1048576).toFixed(1) + ' / ' + (asset.size / 1048576).toFixed(1) + ' MiB'
      });
    }
  } finally { await fh.close(); }
  const sha = hash.digest('hex');
  if (received !== asset.size) throw new Error('更新包大小不一致: ' + received + ' != ' + asset.size);
  if (sha !== asset.sha256) throw new Error('SHA-256 校验失败');
}

async function findPayloadRoot(staging, app) {
  const candidates = [staging];
  const level1 = await fsp.readdir(staging, { withFileTypes: true });
  for (const a of level1) {
    if (!a.isDirectory()) continue;
    const p1 = path.join(staging, a.name);
    candidates.push(p1);
    const level2 = await fsp.readdir(p1, { withFileTypes: true }).catch(() => []);
    for (const b of level2) if (b.isDirectory()) candidates.push(path.join(p1, b.name));
  }
  for (const dir of candidates) {
    if (app.id === 'codeforge') {
      if (fileExists(path.join(dir, 'server-java', 'build', 'CodeForgeServer.jar'))) return dir;
      continue;
    }
    if (!fileExists(path.join(dir, 'server.js'))) continue;
    const pkg = await readJson(path.join(dir, 'package.json'), {});
    if (!app.packageName || String(pkg.name || '').toLowerCase() === app.packageName) return dir;
  }
  throw new Error('更新包中没有找到 ' + app.name + ' 程序目录');
}

async function validatePayload(root, app, latest) {
  const files = await walk(root);
  if (!files.length) throw new Error('更新包为空');
  const usable = [];
  const skipped = [];
  for (const f of files) {
    if (isForbidden(f.rel)) { skipped.push(f.rel); continue; }
    if (f.size > MAX_EXTRACT_FILE) throw new Error('更新包文件过大: ' + f.rel);
    usable.push(f);
  }
  if (!usable.length) throw new Error('更新包没有可用文件');
  if (app.id === 'codeforge') {
    if (!fileExists(path.join(root, 'server-java', 'build', 'CodeForgeServer.jar'))) throw new Error('更新包缺少 CodeForgeServer.jar');
    if (!fileExists(path.join(root, 'server-java', 'web', 'console', 'index.html'))) throw new Error('更新包缺少控制台页面');
  } else {
    if (!fileExists(path.join(root, 'server.js'))) throw new Error('更新包缺少 server.js');
    const pkg = await readJson(path.join(root, 'package.json'), null);
    if (!pkg || String(pkg.version) !== String(latest)) {
      throw new Error('更新包版本不匹配: ' + (pkg && pkg.version || '—') + ' != ' + latest);
    }
  }
  return { files: usable, skipped };
}

async function overlay(payloadRoot, targetRoot, app, backupDir, files, job) {
  const tracked = [];
  let done = 0;
  for (const f of files) {
    if (isPreserved(f.rel, app) || isForbidden(f.rel)) continue;
    const target = safeJoin(targetRoot, f.rel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    let existed = false;
    try {
      const st = await fsp.lstat(target);
      if (st.isDirectory()) throw new Error('目标路径是目录，无法覆盖: ' + f.rel);
      existed = true;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (existed) {
      const backup = safeJoin(backupDir, f.rel);
      await fsp.mkdir(path.dirname(backup), { recursive: true });
      await fsp.copyFile(target, backup);
    }
    await fsp.copyFile(f.full, target);
    tracked.push({ rel: f.rel, existed });
    done++;
    if (done % 20 === 0) setJob(job, { percent: 78 + Math.min(10, (done / files.length) * 10), message: '替换程序文件 ' + done + ' / ' + files.length });
  }
  return tracked;
}

async function rollbackFiles(tracked, backupDir, targetRoot) {
  for (const f of tracked.slice().reverse()) {
    const target = safeJoin(targetRoot, f.rel);
    try {
      if (f.existed) await fsp.copyFile(safeJoin(backupDir, f.rel), target);
      else await fsp.rm(target, { force: true });
    } catch { }
  }
}

async function loadState() {
  return await readJson(path.join(stateDir(), 'state.json'), {}) || {};
}

async function history() {
  const h = await readJson(path.join(stateDir(), 'history.json'), []);
  return Array.isArray(h) ? h : [];
}

async function record(app, release, previous) {
  const state = await loadState();
  const entry = {
    version: release.latest,
    source: release.source,
    installedAt: new Date().toISOString(),
    previousVersion: previous,
    root: embedded.resolveAppRoot(app.id, DATA_DIR)
  };
  state[app.id] = entry;
  await writeJson(path.join(stateDir(), 'state.json'), state);
  const h = await history();
  h.unshift(Object.assign({ app: app.id, appName: app.name }, entry));
  await writeJson(path.join(stateDir(), 'history.json'), h.slice(0, 40));
  return entry;
}

async function runApply(job, app, source, expectedVersion) {
  let zip = '';
  let staging = '';
  let target = '';
  let backup = '';
  let tracked = [];
  let stopped = false;
  try {
    setJob(job, { phase: 'checking', percent: 1, message: '读取 ' + (source === 'github' ? 'GitHub' : 'GitCode') + ' 发布信息' });
    const release = await releaseInfo(app, source);
    if (expectedVersion && String(expectedVersion) !== String(release.latest)) throw new Error('发布版本已变化，请重新检查更新');
    const current = await currentVersion(app);
    if (compareVersions(release.latest, current) <= 0) throw new Error('当前已是最新版本 v' + current);
    setJob(job, { version: release.latest, source, total: release.asset.size, message: '准备更新 ' + app.name + ' → v' + release.latest });

    target = embedded.resolveAppRoot(app.id, DATA_DIR);
    if (!target || !fs.existsSync(target)) throw new Error('应用尚未初始化，请先启动一次再更新');

    zip = path.join(stateDir(), 'download-' + app.id + '-' + release.latest + '-' + job.id + '.zip');
    await fsp.mkdir(stateDir(), { recursive: true });
    setJob(job, { phase: 'downloading', percent: 3, message: '下载 ' + release.asset.name });
    await download(release.asset, zip, job);

    setJob(job, { phase: 'verifying', percent: 67, message: 'SHA-256 已校验' });
    staging = path.join(stateDir(), 'staging-' + app.id + '-' + release.latest + '-' + job.id);
    await fsp.rm(staging, { recursive: true, force: true });
    setJob(job, { phase: 'extracting', percent: 70, message: '解压更新包' });
    await extractZip(zip, staging, (done, total) => {
      setJob(job, { percent: 70 + Math.min(8, (done / Math.max(1, total)) * 8), message: '解压 ' + done + ' / ' + total + ' 个文件' });
    }, { maxFileSize: MAX_EXTRACT_FILE, maxUncompressed: MAX_EXTRACT_TOTAL });

    setJob(job, { phase: 'validating', percent: 80, message: '校验新版本结构' });
    const payload = await findPayloadRoot(staging, app);
    const validation = await validatePayload(payload, app, release.latest);
    if (validation.skipped.length) {
      setJob(job, { skipped: validation.skipped, message: '已跳过凭据类文件 ' + validation.skipped.length + ' 个（不会写入本机）' });
    }

    const list = await embedded.list(DATA_DIR);
    const item = (list.apps || []).find(a => a.id === app.id);
    if (item && item.running && !item.managed) throw new Error('应用由 BATCAVE 之外的进程运行，请先关闭后再更新');
    setJob(job, { phase: 'applying', percent: 82, message: '停止应用并备份当前版本' });
    await embedded.stop(app.id);
    stopped = true;
    await new Promise(r => setTimeout(r, 350));

    backup = path.join(stateDir(), 'backup-' + app.id + '-' + release.latest + '-' + job.id);
    await fsp.rm(backup, { recursive: true, force: true });
    await fsp.mkdir(backup, { recursive: true });
    setJob(job, { phase: 'applying', percent: 84, message: '替换程序文件（保留用户数据）' });
    tracked = await overlay(payload, target, app, backup, validation.files, job);

    setJob(job, { phase: 'applying', percent: 92, message: '启动新版本并验证' });
    const started = await embedded.start(app.id, DATA_DIR);
    stopped = false;
    if (!started.ok) throw new Error('新版本启动失败: ' + (started.error || '未知错误') + (started.log ? '\n' + started.log : ''));
    const after = await currentVersion(app);
    if (after && compareVersions(after, release.latest) !== 0) throw new Error('新版本版本号异常: ' + after + ' != ' + release.latest);

    const installed = await record(app, release, current);
    setJob(job, { phase: 'done', percent: 100, message: app.name + ' 已更新到 v' + release.latest, installed });
    try { await fsp.rm(zip, { force: true }); } catch { }
    try { await fsp.rm(staging, { recursive: true, force: true }); } catch { }
  } catch (e) {
    if (tracked.length) {
      setJob(job, { phase: 'applying', percent: 90, message: '更新失败，正在回滚' });
      await rollbackFiles(tracked, backup, target);
    }
    if (stopped) {
      const again = await embedded.start(app.id, DATA_DIR).catch(() => ({ ok: false, error: 'restart failed' }));
      if (!again.ok) setJob(job, { restartFailed: true });
    }
    setJob(job, { phase: 'error', percent: 0, error: e.message || String(e), message: '更新失败：' + (e.message || e) });
    try { if (zip) await fsp.rm(zip, { force: true }); } catch { }
    try { if (staging) await fsp.rm(staging, { recursive: true, force: true }); } catch { }
  }
}

function startApply(appId, source, version) {
  const app = appOf(appId);
  const src = normalizeSource(source);
  for (const job of jobs.values()) {
    if (['checking', 'downloading', 'verifying', 'extracting', 'validating', 'applying'].includes(job.phase)) {
      throw Object.assign(new Error('已有应用更新正在进行'), { status: 409 });
    }
  }
  const job = {
    id: Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex'),
    app: app.id,
    appName: app.name,
    source: src,
    version: String(version || ''),
    phase: 'checking',
    percent: 0,
    message: '排队中',
    total: 0,
    received: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: ''
  };
  jobs.set(job.id, job);
  runApply(job, app, src, version).catch(() => { });
  return { ok: true, jobId: job.id };
}

function getJob(id) {
  const job = jobs.get(String(id || ''));
  return job ? Object.assign({}, job) : null;
}

async function status(appId) {
  const app = appOf(appId);
  const state = await loadState();
  return {
    ok: true,
    app: app.id,
    appName: app.name,
    current: await currentVersion(app),
    root: embedded.resolveAppRoot(app.id, DATA_DIR),
    installed: state[app.id] || null,
    history: (await history()).filter(h => h.app === app.id).slice(0, 8)
  };
}

module.exports = { init, check, startApply, getJob, status, APPS };
