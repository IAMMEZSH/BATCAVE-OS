'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ENTRIES = ['server.js', 'bin', 'lib', 'public', 'embedded', 'docs', 'update', 'README.md', 'CHANGELOG.md', 'LICENSE', 'version.json', 'package.json', 'start-batcave.cmd', 'start-batcave.vbs'];
const SKIP_NAMES = new Set(['.git', 'node_modules', 'data', 'dist', 'iso', 'test', 'tools', 'Thumbs.db', '.DS_Store', 'server.out.log', 'server.err.log']);

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function collect(rel, out) {
  if (rel === 'update') {
    const file = path.join(ROOT, 'update', 'sources.json');
    if (fs.existsSync(file)) out.push({ rel: 'update/sources.json', file, data: await fsp.readFile(file) });
    return;
  }
  const full = path.join(ROOT, rel);
  let st;
  try { st = await fsp.lstat(full); } catch { return; }
  if (st.isSymbolicLink()) throw new Error('symlink not allowed: ' + rel);
  if (st.isDirectory()) {
    for (const ent of await fsp.readdir(full, { withFileTypes: true })) {
      if (SKIP_NAMES.has(ent.name) || ent.name.endsWith('.log')) continue;
      await collect(rel + '/' + ent.name, out);
    }
    return;
  }
  if (!st.isFile() || st.size === 0) return;
  out.push({ rel, file: full, data: await fsp.readFile(full) });
}

function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.rel.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(f.data);
    const method = f.data.length ? 8 : 0;
    const body = method === 8 ? zlib.deflateRawSync(f.data, { level: 9 }) : f.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, name]));
    offset += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

async function main() {
  const version = JSON.parse(await fsp.readFile(path.join(ROOT, 'version.json'), 'utf8'));
  const files = [];
  for (const entry of ENTRIES) await collect(entry, files);
  if (!files.some(f => f.rel === 'server.js')) throw new Error('server.js missing');
  if (!files.some(f => f.rel === 'update/sources.json')) throw new Error('update/sources.json missing');
  if (files.some(f => f.rel === 'update/latest.json')) throw new Error('update/latest.json must not be packaged');
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  const buf = zip(files);
  await fsp.mkdir(DIST, { recursive: true });
  const zipName = 'BATCAVE-OS-' + version.version + '.zip';
  const zipPath = path.join(DIST, zipName);
  await fsp.writeFile(zipPath, buf);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

  const manifestPath = path.join(ROOT, 'update', 'latest.json');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  manifest.version = version.version;
  manifest.codename = version.codename;
  manifest.released = version.released;
  const base = {
    github: 'https://github.com/IAMMEZSH/BATCAVE-OS/releases/download/v' + version.version + '/',
    gitcode: 'https://gitcode.com/gcw_So3EkhfR/BATCAVE-OS/releases/download/v' + version.version + '/'
  };
  for (const key of ['github', 'gitcode']) {
    manifest.assets = manifest.assets || {};
    manifest.assets[key] = { url: base[key] + zipName, sha256, size: buf.length };
    if (manifest.notesUrls) manifest.notesUrls[key] = base[key].replace('/releases/download/' + 'v' + version.version + '/', '/releases/tag/v' + version.version);
  }
  if (manifest.notesUrl) manifest.notesUrl = manifest.notesUrls ? manifest.notesUrls.github : manifest.notesUrl;
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await fsp.writeFile(path.join(DIST, 'SHA256SUMS.txt'), sha256 + '  ' + zipName + '\n', 'utf8');

  console.log(JSON.stringify({
    zip: zipPath,
    files: files.length,
    bytes: buf.length,
    sha256,
    version: version.version,
    manifest: manifestPath
  }, null, 2));
}

main().catch(e => { console.error('PACKAGE FAILED:', e.message); process.exit(1); });
