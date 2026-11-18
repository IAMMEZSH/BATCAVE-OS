'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const update = require('../lib/update');
const T = update._test;

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(files, opts = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8');
    const method = file.method === 0 ? 0 : 8;
    const body = method === 0 ? raw : zlib.deflateRawSync(raw);
    const crc = file.badCrc ? (crc32(raw) ^ 0xFFFFFFFF) >>> 0 : crc32(raw);
    const flags = file.encrypted ? 1 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

async function tempDir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

function payloadFiles(version = '3.2.0', marker = 'NEW', revision) {
  const n = marker.padEnd(32, '.');
  const versionJson = { version, codename: 'TEST', channel: 'stable' };
  if (revision !== undefined) versionJson.revision = revision;
  return [
    { name: 'server.js', data: '// ' + n + '\n' + 'x'.repeat(32) },
    { name: 'version.json', data: JSON.stringify(versionJson) },
    { name: 'lib/update.js', data: '// lib ' + n },
    { name: 'public/index.html', data: '<!doctype html>' + n },
    { name: 'public/js/apps-update.js', data: '// app ' + n },
    { name: 'update/sources.json', data: JSON.stringify({ schema: 1, sources: { github: {}, gitcode: {} } }) },
    { name: 'README.md', data: '# test ' + n }
  ];
}

test('crc32 matches known vector', () => {
  assert.equal(T.crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('compareVersions orders semver triples', () => {
  assert.equal(T.compareVersions('3.1.0', '3.1.0'), 0);
  assert.equal(T.compareVersions('3.2.0', '3.1.9'), 1);
  assert.equal(T.compareVersions('3.10.0', '3.9.9'), 1);
  assert.equal(T.compareVersions('2.9.9', '3.0.0'), -1);
  assert.equal(T.compareVersions('bad', '3.0.0'), 0);
});

test('isNewer compares version then revision', () => {
  assert.equal(T.isNewer('3.1.4', 0, '3.1.3', 0), true);
  assert.equal(T.isNewer('3.1.4', 0, '3.1.4', 0), false);
  assert.equal(T.isNewer('3.1.4', 1, '3.1.4', 0), true);
  assert.equal(T.isNewer('3.1.4', 0, '3.1.4', 1), false);
  assert.equal(T.parseRevision('2'), 2);
  assert.equal(T.parseRevision(0), 0);
  assert.equal(T.parseRevision('bad'), 0);
});

test('parseManifestText unwraps base64 contents API payload', () => {
  const manifest = { schema: 1, version: '3.1.0', assets: {} };
  const wrapper = { encoding: 'base64', content: Buffer.from(JSON.stringify(manifest)).toString('base64') };
  assert.deepEqual(T.parseManifestText(JSON.stringify(wrapper)), manifest);
  assert.deepEqual(T.parseManifestText(JSON.stringify(manifest)), manifest);
  assert.throws(() => T.parseManifestText('{bad'), /JSON/);
});

test('safeChild blocks traversal, absolute and empty names', () => {
  const base = path.join(os.tmpdir(), 'bc-safe');
  assert.equal(T.safeChild(base, 'public/index.html'), path.join(base, 'public', 'index.html'));
  assert.throws(() => T.safeChild(base, '../evil.txt'), /escapes|unsafe/);
  assert.throws(() => T.safeChild(base, '..\\evil.txt'), /escapes|unsafe/);
  assert.throws(() => T.safeChild(base, 'C:/evil.txt'), /absolute/);
  assert.throws(() => T.safeChild(base, ''), /bad zip entry/);
  assert.throws(() => T.safeChild(base, 'a//b'), /unsafe/);
});

test('extractZip handles stored and deflated entries', async () => {
  const dir = await tempDir('bc-zip-');
  const zipPath = path.join(dir, 'a.zip');
  await fsp.writeFile(zipPath, buildZip([
    { name: 'server.js', data: 'A'.repeat(24) },
    { name: 'lib/update.js', data: 'B'.repeat(24), method: 0 },
    { name: 'empty/', data: '' }
  ]));
  const out = path.join(dir, 'out');
  const res = await T.extractZip(zipPath, out);
  assert.equal(res.files, 2);
  assert.equal(await fsp.readFile(path.join(out, 'server.js'), 'utf8'), 'A'.repeat(24));
  assert.equal(await fsp.readFile(path.join(out, 'lib', 'update.js'), 'utf8'), 'B'.repeat(24));
  assert.ok((await fsp.stat(path.join(out, 'empty'))).isDirectory());
});

test('extractZip rejects traversal, crc mismatch and encryption', async () => {
  const dir = await tempDir('bc-zip-bad-');
  const out = path.join(dir, 'out');

  const trav = path.join(dir, 'trav.zip');
  await fsp.writeFile(trav, buildZip([{ name: '../escape.txt', data: 'x'.repeat(32) }]));
  await assert.rejects(T.extractZip(trav, out), /escapes|unsafe/);
  await assert.rejects(fsp.access(path.join(dir, 'escape.txt')), /ENOENT/);

  const bad = path.join(dir, 'crc.zip');
  await fsp.writeFile(bad, buildZip([{ name: 'server.js', data: 'x'.repeat(32), badCrc: true }]));
  await assert.rejects(T.extractZip(bad, out), /crc mismatch/);

  const enc = path.join(dir, 'enc.zip');
  await fsp.writeFile(enc, buildZip([{ name: 'server.js', data: 'x'.repeat(32), encrypted: true }]));
  await assert.rejects(T.extractZip(enc, out), /encrypted/);
});

test('validateStaging accepts a complete payload and rejects escapes', async () => {
  const dir = await tempDir('bc-stage-');
  const zipPath = path.join(dir, 'ok.zip');
  await fsp.writeFile(zipPath, buildZip(payloadFiles('3.2.0')));
  const staging = path.join(dir, 'staging');
  await T.extractZip(zipPath, staging);
  const files = await T.validateStaging(staging, '3.2.0');
  assert.ok(files.some(f => f.rel === 'server.js'));

  await assert.rejects(T.validateStaging(staging, '9.9.9'), /version mismatch/);
  await assert.rejects(T.validateStaging(staging, '3.2.0', 9), /revision mismatch/);

  const badDir = path.join(dir, 'bad');
  await fsp.cp(staging, badDir, { recursive: true });
  await fsp.writeFile(path.join(badDir, '.tsowner'), 'secret');
  await assert.rejects(T.validateStaging(badDir, '3.2.0'), /forbidden/);

  const dataDir = path.join(dir, 'bad2');
  await fsp.cp(staging, dataDir, { recursive: true });
  await fsp.mkdir(path.join(dataDir, 'data'), { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'data', 'notes.txt'), 'db');
  await assert.rejects(T.validateStaging(dataDir, '3.2.0'), /forbidden path/);
});

test('validateManifest rejects insecure hosts and bad hashes', () => {
  const hosts = new Set(['github.com']);
  const good = {
    version: '3.2.0',
    assets: { github: { url: 'https://github.com/x/y.zip', sha256: 'a'.repeat(64), size: 10 } }
  };
  const parsed = T.validateManifest(good, hosts);
  assert.equal(parsed.version, '3.2.0');

  assert.throws(() => T.validateManifest({
    version: '3.2.0',
    assets: { github: { url: 'http://github.com/x/y.zip', sha256: 'a'.repeat(64), size: 10 } }
  }, hosts), /host not allowed/);

  assert.throws(() => T.validateManifest({
    version: '3.2.0',
    assets: { github: { url: 'https://github.com/x/y.zip', sha256: 'xyz', size: 10 } }
  }, hosts), /sha256 invalid/);
});

test('applyLocalForTest replaces files, backs up and records history', async () => {
  const root = await tempDir('bc-root-');
  const dataDir = path.join(root, 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(path.join(root, 'public', 'js'), { recursive: true });
  await fsp.mkdir(path.join(root, 'lib'), { recursive: true });
  await fsp.writeFile(path.join(root, 'server.js'), '// OLD SERVER\n' + 'o'.repeat(32));
  await fsp.writeFile(path.join(root, 'version.json'), JSON.stringify({ version: '3.1.0' }));
  await fsp.writeFile(path.join(root, 'public', 'index.html'), 'OLD INDEX');
  await fsp.writeFile(path.join(root, 'public', 'js', 'apps-update.js'), 'OLD APP');
  await fsp.writeFile(path.join(root, 'lib', 'update.js'), 'OLD UPDATE');

  update.configure({ root, dataDir, version: '3.1.0', codename: 'OLD', serverPath: path.join(root, 'server.js'), port: 7777, host: '127.0.0.1', home: root, token: 't', allowLocalNet: false, allowDestructive: false });

  const dir = await tempDir('bc-apply-');
  const zipPath = path.join(dir, 'update.zip');
  await fsp.writeFile(zipPath, buildZip(payloadFiles('3.2.0', 'NEW')));
  const manifest = { version: '3.2.0', codename: 'NEW', notes: 'test notes', notesUrl: '' };
  const installed = await T.applyLocalForTest(zipPath, manifest, 'github');
  assert.equal(installed.version, '3.2.0');
  assert.equal(installed.previousVersion, '3.1.0');

  const server = await fsp.readFile(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /^\/\/ NEW/);
  const vj = JSON.parse(await fsp.readFile(path.join(root, 'version.json'), 'utf8'));
  assert.equal(vj.version, '3.2.0');
  assert.equal(await fsp.readFile(path.join(root, 'public', 'index.html'), 'utf8'), '<!doctype html>' + 'NEW'.padEnd(32, '.'));

  const backup = await fsp.readFile(path.join(installed.rollbackDir, 'server.js'), 'utf8');
  assert.match(backup, /^\/\/ OLD SERVER/);

  const state = await update.status();
  assert.equal(state.restartRequired, true);
  assert.equal(state.history[0].version, '3.2.0');

  const recovered = await update.recover();
  assert.equal(recovered, null);
});


test('applyLocalForTest accepts a newer revision of the same version', async () => {
  const root = await tempDir('bc-rev-root-');
  const dataDir = path.join(root, 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.mkdir(path.join(root, 'public', 'js'), { recursive: true });
  await fsp.mkdir(path.join(root, 'lib'), { recursive: true });
  await fsp.writeFile(path.join(root, 'server.js'), '// OLD REV\n' + 'o'.repeat(32));
  await fsp.writeFile(path.join(root, 'version.json'), JSON.stringify({ version: '3.2.0', revision: 0 }));
  await fsp.writeFile(path.join(root, 'public', 'index.html'), 'OLD INDEX');
  await fsp.writeFile(path.join(root, 'public', 'js', 'apps-update.js'), 'OLD APP');
  await fsp.writeFile(path.join(root, 'lib', 'update.js'), 'OLD UPDATE');
  update.configure({ root, dataDir, version: '3.2.0', revision: 0, codename: 'OLD', serverPath: path.join(root, 'server.js'), port: 7777, host: '127.0.0.1', home: root, token: 't', allowLocalNet: false, allowDestructive: false });

  const dir = await tempDir('bc-rev-apply-');
  const zipPath = path.join(dir, 'revision.zip');
  await fsp.writeFile(zipPath, buildZip(payloadFiles('3.2.0', 'REV', 1)));
  const manifest = { version: '3.2.0', revision: 1, codename: 'NEW', notes: 'revision notes', notesUrl: '' };
  const installed = await T.applyLocalForTest(zipPath, manifest, 'gitcode');
  assert.equal(installed.version, '3.2.0');
  assert.equal(installed.revision, 1);
  assert.equal(installed.previousRevision, 0);
  const state = await update.status();
  assert.equal(state.currentRevision, 0);
  assert.equal(state.history[0].revision, 1);
});

test('recover restores an interrupted transaction', async () => {
  const root = await tempDir('bc-recover-');
  const dataDir = path.join(root, 'data');
  const stateDir = path.join(dataDir, 'updates');
  const rollbackDir = path.join(stateDir, 'rollback-3.2.0-x');
  await fsp.mkdir(rollbackDir, { recursive: true });
  await fsp.writeFile(path.join(root, 'server.js'), '// HALF NEW');
  await fsp.writeFile(path.join(root, 'added.js'), '// ADDED');
  await fsp.writeFile(path.join(rollbackDir, 'server.js'), '// ORIGINAL');
  await fsp.writeFile(path.join(stateDir, 'transaction.json'), JSON.stringify({
    status: 'applying', version: '3.2.0', entries: ['server.js', 'added.js'], rollbackDir
  }));

  update.configure({ root, dataDir, version: '3.1.0', codename: 'OLD', serverPath: path.join(root, 'server.js'), port: 7777, host: '127.0.0.1', home: root, token: 't', allowLocalNet: false, allowDestructive: false });
  const actions = await update.recover();
  assert.ok(actions.includes('restored:server.js'));
  assert.ok(actions.includes('removed-new:added.js'));
  assert.equal(await fsp.readFile(path.join(root, 'server.js'), 'utf8'), '// ORIGINAL');
  await assert.rejects(fsp.access(path.join(root, 'added.js')), /ENOENT/);
  await assert.rejects(fsp.access(path.join(stateDir, 'transaction.json')), /ENOENT/);
  assert.ok(JSON.parse(await fsp.readFile(path.join(stateDir, 'recovery.json'), 'utf8')).actions.length >= 2);
});
