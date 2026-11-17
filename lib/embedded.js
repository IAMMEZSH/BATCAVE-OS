'use strict';
/* BATCAVE OS // embedded local apps: TenSaint73OS + Global Reading Room */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const IS_WIN = process.platform === 'win32';
const ROOT = path.join(__dirname, '..');
const TEMPLATES = path.join(ROOT, 'embedded');
const CODEFORGE_BUNDLED = path.join(TEMPLATES, 'CodeForge-AI');

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function codeforgeJar(root) {
  return path.join(root, 'server-java', 'build', 'CodeForgeServer.jar');
}

function resolveCodeForgeRoot() {
  const candidates = [];
  const push = p => {
    if (!p) return;
    const abs = path.resolve(p);
    if (!candidates.includes(abs) && fileExists(codeforgeJar(abs))) candidates.push(abs);
  };
  push(process.env.BATCAVE_CODEFORGE_ROOT);
  if (process.env.USERPROFILE) {
    const desktop = path.join(process.env.USERPROFILE, 'Desktop');
    push(path.join(desktop, 'CodeForge-AI'));
    try {
      fs.readdirSync(desktop)
        .filter(n => /^CodeForge-AI-\d/i.test(n))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .forEach(n => push(path.join(desktop, n)));
    } catch {}
  }
  push(CODEFORGE_BUNDLED);
  return candidates[0] || CODEFORGE_BUNDLED;
}

function findJavaExe() {
  if (!IS_WIN) {
    try {
      const r = spawnSync('sh', ['-lc', 'command -v java'], { encoding: 'utf8', timeout: 3000 });
      const p = r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0] : '';
      if (p && fileExists(p)) return p;
    } catch {}
    return null;
  }
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const home = process.env.USERPROFILE || '';
  const roots = [];
  if (process.env.JAVA_HOME) roots.push(path.join(process.env.JAVA_HOME, 'bin'));
  [pf, path.join(pf, 'Microsoft'), path.join(pf, 'Java'), path.join(pf, 'Eclipse Adoptium'),
    path.join(pf, 'Zulu'), pf86, path.join(local, 'Programs'),
    path.join(local, 'Programs', 'Eclipse Adoptium'), path.join(home, '.jdks')].forEach(r => {
    if (!roots.includes(r)) roots.push(r);
  });
  for (const root of roots) {
    const direct = path.join(root, 'java.exe');
    if (fileExists(direct)) return direct;
    try {
      const dirs = fs.readdirSync(root)
        .filter(n => /jdk|java|openjdk|temurin|zulu|graal/i.test(n) && fs.statSync(path.join(root, n)).isDirectory())
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const dir of dirs) {
        const exe = path.join(root, dir, 'bin', 'java.exe');
        if (fileExists(exe)) return exe;
      }
    } catch {}
  }
  try {
    const r = spawnSync('where.exe', ['java'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    if (r.status === 0 && r.stdout) {
      const p = r.stdout.split(/\r?\n/)[0].trim();
      if (p && fileExists(p)) return p;
    }
  } catch {}
  return null;
}

function codeforgeSpec(root, port) {
  const java = findJavaExe();
  if (!java) return null;
  return {
    file: java,
    args: ['--add-modules', 'jdk.httpserver', '-Dfile.encoding=UTF-8',
      '-jar', codeforgeJar(root), '--root', root, '--port', String(port)],
    cwd: root
  };
}

const APPS = {
  tensaint: {
    id: 'tensaint',
    name: 'TenSaint73OS',
    en: 'COMMAND NEXUS',
    desc: '单管理员社区系统 · 论坛/文件/会员 · 内嵌运行',
    port: 7781,
    template: 'TenSaint73OS',
    health: '/',
    workspace: true,
    env: (dataDir) => ({
      TS_PORT: '7781',
      TS_BIND: '127.0.0.1',
      LAUNCH_OPEN: '0'
    }),
    dataDir: (dataDir) => path.join(dataDir, 'apps', 'tensaint')
  },
  reading: {
    id: 'reading',
    name: '环球报阁',
    en: 'GLOBAL READING ROOM',
    desc: '多语种报刊阅读 · RSS/翻译/朗读 · 内嵌运行',
    port: 7782,
    template: 'global-reading-room',
    health: '/api/health',
    workspace: true,
    workspaceDir: (dataDir) => path.join(dataDir, 'apps', 'reading', 'app'),
    env: (dataDir) => ({
      GRR_PORT: '7782',
      GRR_NO_OPEN: '1',
      GRR_DATA_DIR: path.join(dataDir, 'apps', 'reading')
    }),
    dataDir: (dataDir) => path.join(dataDir, 'apps', 'reading')
  },
  codeforge: {
    id: 'codeforge',
    name: 'CodeForge AI',
    en: 'CODEFORGE AI 1.0.4',
    desc: '自带 AI 编程中枢 · 编译/运行/自修复 · 内嵌运行',
    port: 7790,
    health: '/api/health',
    workspace: false,
    path: '/console/',
    resolveRoot: () => resolveCodeForgeRoot(),
    command: (root) => codeforgeSpec(root, 7790)
  }
};

const state = new Map();

function appUrl(app) {
  return 'http://127.0.0.1:' + app.port + (app.path || '/');
}

function readPkg(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); }
  catch { return {}; }
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function compareVersionStrings(a, b) {
  const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

function workspaceDirOf(app, dataDir) {
  return app.workspaceDir ? app.workspaceDir(dataDir) : path.join(app.dataDir(dataDir), 'app');
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(src, dst, {
    recursive: true,
    force: true,
    filter: (p) => path.basename(p) !== 'data'
  });
}

function ensureWorkspace(app) {
  const src = path.join(TEMPLATES, app.template);
  if (!app.workspace) return { dir: src, copied: false };
  const dataDir = global.__batcaveDataDir || path.join(ROOT, 'data');
  const dst = workspaceDirOf(app, dataDir);
  const srcVersion = readPkg(src).version || '0.0.0';
  const dstVersion = readPkg(dst).version || '';
  if (!fs.existsSync(path.join(dst, 'server.js')) || (dstVersion && srcVersion && compareVersionStrings(srcVersion, dstVersion) > 0)) {
    copyTree(src, dst);
    return { dir: dst, copied: true, version: srcVersion };
  }
  return { dir: dst, copied: false, version: dstVersion };
}

function resolveAppRoot(id, dataDir) {
  const app = APPS[id];
  if (!app) return '';
  if (app.workspace) {
    const dir = dataDir || global.__batcaveDataDir || path.join(ROOT, 'data');
    const ws = workspaceDirOf(app, dir);
    if (!fs.existsSync(path.join(ws, 'server.js'))) {
      const prev = global.__batcaveDataDir;
      global.__batcaveDataDir = dir;
      ensureWorkspace(app);
      if (prev) global.__batcaveDataDir = prev;
    }
    return ws;
  }
  if (app.resolveRoot) return app.resolveRoot();
  return path.join(TEMPLATES, app.template);
}

function httpJson(port, healthPath, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: healthPath || '/', timeout: timeoutMs }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', d => { data += d; if (data.length > 65536) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function appVersion(id, dataDir) {
  const app = APPS[id];
  if (!app) return '';
  if (app.id === 'codeforge') {
    if (await probe(app.port, app.health)) {
      const health = await httpJson(app.port, app.health);
      if (health && health.version) return String(health.version);
    }
    const root = resolveCodeForgeRoot();
    const local = readJsonFile(path.join(root, 'version.json'));
    if (local && local.version) return String(local.version);
    const state = readJsonFile(path.join(dataDir || global.__batcaveDataDir || path.join(ROOT, 'data'), 'updates', 'apps', 'state.json'));
    if (state && state.codeforge && state.codeforge.version) return String(state.codeforge.version);
    return '1.0.4';
  }
  const root = resolveAppRoot(id, dataDir);
  let version = readPkg(root).version || '';
  if (!version && app.template) version = readPkg(path.join(TEMPLATES, app.template)).version || '';
  return version;
}

function probe(port, healthPath, timeoutMs = 900) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: healthPath || '/', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode > 0 && res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function waitReady(port, healthPath, ms = 12000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      if (await probe(port, healthPath)) return resolve(true);
      if (Date.now() - started > ms) return resolve(false);
      setTimeout(tick, 300);
    };
    tick();
  });
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  } catch { /* already gone */ }
}

function logTail(st) {
  return st.log.slice(-40).join('\n');
}

async function start(id, dataDir) {
  const app = APPS[id];
  if (!app) return { ok: false, error: 'unknown app' };
  global.__batcaveDataDir = dataDir || global.__batcaveDataDir;

  const existing = state.get(id);
  if (existing && existing.child && !existing.child.killed && await probe(app.port, app.health)) {
    return { ok: true, running: true, url: appUrl(app), already: true, version: await appVersion(id, dataDir) };
  }
  if (existing && existing.child && !existing.child.killed) {
    killTree(existing.child);
    state.delete(id);
  }

  if (await probe(app.port, app.health)) {
    return { ok: true, running: true, url: appUrl(app), external: true, version: await appVersion(id, dataDir) };
  }

  let spec;
  let env = Object.assign({}, process.env);
  let root = '';
  if (app.command) {
    root = app.resolveRoot();
    if (!fileExists(codeforgeJar(root))) {
      return { ok: false, error: '未找到 CodeForge AI 服务端: ' + codeforgeJar(root) };
    }
    spec = app.command(root);
    if (!spec) return { ok: false, error: '未找到 Java 运行时（需要 Java 17+，请安装或配置 JAVA_HOME）' };
  } else {
    const ws = ensureWorkspace(app);
    if (ws.copied) fs.mkdirSync(app.dataDir(global.__batcaveDataDir), { recursive: true });
    const entry = path.join(ws.dir, 'server.js');
    if (!fs.existsSync(entry)) return { ok: false, error: '内嵌程序缺失: ' + entry };
    root = ws.dir;
    spec = { file: process.execPath, args: [entry], cwd: ws.dir };
    env = Object.assign(env, app.env(global.__batcaveDataDir));
  }

  const st = { child: null, log: [], startedAt: Date.now(), app, root };
  st.child = spawn(spec.file, spec.args, {
    cwd: spec.cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env
  });
  const push = (buf) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (line.trim()) st.log.push(line.trim());
    }
    if (st.log.length > 200) st.log.splice(0, st.log.length - 200);
  };
  st.child.stdout.on('data', push);
  st.child.stderr.on('data', push);
  st.child.on('exit', (code) => {
    st.exited = true;
    st.code = code;
    st.log.push('[exit] code=' + code);
  });
  st.child.on('error', (e) => { st.exited = true; st.log.push('[error] ' + e.message); });
  state.set(id, st);

  const ready = await waitReady(app.port, app.health, app.id === 'codeforge' ? 30000 : 12000);
  if (!ready) {
    return { ok: false, error: '启动超时或端口被占用', log: logTail(st), running: false };
  }
  return { ok: true, running: true, url: appUrl(app), log: logTail(st), version: await appVersion(id, dataDir) };
}

async function stop(id) {
  const st = state.get(id);
  const app = APPS[id];
  if (!app) return { ok: false, error: 'unknown app' };
  if (!st || !st.child) {
    const running = await probe(app.port, app.health);
    return { ok: true, running: false, note: running ? '该端口由 BATCAVE 之外的进程占用，未终止' : '未在运行' };
  }
  killTree(st.child);
  state.delete(id);
  await new Promise(r => setTimeout(r, 500));
  return { ok: true, running: await probe(app.port, app.health) };
}

async function list(dataDir) {
  if (dataDir) global.__batcaveDataDir = dataDir;
  const dir = dataDir || global.__batcaveDataDir || path.join(ROOT, 'data');
  const out = [];
  for (const app of Object.values(APPS)) {
    const st = state.get(app.id);
    const running = await probe(app.port, app.health);
    out.push({
      id: app.id,
      name: app.name,
      en: app.en,
      desc: app.desc,
      port: app.port,
      running,
      url: appUrl(app),
      version: await appVersion(app.id, dir),
      managed: Boolean(st && st.child && !st.exited),
      log: st ? logTail(st) : ''
    });
  }
  return { apps: out };
}

function stopAll() {
  for (const [id] of state) killTree((state.get(id) || {}).child);
  state.clear();
}

module.exports = { APPS, start, stop, list, stopAll, resolveAppRoot, appVersion, TEMPLATES };