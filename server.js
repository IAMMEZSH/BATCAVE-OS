#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');

const bridge = require('./lib/bridge');
const home = require('./lib/home');
const network = require('./lib/network');
const appsLib = require('./lib/apps');
const mail = require('./lib/mail');
const embedded = require('./lib/embedded');
const update = require('./lib/update');
const appUpdates = require('./lib/app-updates');
const releaseFeed = require('./lib/release-feed');

const VERSION = '3.1.3';
const CODENAME = 'SENTINEL';
const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';
const PUBLIC = path.join(__dirname, 'public');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open') out.open = false;
    else if (a === '--open') out.open = true;
    else if (a === '--kiosk') out.kiosk = true;
    else if (a === '--tui') out.tui = true;
    else if (a === '--version' || a === '-v') out.version = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--allow-local-net') out.allowLocalNet = true;
    else if (a === '--allow-destructive') out.allowDestructive = true;
    else if (a.startsWith('--port=')) out.port = a.slice(7);
    else if (a.startsWith('--host=')) out.host = a.slice(7);
    else if (a.startsWith('--home=')) out.home = a.slice(7);
    else if (a.startsWith('--data=')) out.data = a.slice(7);
    else if (a === '--port') out.port = argv[++i];
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--home') out.home = argv[++i];
    else if (a === '--data') out.data = argv[++i];
    else out._.push(a);
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));
const PORT = Number(process.env.BATCAVE_PORT || argv.port || 7777);
const HOST = process.env.BATCAVE_HOST || argv.host || '127.0.0.1';
const OPEN_BROWSER = argv.open === false ? false : !argv.tui;
const KIOSK = !!argv.kiosk;
const ALLOW_LOCAL_NET = !!argv.allowLocalNet || process.env.BATCAVE_ALLOW_LOCAL_NET === '1';
const ALLOW_DESTRUCTIVE = !!argv.allowDestructive || process.env.BATCAVE_ALLOW_DESTRUCTIVE === '1';

const DATA_DIR = path.resolve(process.env.BATCAVE_DATA || argv.data || path.join(__dirname, 'data'));
const HOME_ROOT = path.resolve(
  process.env.BATCAVE_HOME || argv.home ||
  (IS_LINUX ? os.homedir() : path.join(os.homedir(), 'Batcave'))
);

const TOKEN = process.env.BATCAVE_TOKEN || crypto.randomBytes(24).toString('hex');

update.configure({
  root: __dirname,
  serverPath: __filename,
  dataDir: DATA_DIR,
  version: VERSION,
  codename: CODENAME,
  port: PORT,
  host: HOST,
  home: HOME_ROOT,
  allowLocalNet: ALLOW_LOCAL_NET,
  allowDestructive: ALLOW_DESTRUCTIVE,
  token: TOKEN
});
let HOME_UNIX = IS_LINUX ? HOME_ROOT : null;
let BOOT = null;
let CPU_PREV = null;
let LINUX_PROBE_CACHE = { at: 0, data: null };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json'
};

const A = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[38;2;56;232;255m',
  ice: '\x1b[38;2;185;242;255m',
  mint: '\x1b[38;2;72;255;176m',
  amber: '\x1b[38;2;255;186;70m',
  rose: '\x1b[38;2;255;79;120m',
  violet: '\x1b[38;2;196;132;255m',
  gray: '\x1b[38;2;112;144;158m',
  white: '\x1b[38;2;226;247;252m'
};

function paint(s, c) { return c + s + A.reset; }

function wildcardHelp() {
  const info = bridge.getInfo();
  const modes = info.modes.map(m => `${m.label}${m.available ? '' : ' (offline)'}`).join(' · ');
  const linuxLine = info.linuxAvailable
    ? (IS_LINUX ? 'ONLINE — native Linux shell' : `ONLINE — WSL (${info.wsl})`)
    : 'OFFLINE — apt-get / sudo / Homebrew need WSL2 or the Batcave ISO';
  return [
    paint('BATCAVE SHELL', A.cyan + A.bold) + paint('  //  REAL EXECUTION ENVIRONMENT', A.gray),
    '',
    paint('MODES', A.ice) + '       ' + modes,
    paint('LINUX CORE', A.ice) + '  ' + (info.linuxAvailable ? paint('ONLINE', A.mint) : paint('OFFLINE', A.amber)) +
      paint('  ' + linuxLine, A.gray),
    '',
    paint('REAL COMMANDS', A.ice),
    '  ls  cd  pwd  cat  cp  mv  rm  mkdir  find  grep  ps  top  df  free  curl  ssh',
    '  python3  node  gcc  g++  rustc  go  java  npm  pip  git  apt-get  sudo  brew',
    '  powershell  cmd  winget  ipconfig  tasklist  systeminfo  (视当前模式与平台而定)',
    '',
    paint('BATCAVE COMMANDS', A.ice),
    '  neofetch   系统与引擎信息        help        本页',
    '  mode       查看执行模式          linux-core  Linux 引擎状态',
    '  open <x>   打开应用/文件/网址     theme <t>   切换主题',
    '  wall <w>   切换壁纸              matrix      数字雨效果',
    '  apps       应用库                forge       多语言 Code Forge',
    '  brew-setup Homebrew Linux 指引    breach      破译训练模拟',
    '  lock       锁屏                  reboot      重启桌面会话',
    '  poweroff   关机                  clear       清屏',
    '',
    paint('INSTALL EXAMPLES', A.ice),
    '  sudo apt-get update && sudo apt-get install -y nmap',
    '  pip install requests        npm install -g typescript',
    '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    '',
    paint('WARNING', A.rose) + paint('  真实终端会直接作用于当前系统。危险命令需要二次确认。', A.gray)
  ].join('\n') + '\n';
}

function neofetch() {
  const info = bridge.getInfo();
  const cpus = os.cpus();
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const user = os.userInfo().username;
  const uptimeH = (os.uptime() / 3600).toFixed(1);
  const linux = info.linuxAvailable
    ? (IS_LINUX ? 'native' : 'WSL2 / ' + info.wsl)
    : 'offline';
  const art = [
    paint('        ▄▄▄▄▄       ▄▄▄▄▄', A.cyan),
    paint('     ▄███████▄   ▄███████▄', A.cyan),
    paint('    ███████████ ███████████', A.cyan + A.bold),
    paint('   ███████ ', A.cyan) + paint(' SENTINEL ', A.rose + A.bold) + paint(' ███████', A.cyan),
    paint('    ▀█████████ █████████▀', A.cyan),
    paint('      ▀█████▀   ▀█████▀', A.cyan),
    paint('         ▀▀       ▀▀', A.cyan)
  ].join('\n');
  const label = (s) => paint(s.padEnd(11), A.ice);
  const lines = [
    art,
    '',
    paint(user + '@' + os.hostname(), A.mint + A.bold) + paint('  ─────────────────────────', A.gray),
    label('OS') + `BATCAVE OS ${VERSION} ${CODENAME}`,
    label('HOST') + `${os.type()} ${os.release()} ${os.arch()}`,
    label('SHELL') + (info.modes.find(m => m.id === info.defaultMode)?.label || info.defaultMode),
    label('TERMINAL') + 'Batcave Terminal (web)',
    label('CPU') + `${cpus[0]?.model?.trim() || 'unknown'} ×${cpus.length}`,
    label('MEMORY') + `${(used / 1048576).toFixed(0)} MiB / ${(total / 1048576).toFixed(0)} MiB`,
    label('UPTIME') + `${uptimeH} h`,
    label('LINUX') + linux,
    label('NODE') + process.version + '  ' + paint('batcave://gotham', A.violet)
  ];
  return lines.join('\n') + '\n';
}

function aboutText() {
  return [
    paint('BATCAVE OS // SENTINEL', A.cyan + A.bold),
    `version ${VERSION}  ·  build ${CODENAME}`,
    '',
    'An unofficial fan-made cyber desktop, inspired by a certain nocturnal detective.',
    'Not affiliated with DC Comics or Warner Bros.',
    '',
    paint('ENGINE', A.ice),
    '  Node.js server · real shell bridge · local-first',
    '  Windows: PowerShell / CMD / Git Bash / optional WSL2 Linux Core',
    '  Linux: native Bash, apt, sudo, Homebrew-capable',
    '',
    paint('SECURITY', A.ice),
    '  http://' + HOST + ':' + PORT + '  ·  token-gated local API  ·  sandboxed web proxy',
    '',
    paint('TRY', A.ice),
    '  neofetch   ·   help   ·   mode   ·   linux-core'
  ].join('\n') + '\n';
}

function linuxCoreText() {
  const info = bridge.getInfo();
  const lines = [
    paint('LINUX CORE', A.cyan + A.bold) + paint('  //  package manager & toolchain engine', A.gray),
    '',
    paint('STATUS      ', A.ice) + (info.linuxAvailable ? paint('ONLINE', A.mint) : paint('OFFLINE', A.amber)),
    paint('ENGINE      ', A.ice) + (IS_LINUX ? 'native Linux' : info.wsl ? 'WSL2 · ' + info.wsl : 'not installed'),
    paint('APTSOURCE   ', A.ice) + (info.linuxAvailable ? 'available (sudo apt-get ...)' : 'requires Batcave ISO or WSL2'),
    paint('HOMEBREW    ', A.ice) + (info.linuxAvailable ? 'installable (brew-setup)' : 'requires Linux'),
    paint('COMPILERS   ', A.ice) + (info.linuxAvailable ? 'use apt / rustup / go / pip / npm / cargo' : 'Windows: dotnet / python / node available'),
    '',
    'Linux Core 提供真 sudo、apt-get、dpkg、systemctl、ssh、编译工具链与 Homebrew。',
    'Windows 版：安装 WSL2 Ubuntu 后自动出现 LINUX CORE 模式；或启动 Batcave ISO。',
    '',
    paint('WINDOWS + WSL2 安装提示', A.ice),
    '  以管理员 PowerShell 运行:  wsl --install -d Ubuntu',
    '  安装后重启，再刷新本页面。',
    '',
    paint('HOMEBREW LINUX', A.ice),
    '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    '  需要非 root 用户；ISO 默认使用非 root 账户。',
    '',
    paint('KALI TOOLS (ISO / Debian 系)', A.ice),
    '  sudo apt-get install -y nmap metasploit-framework sqlmap hydra aircrack-ng wireshark'
  ];
  return lines.join('\n') + '\n';
}

const THEME_IDS = ['cyan', 'crimson', 'emerald', 'amber', 'violet'];
const WALL_IDS = ['skyline', 'emblem', 'cave'];

async function serveThemeCommand(base, args, emit, event) {
  if (base === 'help' || base === 'commands' || base === '?') {
    emit(wildcardHelp());
    return true;
  }
  if (base === 'neofetch' || base === 'fetch') {
    emit(neofetch());
    return true;
  }
  if (base === 'about' || base === 'version') {
    emit(aboutText());
    return true;
  }
  if (base === 'linux-core' || base === 'core') {
    emit(linuxCoreText());
    return true;
  }
  if (base === 'brew-setup') {
    emit([
      paint('HOMEBREW LINUX', A.cyan + A.bold),
      '',
      '在 BASH / LINUX CORE 模式下执行（需要非 root 用户）：',
      '',
      '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      '',
      '安装后把 brew 加入 PATH：',
      '  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"',
      '',
      'Windows 桌面版请先安装 WSL2；或启动 Batcave ISO 使用原生 Linux Core。'
    ].join('\n') + '\n');
    return true;
  }
  if (base === 'mode') {
    const info = bridge.getInfo();
    emit([
      paint('EXECUTION MODES', A.cyan + A.bold),
      ...info.modes.map(m => '  ' + paint(m.label.padEnd(13), A.ice) + (m.note || m.kind) + (m.available ? '' : '  OFFLINE')),
      '',
      '使用终端右上角的模式选择器切换。每个模式是真实 shell，不是模拟。'
    ].join('\n') + '\n');
    return true;
  }
  if (base === 'theme') {
    if (!args[0]) {
      emit(paint('THEMES', A.ice) + '  ' + THEME_IDS.join(' · ') + '\n');
      return true;
    }
    if (!THEME_IDS.includes(args[0])) {
      emit(paint('未知主题：', A.rose) + args[0] + '  可用: ' + THEME_IDS.join(', ') + '\n');
      return true;
    }
    event({ t: 'action', action: { type: 'theme', value: args[0] } });
    emit(paint('主题已切换: ', A.gray) + args[0] + '\n');
    return true;
  }
  if (base === 'wall' || base === 'wallpaper') {
    if (!args[0]) {
      emit(paint('WALLPAPERS', A.ice) + '  ' + WALL_IDS.join(' · ') + '\n');
      return true;
    }
    if (!WALL_IDS.includes(args[0])) {
      emit(paint('未知壁纸：', A.rose) + args[0] + '  可用: ' + WALL_IDS.join(', ') + '\n');
      return true;
    }
    event({ t: 'action', action: { type: 'wallpaper', value: args[0] } });
    emit(paint('壁纸已切换: ', A.gray) + args[0] + '\n');
    return true;
  }
  if (base === 'open') {
    if (!args.length) {
      emit('用法: open <app|file|url>\n');
      return true;
    }
    event({ t: 'action', action: { type: 'open', target: args.join(' ') } });
    return true;
  }
  const appActions = { apps: 'vault', vault: 'vault', terminal: 'terminal', files: 'files', browser: 'browser',
    settings: 'settings', monitor: 'monitor', forge: 'forge', breach: 'breach', alfred: 'alfred',
    'chat-ai': 'alfred', chat: 'alfred', ai: 'alfred',
    music: 'music', notes: 'notes', weather: 'weather', gallery: 'gallery', map: 'map', security: 'security',
    editor: 'editor', calculator: 'calc', calendar: 'calendar', tasks: 'taskmgr' };
  if (appActions[base] && base !== 'terminal') {
    event({ t: 'action', action: { type: 'openApp', app: appActions[base] } });
    emit(paint('open ', A.gray) + appActions[base] + '\n');
    return true;
  }
  if (base === 'matrix') {
    event({ t: 'action', action: { type: 'fx', value: args[0] === 'off' ? 'off' : 'rain' } });
    emit(paint('digital rain // ', A.gray) + (args[0] === 'off' ? 'disabled' : 'enabled') + '\n');
    return true;
  }
  if (base === 'lock') {
    event({ t: 'action', action: { type: 'lock' } });
    return true;
  }
  if (base === 'reboot' || base === 'restart') {
    event({ t: 'action', action: { type: 'reboot' } });
    return true;
  }
  if (base === 'poweroff' || base === 'halt') {
    event({ t: 'action', action: { type: 'poweroff' } });
    return true;
  }
  if (base === 'exit' || base === 'logout') {
    event({ t: 'action', action: { type: 'exit' } });
    return true;
  }
  if (base === 'clear' || base === 'cls' || base === 'clean') {
    event({ t: 'action', action: { type: 'clear' } });
    return true;
  }
  if (base === 'gotham') {
    emit([
      paint('GOTHAM GRID // 03:17', A.cyan + A.bold),
      '  SPIRE      ' + paint('STABLE', A.mint) + '    sector 01 · 02 · 03',
      '  DOCKS      ' + paint('WATCH', A.amber) + '     irregular freight traffic',
      '  CINDER ROW ' + paint('STABLE', A.mint) + '    sensor sweep clean',
      '  NIGHTMARKET' + paint('TRACE', A.violet) + '    darknet relay active',
      '  VESPER BAY ' + paint('STABLE', A.mint) + '    lighthouse online',
      '',
      paint('本地模拟数据 · 与真实世界无关', A.gray)
    ].join('\n') + '\n');
    return true;
  }
  if (!bridge.getInfo().linuxAvailable) {
    const linuxOnly = new Set(['sudo', 'apt', 'apt-get', 'dpkg', 'systemctl', 'brew', 'snap', 'yum', 'dnf', 'pacman', 'apk', 'add-apt-repository']);
    if (linuxOnly.has(base)) {
      emit([
        paint('LINUX CORE OFFLINE', A.amber + A.bold),
        '',
        `“${base}” 是真实 Linux 命令，但当前 Windows 桌面版没有 Linux 引擎。`,
        '可选方案：',
        '  1. 启动 Batcave ISO（内置 Kali/Linux，自带 apt、sudo、Homebrew）',
        '  2. 安装 WSL2: 管理员 PowerShell 运行  wsl --install -d Ubuntu  然后刷新页面',
        '  3. Windows 原生等效：winget install <Package.Id>',
        '',
        paint('当前可用真实模式：', A.gray) + bridge.getInfo().modes.map(m => m.label).join(' · ')
      ].join('\n') + '\n');
      return true;
    }
  }
  return false;
}

function cpuSnapshot() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}

function cpuUsage() {
  const cur = cpuSnapshot();
  let pct = 0;
  if (CPU_PREV) {
    const di = cur.idle - CPU_PREV.idle;
    const dt = cur.total - CPU_PREV.total;
    if (dt > 0) pct = Math.max(0, Math.min(100, 100 - (di / dt) * 100));
  }
  CPU_PREV = cur;
  return Math.round(pct * 10) / 10;
}

async function stats() {
  const info = bridge.getInfo();
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const cpus = os.cpus();
  let disk = null;
  try {
    const st = await fsp.statfs(HOME_ROOT);
    const total = st.blocks * st.bsize;
    const free = st.bfree * st.bsize;
    disk = { total, free, used: total - free };
  } catch {}
  const ifaces = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of (list || [])) {
      if (a.internal) continue;
      ifaces.push({ name, address: a.address, family: a.family, mac: a.mac || '' });
    }
  }
  return {
    time: Date.now(),
    hostname: os.hostname(),
    user: os.userInfo().username,
    platform: process.platform,
    release: os.release(),
    arch: os.arch(),
    uptime: os.uptime(),
    cpu: {
      usage: cpuUsage(),
      count: cpus.length,
      model: cpus[0]?.model?.trim() || 'unknown'
    },
    mem: { total: memTotal, free: memFree, used: memTotal - memFree },
    load: os.loadavg(),
    disk,
    ifaces,
    server: {
      pid: process.pid,
      node: process.version,
      version: VERSION,
      port: PORT
    },
    bridge: {
      linuxAvailable: info.linuxAvailable,
      wsl: info.wsl,
      modes: info.modes
    }
  };
}

function tokenOk(req) {
  return req.headers['x-batcave-token'] === TOKEN;
}

function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
    return allowedHosts.has(u.hostname) && (String(u.port) === String(PORT) || (!u.port && PORT === 80));
  } catch { return false; }
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSON(req, limit = 1024 * 1024) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); }
  catch { throw Object.assign(new Error('invalid json'), { status: 400 }); }
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') ||
      s.startsWith('fe80') || s.startsWith('ff') || s.startsWith('::ffff:127.');
  }
  return false;
}

function withTimeout(p, ms, message) {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message || 'timeout')), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/* ---- URL risk assessment + short-lived authorization grants ---- */
const GRANT_SECRET = crypto.randomBytes(32);
const GRANT_TTL = 10 * 60 * 1000;

function grantSig(origin, exp) {
  return crypto.createHmac('sha256', GRANT_SECRET).update(origin + '\n' + exp).digest('base64url');
}

function makeGrant(origin) {
  const exp = Date.now() + GRANT_TTL;
  return { grant: exp + '.' + grantSig(origin, exp), origin, expiresAt: exp };
}

function verifyGrant(origin, grant) {
  if (!grant || !origin) return false;
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{20,})$/.exec(String(grant));
  if (!m) return false;
  const exp = Number(m[1]);
  if (!exp || exp < Date.now() || exp > Date.now() + GRANT_TTL + 60000) return false;
  const want = Buffer.from(grantSig(origin, exp));
  const got = Buffer.from(m[2]);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

async function assessUrl(url) {
  const reasons = [];
  let level = 'safe';
  const add = (severity, code, message) => {
    reasons.push({ severity, code, message });
    if (severity === 'block') level = 'block';
    else if (severity === 'warn' && level !== 'block') level = 'warn';
  };
  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (/^https?:$/.test(url.protocol) === false) add('block', 'protocol', '只允许 http/https 协议（' + url.protocol + ' 已阻止）');
  if (url.username || url.password) add('warn', 'credentials', 'URL 中内嵌用户名或密码，会被目标站点和环境记录直接读取。');
  if (url.protocol === 'http:') add('warn', 'http-plain', '明文 HTTP：流量不加密，同一网络中的攻击者可读取或篡改内容与登录凭据。');
  if (net.isIP(host) && !privateIp(host)) add('warn', 'ip-literal', '直接以 IP 地址访问，无法通过域名证书验证服务器身份，可能连接到被顶替的主机。');
  if (/(^|\.)xn--/i.test(host)) add('warn', 'punycode', '域名含有 Punycode（xn--）编码，可能同形仿冒知名站点。请检查拼写。');
  if (String(url.href).length > 2000) add('warn', 'long-url', 'URL 长度异常（' + String(url.href).length + ' 字符），可能包含隐藏跳转或注入内容。');

  if (!ALLOW_LOCAL_NET) {
    if (host === 'localhost' || host.endsWith('.localhost')) {
      add('block', 'localhost', '目标是本机回环地址（localhost），可能访问到本机服务或本桌面 API。');
    } else if (net.isIP(host)) {
      if (privateIp(host)) add('block', 'private-net', '目标 IP ' + host + ' 属于回环/私有/链路本地网段，可能用于访问内网设备或云元数据服务。');
    } else {
      try {
        const addrs = await withTimeout(dns.lookup(host, { all: true }), 5000, 'DNS 解析超时');
        if (!addrs.length) add('block', 'dns-fail', '无法解析主机名。');
        else {
          const bad = addrs.find(a => privateIp(a.address));
          if (bad) add('block', 'dns-private', '域名解析到私有地址 ' + bad.address + '，可能是 DNS 重绑定或内网穿透。');
        }
      } catch (e) {
        add('block', 'dns-fail', '无法确认目标地址：' + e.message);
      }
    }
  }

  return {
    url: url.href,
    host,
    origin: url.origin,
    level,
    reasons,
    allowLocalNet: ALLOW_LOCAL_NET,
    checkedAt: Date.now()
  };
}

async function logSecurity(line) {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.appendFile(path.join(DATA_DIR, 'security.log'), new Date().toISOString() + ' ' + line + '\n', 'utf8');
  } catch {}
}

function fetchJson(target, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(target); } catch (e) { return reject(e); }
    if (u.protocol !== 'https:') return reject(new Error('https only'));
    const req = https.get(u, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'BATCAVE-OS/' + VERSION + ' (desktop; +http://127.0.0.1)',
        'Accept': 'application/json'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchJson(new URL(res.headers.location, u).href, timeoutMs));
      }
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size > 2 * 1024 * 1024) { req.destroy(); reject(new Error('response too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, data: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, data: null, text: text.slice(0, 400) }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function geoIpLookup(q) {
  q = String(q || '').trim();
  if (q) {
    if (!net.isIP(q) && !/^[a-z0-9.-]{1,253}$/i.test(q)) return { ok: false, message: 'IP 或域名格式无效' };
    try {
      const addrs = await dns.lookup(q);
      q = addrs.address;
    } catch (e) {
      return { ok: false, message: 'DNS 解析失败：' + e.message };
    }
  }
  const target = 'https://ipwho.is/' + encodeURIComponent(q);
  try {
    const r = await fetchJson(target, 12000);
    const d = r.data || {};
    if (d.success === false) return { ok: false, message: d.message || 'IP 查询服务返回失败' };
    return {
      ok: true,
      ip: d.ip || q || '',
      type: d.type || '',
      city: d.city || '',
      region: d.region || '',
      country: d.country || '',
      countryCode: d.country_code || '',
      postal: d.postal || '',
      latitude: typeof d.latitude === 'number' ? d.latitude : null,
      longitude: typeof d.longitude === 'number' ? d.longitude : null,
      timezone: (d.timezone && d.timezone.id) || '',
      utcOffset: (d.timezone && d.timezone.utc) || '',
      isp: (d.connection && d.connection.isp) || '',
      org: (d.connection && d.connection.org) || '',
      asn: (d.connection && d.connection.asn) || null,
      source: 'ipwho.is'
    };
  } catch (e) {
    return { ok: false, message: 'IP 归属查询失败：' + e.message };
  }
}

async function handleTimezoneLookup(req, res, url) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lon = parseFloat(url.searchParams.get('lon'));
  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return sendJSON(res, 400, { error: '经纬度无效' });
  }
  try {
    const r = await fetchJson(
      'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(4) +
      '&longitude=' + lon.toFixed(4) + '&current=temperature_2m,weather_code&timezone=auto&forecast_days=1',
      12000
    );
    const d = r.data || {};
    return sendJSON(res, 200, {
      ok: true,
      timezone: d.timezone || '',
      utcOffsetSeconds: typeof d.utc_offset_seconds === 'number' ? d.utc_offset_seconds : null,
      localTime: (d.current && d.current.time) || '',
      temperature: (d.current && typeof d.current.temperature_2m === 'number') ? d.current.temperature_2m : null,
      weatherCode: (d.current && typeof d.current.weather_code === 'number') ? d.current.weather_code : null,
      elevation: typeof d.elevation === 'number' ? d.elevation : null,
      source: 'open-meteo.com'
    });
  } catch (e) {
    return sendJSON(res, 200, { ok: false, message: '时区查询失败：' + e.message });
  }
}

async function handleGeoTrace(req, res, body) {
  const host = String(body.host || '').trim();
  if (!/^[a-z0-9.-]{1,253}$/i.test(host) || /[\s;&|<>`$]/.test(host)) {
    return sendJSON(res, 400, { error: '目标格式无效（只允许域名或 IP）' });
  }
  const maxHops = Math.min(Math.max(parseInt(body.maxHops, 10) || 30, 1), 64);
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'tracert' : 'traceroute';
  const args = isWin ? ['-d', '-h', String(maxHops), '-w', '900', host] : ['-n', '-m', String(maxHops), '-w', '2', host];
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  const child = spawn(cmd, args, { windowsHide: true });
  const send = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch {} };
  send({ type: 'start', target: host, tool: cmd, at: Date.now() });
  let buf = '';
  const feed = (chunk) => {
    buf += chunk.toString('utf8');
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) if (line.trim()) send({ type: 'line', text: line });
  };
  child.stdout.on('data', feed);
  child.stderr.on('data', feed);
  child.on('error', (e) => { send({ type: 'error', message: e.message }); res.end(); });
  child.on('close', (code) => { if (buf.trim()) send({ type: 'line', text: buf }); send({ type: 'end', code }); res.end(); });
  req.on('close', () => { try { child.kill(); } catch {} });
  await logSecurity('GEOTRACE ' + host);
}

async function geoWifiSignals(elevated) {
  if (!IS_WIN) return { ok: false, available: false, networks: [], message: '仅 Windows 主机支持无线信号测量。' };
  const r = await network.scanWifi({ elevated: !!elevated });
  if (!r.ok && (r.needsElevation || r.needsLocation)) {
    return {
      ok: false, available: true, networks: [],
      needsElevation: !!r.needsElevation, needsLocation: !!r.needsLocation,
      message: r.message || '需要管理员或位置权限。'
    };
  }
  return {
    ok: !!r.ok,
    available: true,
    networks: (r.networks || []).map(n => ({
      ssid: n.ssid,
      signal: n.signal,
      auth: n.auth,
      encryption: n.encryption,
      open: !!n.open,
      dbmEstimate: typeof n.signal === 'number' ? Math.round(n.signal / 2 - 100) : null
    })),
    note: '信号强度为 Windows 的 0-100% 指示；dBm 为按 dBm≈(百分比/2)-100 的估算值，仅用于相对强弱比较。浏览器与操作系统不向网页暴露蜂窝基站 ID，无法据此做真实基站三角定位。'
  };
}

/* ---------------- geo-windows 桥接兼容层 ----------------
 * 用户的 geo-windows 静态页把同源 origin 当作桥接地址；这些端点按它
 * server.py 的响应契约返回，让嵌入的 11 个面板直接用真实数据。
 */
function bridgeOriginOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) return false;
    const host = u.hostname;
    if (host === 'localhost') return true;
    if (net.isIP(host)) {
      const a = host.replace(/^\[|\]$/g, '');
      return privateIp(a) || a === '127.0.0.1' || a === '::1';
    }
    return false;
  } catch { return false; }
}
function bridgeCors(req, res) {
  const origin = req.headers.origin;
  if (!bridgeOriginOk(req)) return false;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'accept, content-type');
  return true;
}
function bridgeHealth(req) {
  const origin = req.headers.origin || ('http://127.0.0.1:' + PORT);
  return {
    ok: true, status: 'ok',
    server: 'batcave-geo-bridge', version: VERSION + '-geo',
    runtime: 'Node ' + process.version, python: null,
    platform: (IS_WIN ? 'Windows' : process.platform) + ' ' + os.arch(),
    capabilities: ['traceroute', 'ping', 'dns', 'iface', 'geoip'],
    endpoints: ['/api/health', '/api/traceroute?host=&max_hops=&timeout=', '/api/ping?host=&count=', '/api/dns?host=', '/api/iface', '/api/geoip?ip=&source='],
    cors_policy: { wildcard: false, built_in: ['null', origin], extra: [], note: '仅回环来源可读' },
    tools: { tracert: IS_WIN, ping: true, dns: true },
    limits: { traceroute_max_hops: 30, traceroute_timeout_s: 120 },
    active_children: 0,
    privacy: { coordinates_sent: false, note: '本桥只转发主机名/IP 查询，从不接收或转发经纬度。' },
    note: 'BATCAVE OS 内置桥（Node 实现），行为与 geo-windows server.py 对齐。'
  };
}
const IP_BRIDGE_SOURCES = {
  ipinfo_io: { self: 'https://ipinfo.io/json', query: 'https://ipinfo.io/{ip}/json' },
  ipapi_co: { self: 'https://ipapi.co/json/', query: 'https://ipapi.co/{ip}/json/' },
  ipwho_is: { self: 'https://ipwho.is/', query: 'https://ipwho.is/{ip}' },
  freeipapi: { self: 'https://freeipapi.com/api/json', query: 'https://freeipapi.com/api/json/{ip}' }
};
async function bridgeGeoIp(source, ip) {
  const t0 = Date.now();
  const s = IP_BRIDGE_SOURCES[source];
  if (source === 'opencagedata') return { ok: false, error: 'OpenCage 源需要 API key，BATCAVE 桥未配置，已跳过', error_kind: 'key_required', elapsed_ms: 0 };
  if (source === 'ipapi_com') return { ok: false, error: 'ip-api.com 免费层只支持明文 HTTP，BATCAVE 桥不代发明文请求', error_kind: 'source_disabled', elapsed_ms: 0 };
  if (!s) return { ok: false, error: '未知源: ' + source, error_kind: 'bad_input', elapsed_ms: 0 };
  if (ip && (!/^[0-9a-fA-F:.]{2,64}$/.test(ip))) return { ok: false, error: 'IP 字面量含非法字符', error_kind: 'bad_input', elapsed_ms: 0 };
  const target = ip ? s.query.replace('{ip}', encodeURIComponent(ip)) : s.self;
  try {
    const r = await fetchJson(target, 12000);
    if (r.status < 200 || r.status >= 300 || !r.data) {
      return { ok: false, error: '上游返回 HTTP ' + r.status, error_kind: 'http_error', http_status: r.status, elapsed_ms: Date.now() - t0 };
    }
    return {
      ok: true, source, upstream: r.data, http_status: r.status,
      elapsed_ms: Date.now() - t0,
      fields_note: 'BATCAVE 桥透传 ' + source + ' 原始 JSON；字段含义以该服务文档为准，本桥不做解释。'
    };
  } catch (e) {
    return { ok: false, error: '上游请求失败：' + e.message, error_kind: 'network', elapsed_ms: Date.now() - t0 };
  }
}
function privateNetHint(ip) {
  if (!ip) return { scope: null, note: null };
  return privateIp(ip)
    ? { scope: 'lan', note: '目标是私有/内网地址，路由结果只代表本地网络路径。' }
    : { scope: 'public', note: '目标是公网地址。' };
}
function parseTracert(text) {
  const hops = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(raw);
    if (!m) continue;
    const hop = parseInt(m[1], 10);
    const rest = m[2];
    if (hop < 1 || hop > 64) continue;
    const ipM = /((?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F]*:[0-9a-fA-F:]+)\s*$/.exec(rest.trim());
    const ip = ipM ? ipM[1] : '';
    const rtts = [];
    const rttRe = /(<\s*1|\d+)\s*ms/gi;
    let rm;
    while ((rm = rttRe.exec(rest))) rtts.push(rm[1].includes('<') ? 0.5 : parseFloat(rm[1]));
    if (!ip && !rtts.length) {
      hops.push({ hop, ip: '', hostname: '', rtts_ms: [], timed_out: true });
    } else {
      hops.push({ hop, ip, hostname: '', rtts_ms: rtts, timed_out: false });
    }
  }
  return hops;
}
async function bridgeTraceroute(req, res, url) {
  const host = String(url.searchParams.get('host') || '').trim();
  if (!/^[a-z0-9.:_-]{1,253}$/i.test(host) || /[\s;&|<>`$]/.test(host)) {
    return sendJSON(res, 400, { ok: false, error: '主机名校验失败', error_kind: 'bad_input' });
  }
  const maxHops = Math.min(Math.max(parseInt(url.searchParams.get('max_hops'), 10) || 20, 1), 30);
  const timeoutS = Math.min(Math.max(parseInt(url.searchParams.get('timeout'), 10) || 20, 1), 120);
  let targetIp = '';
  try { targetIp = (await dns.lookup(host)).address; } catch {}
  const isWin = process.platform === 'win32';
  const args = isWin ? ['-d', '-h', String(maxHops), '-w', '900', host] : ['-n', '-m', String(maxHops), '-w', '2', host];
  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    let child;
    try { child = spawn(isWin ? 'tracert' : 'traceroute', args, { windowsHide: true }); }
    catch (e) { return resolve({ code: -1, stdout: '', stderr: e.message }); }
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, (timeoutS + 5) * 1000);
    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('error', e => { clearTimeout(timer); resolve({ code: -1, stdout: out, stderr: e.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout: out, stderr: err }); });
    req.on('close', () => { try { child.kill(); } catch {} });
  });
  const hops = parseTracert(r.stdout);
  const reached = !!(targetIp && hops.some(h => h.ip === targetIp));
  const hint = privateNetHint(targetIp);
  await logSecurity('BRIDGE tracert ' + host + ' hops=' + hops.length);
  return sendJSON(res, 200, {
    ok: hops.length > 0, host, target_ip: targetIp || null, host_kind: net.isIP(host) ? 'ip' : 'name',
    hops, hop_count: hops.length, reached,
    elapsed_ms: Date.now() - t0, wall_clock_s: (Date.now() - t0) / 1000,
    max_hops: maxHops, per_hop_timeout_s: 0.9,
    command: isWin ? 'tracert' : 'traceroute', argv: args, shell: false,
    exit_code: r.code, stderr: (r.stderr || '').slice(0, 500),
    fabricated_hops: false,
    target_scope: hint.scope, target_scope_note: hint.note,
    note: '逐跳数据来自本机系统命令的真实输出解析；未做任何补造。'
  });
}
async function bridgePing(req, res, url) {
  const host = String(url.searchParams.get('host') || '').trim();
  if (!/^[a-z0-9.:_-]{1,253}$/i.test(host)) return sendJSON(res, 400, { ok: false, error: '主机名校验失败', error_kind: 'bad_input' });
  const count = Math.min(Math.max(parseInt(url.searchParams.get('count'), 10) || 4, 1), 20);
  const isWin = process.platform === 'win32';
  const args = isWin ? ['-n', String(count), '-w', '1000', host] : ['-c', String(count), '-W', '1', host];
  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    let child;
    try { child = spawn(isWin ? 'ping' : 'ping', args, { windowsHide: true }); }
    catch (e) { return resolve({ code: -1, stdout: '', stderr: e.message }); }
    let out = '', err = '';
    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('error', e => resolve({ code: -1, stdout: out, stderr: e.message }));
    child.on('close', code => resolve({ code, stdout: out, stderr: err }));
  });
  let targetIp = '';
  try { targetIp = (await dns.lookup(host)).address; } catch {}
  const text = r.stdout;
  const times = [];
  let tm;
  const re = /(?:时间|time)[=<]?\s*(\d+(?:\.\d+)?)\s*ms/gi;
  while ((tm = re.exec(text))) times.push(parseFloat(tm[1]));
  const lossM = /(\d+)%\s*(?:loss|丢失)/i.exec(text);
  const hint = privateNetHint(targetIp);
  return sendJSON(res, 200, {
    ok: r.code === 0, host, target_ip: targetIp || null, count,
    stats: {
      sent: count, received: times.length, loss_percent: lossM ? parseInt(lossM[1], 10) : null,
      min_ms: times.length ? Math.min(...times) : null,
      max_ms: times.length ? Math.max(...times) : null,
      avg_ms: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null
    },
    elapsed_ms: Date.now() - t0, exit_code: r.code,
    command: 'ping', argv: args, shell: false,
    stderr: (r.stderr || '').slice(0, 300), fabricated_stats: false,
    target_scope: hint.scope, target_scope_note: hint.note,
    note: '统计来自系统 ping 真实输出解析。'
  });
}
async function bridgeDns(req, res, url) {
  const host = String(url.searchParams.get('host') || '').trim();
  if (!/^[a-z0-9.:_-]{1,253}$/i.test(host)) return sendJSON(res, 400, { ok: false, error: '主机名校验失败', error_kind: 'bad_input' });
  try {
    const all = await dns.lookup(host, { all: true });
    return sendJSON(res, 200, {
      ok: all.length > 0, host, kind: net.isIP(host) ? 'ip' : 'name',
      addresses: all.map(a => ({ address: a.address, family: a.family })),
      family: all[0] ? all[0].family : null, Status: 0, Answer: all.map(a => a.address),
      note: '使用 Node dns.lookup（系统解析器）。'
    });
  } catch (e) {
    return sendJSON(res, 200, { ok: false, host, error: '解析失败：' + e.message, error_kind: 'dns_error', addresses: [], Answer: [] });
  }
}
function bridgeIface(req) {
  const ifaces = os.networkInterfaces();
  const count = Object.keys(ifaces).length;
  const loopback = Object.values(ifaces).some(list => (list || []).some(a => a.internal && (a.family === 'IPv4' || a.family === 4)));
  return {
    ok: true, interface_count: count, ipv4_loopback_present: loopback,
    bind_address: '127.0.0.1', port: PORT, bind_is_loopback: true, bind_check_reason: null,
    redacted_fields: ['hostname', 'mac', 'interface_names', 'lan_addresses'],
    note: '按 geo-windows 契约刻意不返回接口名/MAC/内网地址，避免设备指纹。'
  };
}

function proxyBlockedPage(verdict, target) {
  const items = verdict.reasons
    .filter(r => r.severity === 'block')
    .map(r => '<li><code>' + escapeHtml(r.code) + '</code> ' + escapeHtml(r.message) + '</li>')
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GOTHAM NET // 已阻止</title><style>
html,body{margin:0;min-height:100%;background:#04080b;color:#cfeff6;font-family:ui-monospace,Consolas,monospace}
.wrap{max-width:780px;margin:0 auto;padding:11vh 28px}
h1{color:#ff4f78;font-size:22px;letter-spacing:.1em;margin:0 0 14px}
.bar{height:2px;background:linear-gradient(90deg,#ff4f78,#38e8ff);margin:16px 0 22px}
p{line-height:1.7;color:#8fb4c2}code{color:#ffba46;word-break:break-all}
ul{padding-left:20px}li{line-height:1.8;color:#c8e4ec;margin:6px 0}
.badge{display:inline-block;border:1px solid #ff4f78;color:#ff4f78;padding:3px 8px;font-size:11px;letter-spacing:.14em}
.hint{border-left:2px solid #38e8ff;padding:8px 12px;margin-top:20px;color:#9fb9c4;font-size:13px}
</style></head><body><div class="wrap"><span class="badge">SECURITY GATE</span>
<h1>访问已被安全策略阻止</h1><div class="bar"></div>
<p>目标：<code>${escapeHtml(target || '')}</code></p>
<ul>${items}</ul>
<div class="hint">请返回 Batcave 浏览器，阅读阻断原因并明确授权后再进入。授权仅在当前会话内对该站点有效。</div>
<script>try{parent.postMessage({__batcave:'blocked'},'*')}catch(e){}</script>
</div></body></html>`;
}

async function fetchCapped(url, options, limit = 22 * 1024 * 1024) {
  const r = await fetch(url, options);
  const len = Number(r.headers.get('content-length') || 0);
  if (len && len > limit) throw new Error('目标内容超过 22MB 限制');
  const reader = r.body?.getReader();
  if (!reader) return { res: r, buf: Buffer.alloc(0) };
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      try { await reader.cancel(); } catch {}
      throw new Error('目标内容超过 22MB 限制');
    }
    chunks.push(Buffer.from(value));
  }
  return { res: r, buf: Buffer.concat(chunks) };
}

async function fetchCappedDeadline(url, options, ms = 12000, limit = 22 * 1024 * 1024) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const work = fetchCapped(url, { ...options, signal: ac.signal }, limit);
  work.catch(() => {});
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => setTimeout(() => reject(new Error('上游响应超时（' + Math.round(ms / 1000) + 's），已放弃等待')), ms + 800))
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function proxyErrorPage(message, target) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GOTHAM NET // 连接失败</title><style>
html,body{margin:0;height:100%;background:#04080b;color:#cfeff6;font-family:ui-monospace,Consolas,monospace}
.wrap{max-width:760px;margin:0 auto;padding:12vh 28px}
h1{color:#38e8ff;font-size:22px;letter-spacing:.12em;margin:0 0 18px}
.bar{height:2px;background:linear-gradient(90deg,#38e8ff,#ff4f78);margin:18px 0}
p{line-height:1.7;color:#8fb4c2}
code{color:#ffba46;word-break:break-all}
.badge{display:inline-block;border:1px solid #ff4f78;color:#ff4f78;padding:3px 8px;font-size:11px;letter-spacing:.14em}
</style></head><body><div class="wrap"><span class="badge">SIGNAL LOST</span>
<h1>无法建立外部连接</h1><div class="bar"></div>
<p>请求目标：<code>${escapeHtml(target || '')}</code></p>
<p>${escapeHtml(message || '未知错误')}</p>
<p>检查网络连接，或尝试切换阅读模式 / 在系统浏览器中打开。</p>
<script>try{parent.postMessage({__batcave:'err'},'*')}catch(e){}</script>
</div></body></html>`;
}

function injectBaseAndSanitize(html, baseHref, mode) {
  let out = String(html);
  out = out.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');
  out = out.replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, '');
  out = out.replace(/<base[^>]*>/gi, '');
  if (mode === 'reader') {
    out = out
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<link\b[^>]*>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<object[\s\S]*?<\/object>/gi, '')
      .replace(/<embed\b[^>]*>/gi, '')
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      .replace(/javascript:/gi, '');
  }
  const base = `<base href="${escapeHtml(baseHref)}">`;
  const readerCss = mode === 'reader' ? `<style>
    :root{color-scheme:dark}
    body{background:#05090d!important;color:#d3edf3!important;font-family:ui-sans-serif,system-ui,"Segoe UI","Microsoft YaHei",sans-serif!important;line-height:1.75!important;max-width:900px;margin:0 auto!important;padding:34px 26px 80px!important;font-size:16px!important}
    a{color:#38e8ff!important}img,video{max-width:100%!important;height:auto!important;border-radius:3px}
    h1,h2,h3{color:#e9fbff!important;letter-spacing:.02em}pre,code{font-family:ui-monospace,Consolas,monospace!important;background:#0a141a!important;color:#bdf4ff!important}
    pre{padding:14px!important;overflow:auto;border:1px solid #12313c}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #1c3a45;padding:6px}
    blockquote{border-left:2px solid #38e8ff;margin-left:0;padding-left:16px;color:#8fb4c2}
    header,footer,nav,aside{opacity:.92}
  </style>` : '';
  const navBridge = `<script>
(function(){
  function send(url){ try { parent.postMessage({__batcave:'nav',url:url},'*'); } catch(e){} }
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if(!a) return;
    var href = a.getAttribute('href') || '';
    if(!href || href.charAt(0) === '#' || /^(javascript|mailto|tel|data|blob|about):/i.test(href)) return;
    e.preventDefault();
    try { send(new URL(href, document.baseURI).href); } catch(err){}
  }, true);
  document.addEventListener('submit', function(e){
    var f = e.target;
    if(!f || String(f.tagName).toLowerCase() !== 'form') return;
    var method = String(f.getAttribute('method') || 'get').toLowerCase();
    if(method !== 'get') return;
    e.preventDefault();
    try {
      var u = new URL(f.getAttribute('action') || document.baseURI, document.baseURI);
      var fd = new FormData(f);
      fd.forEach(function(v,k){ if(typeof v === 'string') u.searchParams.append(k,v); });
      send(u.href);
    } catch(err){}
  }, true);
})();
<\/script>`;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${base}${readerCss}`);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1><head>${base}${readerCss}</head>`);
  } else {
    out = `<!doctype html><html><head><meta charset="utf-8">${base}${readerCss}</head><body>${out}</body></html>`;
  }
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, () => navBridge + '</body>');
  else out += navBridge;
  return out;
}

async function handleProxy(req, res, u) {
  const target = u.searchParams.get('url');
  const mode = u.searchParams.get('mode') === 'reader' ? 'reader' : 'iframe';
  const incognito = u.searchParams.get('incog') === '1';
  const grant = u.searchParams.get('grant') || '';
  if (!target) return sendJSON(res, 400, { error: 'missing url' });
  let url;
  try { url = new URL(target); } catch { return sendJSON(res, 400, { error: 'invalid url' }); }
  if (!/^https?:$/.test(url.protocol)) return sendJSON(res, 400, { error: 'only http/https' });
  url.hash = '';
  try {
    const verdict = await assessUrl(url);
    const authorized = verifyGrant(url.origin, grant);
    if (verdict.level === 'block' && !authorized) {
      await logSecurity('BLOCK proxy ' + url.origin + ' codes=' + verdict.reasons.map(r => r.code).join(','));
      res.writeHead(403, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox allow-scripts'
      });
      return res.end(proxyBlockedPage(verdict, target));
    }
    const { res: upstream, buf } = await fetchCappedDeadline(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 BatcaveOS/3.0',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'cache-control': incognito ? 'no-store' : 'no-cache',
        ...(incognito ? { 'dnt': '1', 'sec-gpc': '1' } : {})
      }
    }, 15000);
    const ctype = upstream.headers.get('content-type') || 'application/octet-stream';
    let finalUrl = url;
    try { finalUrl = new URL(upstream.url); } catch {}
    if (!ALLOW_LOCAL_NET && finalUrl.origin !== url.origin) {
      const fin = await assessUrl(finalUrl);
      if (fin.level === 'block' && !verifyGrant(finalUrl.origin, grant)) {
        throw new Error('重定向目标被安全策略阻止：' + fin.reasons.filter(r => r.severity === 'block').map(r => r.message).join('；'));
      }
    }
    if (/text\/html|application\/xhtml\+xml/i.test(ctype)) {
      let html = buf.toString('utf8');
      html = injectBaseAndSanitize(html, finalUrl.origin + finalUrl.pathname + finalUrl.search, mode);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "sandbox allow-scripts allow-forms allow-popups allow-downloads allow-modals; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; style-src * 'unsafe-inline'; img-src * data: blob:; font-src * data:; media-src * data: blob:; connect-src *;"
      });
      res.end(html);
      return;
    }
    const headers = {
      'Content-Type': ctype,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox'
    };
    res.writeHead(200, headers);
    res.end(buf);
  } catch (e) {
    const html = proxyErrorPage(e.message, target);
    res.writeHead(502, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': 'sandbox'
    });
    res.end(html);
  }
}

async function handleFS(req, res, u, action) {
  try {
    if (action === 'list') {
      const vp = u.searchParams.get('path') || '/';
      const entries = await home.list(vp);
      return sendJSON(res, 200, { path: home.normalizeVirtual(vp), entries });
    }
    if (action === 'read') {
      const vp = u.searchParams.get('path') || '/';
      const data = await home.readText(vp);
      return sendJSON(res, 200, { path: home.normalizeVirtual(vp), ...data });
    }
    if (action === 'raw') {
      const vp = u.searchParams.get('path') || '/';
      const file = home.abs(vp);
      const st = await fsp.stat(file);
      if (!st.isFile()) throw new Error('不是文件: ' + vp);
      const ext = path.extname(vp).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      const inlineSafe = /^\.(png|jpe?g|gif|webp|bmp|avif|ico|woff2?|ttf|txt|md|mp4|m4v|webm|mkv|mov|mp3|wav|ogg|m4a|flac|aac)$/.test(ext);
      let start = 0;
      let end = Math.max(0, st.size - 1);
      let status = 200;
      const range = String(req.headers.range || '').trim();
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!m) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + st.size, 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        if (m[1] === '' && m[2] === '') {
          res.writeHead(416, { 'Content-Range': 'bytes */' + st.size, 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        if (m[1] === '') {
          start = Math.max(0, st.size - Number(m[2]));
          end = st.size - 1;
        } else {
          start = Number(m[1]);
          end = m[2] === '' ? st.size - 1 : Number(m[2]);
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= st.size) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + st.size, 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        end = Math.min(end, st.size - 1);
        status = 206;
      }
      const length = st.size === 0 ? 0 : end - start + 1;
      const headers = {
        'Content-Type': type,
        'Content-Length': length,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': 'sandbox',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': (u.searchParams.get('download') === '1' || !inlineSafe)
          ? `attachment; filename="${String(path.basename(vp)).replace(/[^\w.\-]+/g, '_')}"`
          : 'inline'
      };
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
      res.writeHead(status, headers);
      if (req.method === 'HEAD' || st.size === 0) return res.end();
      const stream = fs.createReadStream(file, { start, end });
      stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.destroy(); });
      return stream.pipe(res);
    }
    if (action === 'complete') {
      const prefix = u.searchParams.get('q') || '';
      const cwd = u.searchParams.get('cwd') || '/';
      const items = await home.complete(prefix, cwd);
      return sendJSON(res, 200, { items });
    }
    if (req.method !== 'POST') return sendJSON(res, 405, { error: 'method not allowed' });
    if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
    if (action === 'write') {
      const body = await readJSON(req, 3 * 1024 * 1024);
      const vp = body.path;
      const st = await home.writeText(vp, String(body.content ?? ''), !!body.append);
      return sendJSON(res, 200, { ok: true, path: home.normalizeVirtual(vp), ...st });
    }
    if (action === 'mkdir') {
      const body = await readJSON(req);
      await home.mkdir(body.path);
      return sendJSON(res, 200, { ok: true, path: home.normalizeVirtual(body.path) });
    }
    if (action === 'remove') {
      const body = await readJSON(req);
      await home.remove(body.path);
      return sendJSON(res, 200, { ok: true });
    }
    if (action === 'rename') {
      const body = await readJSON(req);
      await home.rename(body.from, body.to);
      return sendJSON(res, 200, { ok: true, path: home.normalizeVirtual(body.to) });
    }
    if (action === 'upload') {
      if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
      const rawPath = req.headers['x-batcave-path'];
      let vp;
      try { vp = decodeURIComponent(rawPath || '/Uploads/file'); } catch { throw new Error('bad path header'); }
      const buf = await readBody(req, 42 * 1024 * 1024);
      const st = await home.writeBuffer(vp, buf);
      return sendJSON(res, 200, { ok: true, path: home.normalizeVirtual(vp), ...st });
    }
    return sendJSON(res, 404, { error: 'unknown fs action' });
  } catch (e) {
    const status = /过大|large|payload/i.test(e.message) ? 413 : 400;
    return sendJSON(res, status, { error: e.message });
  }
}

async function resolveCd({ mode, cwd, target }) {
  const info = bridge.getInfo();
  const m = info.modes.find(x => x.id === mode);
  if (!m) throw new Error('Shell mode unavailable');
  const t = String(target || '').trim().replace(/^["']|["']$/g, '');
  const isWinMode = info.isWin && (mode === 'powershell' || mode === 'cmd' || mode === 'gitbash');
  if (isWinMode) {
    let dest;
    if (!t || t === '~') dest = HOME_ROOT;
    else if (mode === 'gitbash' && /^\/[a-zA-Z]\//.test(t)) {
      dest = t.replace(/^\/([a-zA-Z])\//, (_, d) => d.toUpperCase() + ':\\').replace(/\//g, '\\');
    } else {
      dest = path.win32.resolve(cwd || HOME_ROOT, t);
    }
    if (!fs.existsSync(dest) || !fs.statSync(dest).isDirectory()) throw new Error('目录不存在: ' + dest);
    return dest;
  }
  const base = cwd && cwd.startsWith('/') ? cwd : (HOME_UNIX || HOME_ROOT);
  let dest;
  if (!t || t === '~') dest = HOME_UNIX || HOME_ROOT;
  else dest = path.posix.resolve(base, t);
  if (IS_LINUX) {
    if (!fs.existsSync(dest) || !fs.statSync(dest).isDirectory()) throw new Error('目录不存在: ' + dest);
    return dest;
  }
  let ok = false;
  await bridge.exec({
    mode, cwd: base, timeoutMs: 15000,
    cmd: 'test -d ' + bridge.quoteSh(dest),
    onData: () => {}
  }).then(r => { ok = r.code === 0; });
  if (!ok) throw new Error('目录不存在: ' + dest);
  return dest;
}

function launchBrowser(url) {
  try {
    if (IS_WIN) {
      if (KIOSK) {
        const cands = [
          path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')
        ];
        const exe = cands.find(p => fs.existsSync(p));
        if (exe) {
          spawn(exe, ['--app=' + url, '--start-fullscreen', '--user-data-dir=' + path.join(DATA_DIR, 'kiosk')], {
            detached: true, stdio: 'ignore', windowsHide: false
          }).unref();
          return true;
        }
      }
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return true;
    }
    if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
      return true;
    }
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel === '/geo' || rel === '/geo/') rel = '/geo/index.html';
  let hp;
  try { hp = path.join(PUBLIC, decodeURIComponent(rel)); }
  catch { return sendJSON(res, 400, { error: 'bad path' }); }
  const pub = path.resolve(PUBLIC);
  if (!path.resolve(hp).startsWith(pub + path.sep)) return sendJSON(res, 404, { error: 'not found' });
  let data;
  try { data = fs.readFileSync(hp); }
  catch { return sendJSON(res, 404, { error: 'not found' }); }
  const ext = path.extname(hp).toLowerCase();
  if (path.basename(hp) === 'index.html' && rel === '/index.html') {
    const html = data.toString('utf8').replace('__BATCAVE_BOOTSTRAP__', JSON.stringify(BOOT).replace(/</g, '\\u003c'));
    res.writeHead(200, {
      'Content-Type': MIME['.html'],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; media-src 'self' data: blob: https: http:; connect-src 'self' https: http: http://127.0.0.1:* http://localhost:*; frame-src 'self' blob: http://127.0.0.1:* http://localhost:*; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'"
    });
    return res.end(html);
  }
  const isGeo = rel === '/geo' || rel.indexOf('/geo/') === 0;
  if (isGeo && /\.html?$/i.test(hp)) {
    res.writeHead(200, {
      'Content-Type': MIME['.html'],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; media-src 'self' data: blob: https: http:; connect-src 'self' https: http: http://127.0.0.1:* http://localhost:*; frame-src 'self'; font-src 'self' data:; object-src 'none'"
    });
    return res.end(data);
  }
  const isAsset = /\.(png|jpe?g|webp|gif|svg|woff2?|ttf|ico)$/i.test(hp);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': isAsset ? 'public, max-age=86400' : 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(data);
}

async function buildBoot() {
  const info = bridge.getInfo();
  HOME_UNIX = IS_LINUX ? HOME_ROOT : (info.wsl ? bridge.toWslPath(HOME_ROOT) : null);
  BOOT = {
    version: VERSION,
    codename: CODENAME,
    token: TOKEN,
    platform: IS_WIN ? 'windows' : IS_LINUX ? 'linux' : process.platform,
    hostname: os.hostname(),
    user: os.userInfo().username,
    home: HOME_ROOT,
    homeUnix: HOME_UNIX,
    data: DATA_DIR,
    bridge: {
      linuxAvailable: info.linuxAvailable,
      wsl: info.wsl,
      modes: info.modes,
      defaultMode: info.defaultMode
    },
    paths: {
      wallpapers: ['skyline', 'emblem', 'cave']
    },
    startedAt: Date.now()
  };
  return BOOT;
}

async function createServer() {
  bridge.init();
  await home.init(HOME_ROOT);
  await update.init();
  appUpdates.init(DATA_DIR);
  releaseFeed.init(DATA_DIR);
  await buildBoot();

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`); }
    catch { return sendJSON(res, 400, { error: 'bad request' }); }
    const pathname = url.pathname;

    try {
      if (pathname === '/api/hello' && req.method === 'GET') {
        return sendJSON(res, 200, {
          ...BOOT,
          token: undefined,
          server: { version: VERSION, codename: CODENAME, pid: process.pid, node: process.version }
        });
      }

      /* geo-windows 桥接兼容端点（无 token；仅回环来源可读） */
      if (pathname.indexOf('/api/') === 0 && ['/api/health', '/api/traceroute', '/api/ping', '/api/dns', '/api/iface', '/api/geoip'].includes(pathname)) {
        if (req.method === 'OPTIONS') {
          if (!bridgeCors(req, res)) return sendJSON(res, 403, { error: 'origin_not_allowed' });
          res.writeHead(204); return res.end();
        }
        if (!bridgeCors(req, res)) return sendJSON(res, 403, { ok: false, error: '来源不在白名单', error_kind: 'origin_not_allowed' });
        if (pathname === '/api/health') return sendJSON(res, 200, bridgeHealth(req));
        if (pathname === '/api/traceroute') return bridgeTraceroute(req, res, url);
        if (pathname === '/api/ping') return bridgePing(req, res, url);
        if (pathname === '/api/dns') return bridgeDns(req, res, url);
        if (pathname === '/api/iface') return sendJSON(res, 200, bridgeIface(req));
        return sendJSON(res, 200, await bridgeGeoIp(url.searchParams.get('source') || 'ipwho_is', String(url.searchParams.get('ip') || '').trim()));
      }

      if (pathname === '/api/proxy' && req.method === 'GET') {
        return handleProxy(req, res, url);
      }

      if (pathname === '/api/urlcheck' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        let target;
        try { target = new URL(url.searchParams.get('url') || ''); }
        catch { return sendJSON(res, 400, { error: 'invalid url' }); }
        return sendJSON(res, 200, await assessUrl(target));
      }

      if (pathname === '/api/urlgrant' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req, 16 * 1024);
        if (body.acknowledge !== true) return sendJSON(res, 400, { error: '需要明确确认风险后才能授权' });
        let target;
        try { target = new URL(String(body.url || '')); }
        catch { return sendJSON(res, 400, { error: 'invalid url' }); }
        if (!/^https?:$/.test(target.protocol)) return sendJSON(res, 400, { error: 'only http/https' });
        const verdict = await assessUrl(target);
        if (verdict.level === 'safe') return sendJSON(res, 200, { ok: true, level: 'safe', grant: null, origin: target.origin });
        await logSecurity('GRANT ' + verdict.level + ' ' + target.origin + ' codes=' + verdict.reasons.map(r => r.code).join(','));
        return sendJSON(res, 200, {
          ok: true, level: verdict.level, origin: target.origin,
          reasons: verdict.reasons,
          ...makeGrant(target.origin)
        });
      }

      if (pathname === '/api/network/status' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await network.status());
      }

      if (pathname === '/api/network/wifi/scan' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const elevated = url.searchParams.get('elevated') === '1';
        return sendJSON(res, 200, await network.scanWifi({ elevated }));
      }

      if (pathname === '/api/network/wifi/connect' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req, 16 * 1024);
        return sendJSON(res, 200, await network.connectWifi({
          ssid: body.ssid, password: body.password, open: !!body.open, elevated: !!body.elevated
        }));
      }

      if (pathname === '/api/network/wifi/disconnect' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await network.disconnectWifi());
      }

      if (pathname === '/api/network/ethernet' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req, 16 * 1024);
        return sendJSON(res, 200, await network.ethernetAction({ name: body.name, action: body.action }));
      }

      if (pathname === '/api/network/open-settings' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req, 4 * 1024);
        const target = String(body.target || 'network');
        const allowed = { network: 'ms-settings:network', location: 'ms-settings:privacy-location', adapters: 'ncpa.cpl' };
        if (!allowed[target]) return sendJSON(res, 400, { error: 'unknown target' });
        return sendJSON(res, 200, network.openSettings(allowed[target]));
      }

      if (pathname === '/api/embedded/list' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await embedded.list(DATA_DIR));
      }

      if (pathname === '/api/embedded/start' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req, 8 * 1024);
        return sendJSON(res, 200, await embedded.start(String(body.id || ''), DATA_DIR));
      }

      if (pathname === '/api/embedded/stop' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req, 8 * 1024);
        return sendJSON(res, 200, await embedded.stop(String(body.id || '')));
      }

      if (pathname === '/api/embedded/update/status' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        try {
          return sendJSON(res, 200, await appUpdates.status(url.searchParams.get('app') || ''));
        } catch (e) {
          return sendJSON(res, e.status || 500, { ok: false, error: e.message });
        }
      }

      if (pathname === '/api/embedded/update/check' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        try {
          return sendJSON(res, 200, await appUpdates.check(url.searchParams.get('app') || '', url.searchParams.get('source') || 'github'));
        } catch (e) {
          return sendJSON(res, e.status || 502, { ok: false, error: e.message });
        }
      }

      if (pathname === '/api/embedded/update/apply' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req, 8 * 1024);
        try {
          return sendJSON(res, 202, appUpdates.startApply(body.app || '', body.source || 'github', body.version || ''));
        } catch (e) {
          return sendJSON(res, e.status || 500, { ok: false, error: e.message });
        }
      }

      if (pathname === '/api/embedded/update/job' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const job = appUpdates.getJob(url.searchParams.get('id') || '');
        if (!job) return sendJSON(res, 404, { error: 'no app update job' });
        return sendJSON(res, 200, job);
      }

      if (pathname === '/api/releases/feed' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        try {
          return sendJSON(res, 200, await releaseFeed.getFeed({ force: url.searchParams.get('force') === '1' }));
        } catch (e) {
          return sendJSON(res, 502, { ok: false, error: e.message });
        }
      }

      if (pathname === '/api/releases/check' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        try {
          return sendJSON(res, 200, await releaseFeed.getFeed({ force: true }));
        } catch (e) {
          return sendJSON(res, 502, { ok: false, error: e.message });
        }
      }

      if (pathname === '/api/releases/seen' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req, 32 * 1024);
        try {
          return sendJSON(res, 200, await releaseFeed.markSeen(body.ids));
        } catch (e) {
          return sendJSON(res, 500, { ok: false, error: e.message });
        }
      }

      if (pathname === '/api/apps/search' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await appsLib.search(url.searchParams.get('q') || ''));
      }

      if (pathname === '/api/apps/installed' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await appsLib.installed(url.searchParams.get('refresh') === '1'));
      }

      if (pathname === '/api/apps/upgrades' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await appsLib.upgrades(url.searchParams.get('refresh') === '1'));
      }

      if (pathname === '/api/apps/launch' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req, 16 * 1024);
        return sendJSON(res, 200, appsLib.launch({ mode: body.mode, target: body.target }));
      }

      if (pathname === '/api/apps/launchers' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await appsLib.launchers(url.searchParams.get('refresh') === '1'));
      }

      if (pathname === '/api/apps/essentials' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await appsLib.essentials(url.searchParams.get('refresh') === '1'));
      }

      if (pathname === '/api/apps/accelerators' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await appsLib.accelerators(url.searchParams.get('refresh') === '1'));
      }

      if (pathname === '/api/apps/accelerators/resolve' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await appsLib.resolveAccelerator(url.searchParams.get('id') || ''));
      }

      if (pathname === '/api/apps/uninstall' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req, 16 * 1024);
        return sendJSON(res, 200, await appsLib.uninstall(String(body.name || '')));
      }

      if (pathname === '/api/mail/providers' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, { ok: true, providers: mail.providers() });
      }

      if (pathname.startsWith('/api/mail/') && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const action = pathname.slice('/api/mail/'.length);
        try {
          if (action === 'login') {
            const body = await readJSON(req, 16 * 1024);
            return sendJSON(res, 200, await mail.login({ email: body.email, password: body.password, provider: body.provider }));
          }
          if (action === 'list') {
            const body = await readJSON(req, 8 * 1024);
            return sendJSON(res, 200, await mail.list({ session: body.session, folder: body.folder, limit: body.limit }));
          }
          if (action === 'read') {
            const body = await readJSON(req, 8 * 1024);
            return sendJSON(res, 200, await mail.read({ session: body.session, folder: body.folder, uid: body.uid }));
          }
          if (action === 'send') {
            const body = await readJSON(req, 512 * 1024);
            return sendJSON(res, 200, await mail.send({ session: body.session, to: body.to, subject: body.subject, text: body.text, html: body.html }));
          }
          if (action === 'logout') {
            const body = await readJSON(req, 4 * 1024);
            return sendJSON(res, 200, mail.logout({ session: body.session }));
          }
          return sendJSON(res, 404, { error: 'unknown mail action' });
        } catch (e) {
          return sendJSON(res, 400, { error: e.message || '邮件操作失败' });
        }
      }

      if (pathname === '/api/geo/ip' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await geoIpLookup(url.searchParams.get('q') || ''));
      }

      if (pathname === '/api/geo/timezone' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return handleTimezoneLookup(req, res, url);
      }

      if (pathname === '/api/geo/trace' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req, 8 * 1024);
        return handleGeoTrace(req, res, body);
      }

      if (pathname === '/api/geo/tile' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return handleGeoTile(req, res, url);
      }

      if (pathname === '/api/geo/wifi' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await geoWifiSignals(url.searchParams.get('elevated') === '1'));
      }

      if (pathname === '/api/stats' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await stats());
      }

      if (pathname === '/api/update/status' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, await update.status());
      }

      if (pathname === '/api/update/check' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        try {
          return sendJSON(res, 200, await update.check(url.searchParams.get('source') || 'github'));
        } catch (e) {
          return sendJSON(res, 502, { ok: false, error: e.message || 'update check failed' });
        }
      }

      if (pathname === '/api/update/apply' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req, 8 * 1024);
        try {
          return sendJSON(res, 202, update.startApply(body.source || 'github', body.version || ''));
        } catch (e) {
          return sendJSON(res, e.status || 500, { ok: false, error: e.message || 'update failed' });
        }
      }

      if (pathname === '/api/update/job' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const current = update.getJob(url.searchParams.get('id') || '');
        if (!current) return sendJSON(res, 404, { error: 'no update job' });
        return sendJSON(res, 200, current);
      }

      if (pathname === '/api/update/restart' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        return sendJSON(res, 200, update.restart());
      }

      if (pathname.startsWith('/api/fs/')) {
        const action = pathname.slice('/api/fs/'.length);
        return handleFS(req, res, url, action);
      }

      if (pathname === '/api/linux/status' && req.method === 'GET') {
        if (!tokenOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        if (LINUX_PROBE_CACHE.data && Date.now() - LINUX_PROBE_CACHE.at < 20000) {
          return sendJSON(res, 200, LINUX_PROBE_CACHE.data);
        }
        const info = bridge.getInfo();
        const data = {
          available: info.linuxAvailable,
          engine: IS_LINUX ? 'native' : info.wsl ? 'wsl' : null,
          distro: info.wsl || null,
          note: info.linuxAvailable ? null : 'Linux Core requires WSL2 or the Batcave ISO.'
        };
        LINUX_PROBE_CACHE = { at: Date.now(), data };
        return sendJSON(res, 200, data);
      }

      if (pathname === '/api/cd' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req);
        const cwd = await resolveCd({ mode: body.mode, cwd: body.cwd, target: body.target });
        return sendJSON(res, 200, { cwd });
      }

      if (pathname === '/api/exec' && req.method === 'POST') {
        if (!tokenOk(req) || !originOk(req)) return sendJSON(res, 403, { error: 'forbidden' });
        const body = await readJSON(req, 256 * 1024);
        const cmd = String(body.cmd || '').trim();
        if (!cmd) return sendJSON(res, 400, { error: 'empty command' });
        if (cmd.length > 8000) return sendJSON(res, 413, { error: 'command too long' });
        const mode = String(body.mode || bridge.getInfo().defaultMode);
        const m = bridge.getMode(mode);
        if (!m) return sendJSON(res, 400, { error: 'shell mode unavailable: ' + mode });
        const risky = bridge.isRisky(cmd);
        if (risky && !ALLOW_DESTRUCTIVE && req.headers['x-batcave-confirm'] !== '1') {
          return sendJSON(res, 409, { error: '需要二次确认', risky: true, reason: risky });
        }

        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
          'X-Content-Type-Options': 'nosniff'
        });
        res.flushHeaders?.();

        const sendEvent = (obj) => {
          if (res.writableEnded || res.destroyed) return;
          try { res.write(JSON.stringify(obj) + '\n'); } catch {}
        };
        const emit = (text) => sendEvent({ t: 'data', k: 'out', d: text });
        const words = cmd.split(/\s+/);
        const base = words[0].toLowerCase();
        try {
          const handled = await serveThemeCommand(base, words.slice(1), emit, sendEvent);
          if (handled) {
            sendEvent({ t: 'end', code: 0, duration: 0, mode, cwd: body.cwd || HOME_ROOT, themed: true });
            return res.end();
          }
        } catch (e) {
          emit(paint('batcave: ' + e.message + '\n', A.rose));
          sendEvent({ t: 'end', code: 1, duration: 0, mode, cwd: body.cwd || HOME_ROOT, themed: true });
          return res.end();
        }

        const cwd = await (async () => {
          try {
            if (IS_WIN && (mode === 'powershell' || mode === 'cmd' || mode === 'gitbash')) {
              const c = String(body.cwd || HOME_ROOT);
              return (fs.existsSync(c) && fs.statSync(c).isDirectory()) ? c : HOME_ROOT;
            }
            if (!IS_WIN && (mode === 'bash' || mode === 'cmd' || mode === 'pwsh')) {
              const c = String(body.cwd || HOME_ROOT);
              return (fs.existsSync(c) && fs.statSync(c).isDirectory()) ? c : HOME_ROOT;
            }
            return String(body.cwd || HOME_UNIX || HOME_ROOT);
          } catch { return HOME_ROOT; }
        })();

        sendEvent({ t: 'begin', mode, cwd });
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        const heartbeat = setInterval(() => sendEvent({ t: 'ping' }), 15000);
        let result;
        try {
          const info = bridge.getInfo();
          if (!info.linuxAvailable && !IS_LINUX && ['linux', 'bash'].includes(mode)) {
            throw new Error('Linux Core 离线。apt-get / sudo / Homebrew 需要 WSL2 或 Batcave ISO。');
          }
          result = await bridge.exec({
            mode, cmd, cwd,
            timeoutMs: 600000,
            signal: controller.signal,
            onData: (d, k) => sendEvent({ t: 'data', k: k || 'out', d })
          });
        } catch (e) {
          sendEvent({ t: 'data', k: 'err', d: 'batcave: ' + e.message + '\n' });
          result = { code: 1, duration: 0, timedOut: false, truncated: false };
        }
        clearInterval(heartbeat);
        if (result.code === 127 && /^brew\b/.test(cmd) && bridge.getInfo().linuxAvailable) {
          sendEvent({ t: 'data', k: 'err', d: paint('hint: Homebrew 未安装。运行 brew-setup 查看安装方法。\n', A.amber) });
        }
        sendEvent({
          t: 'end', code: result.code, duration: result.duration,
          timedOut: result.timedOut, truncated: result.truncated,
          mode, cwd
        });
        if (!res.writableEnded) res.end();
        return;
      }

      if (pathname.startsWith('/api/')) {
        return sendJSON(res, 404, { error: 'unknown api' });
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        return serveStatic(req, res, pathname);
      }

      return sendJSON(res, 405, { error: 'method not allowed' });
    } catch (e) {
      if (!res.headersSent) {
        sendJSON(res, e.status || 500, { error: e.message || 'internal error' });
      } else {
        try { res.end(); } catch {}
      }
    }
  });

  return server;
}

function banner(port) {
  const info = bridge.getInfo();
  const modeLine = info.modes.map(m => m.label + (m.available ? '' : ' [off]')).join(' · ');
  const linux = info.linuxAvailable
    ? paint(IS_LINUX ? 'ONLINE (native)' : 'ONLINE (WSL: ' + info.wsl + ')', A.mint)
    : paint('OFFLINE — ISO/WSL only', A.amber);
  return [
    '',
    paint('  ▄▄▄▄▄       ▄▄▄▄▄', A.cyan),
    paint(' ███████▄   ▄███████', A.cyan) + paint('   BATCAVE OS', A.white + A.bold) + paint('  //  ' + CODENAME, A.rose),
    paint(' █████████ █████████', A.cyan) + paint('   a nocturnal cyber desktop', A.gray),
    paint('  ▀███████ ███████▀', A.cyan),
    paint('    ▀█████ █████▀', A.cyan) + paint('     v' + VERSION + '  ·  real shell bridge', A.gray),
    paint('      ▀██ ██▀', A.cyan),
    '',
    '  ' + paint('URL    ', A.ice) + paint('http://' + HOST + ':' + port, A.cyan + A.bold),
    '  ' + paint('MODES  ', A.ice) + modeLine,
    '  ' + paint('LINUX  ', A.ice) + linux,
    '  ' + paint('HOME   ', A.ice) + HOME_ROOT,
    '  ' + paint('TOKEN  ', A.ice) + paint('session token armed (local only)', A.gray),
    '',
    paint('  真实终端已启用。危险命令需要二次确认。', A.gray),
    ''
  ].join('\n');
}

async function start(options = {}) {
  const parsed = { ...argv, ...options };
  let port = Number(options.port || PORT);
  const maxTries = 12;
  let server;
  for (let i = 0; i < maxTries; i++) {
    server = await createServer();
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => { server.off('listening', onListening); reject(err); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, HOST);
      });
      break;
    } catch (e) {
      if (e.code === 'EADDRINUSE' && !options.explicitPort && i < maxTries - 1) {
        port++;
        continue;
      }
      throw e;
    }
  }
  const url = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${port}/`;
  releaseFeed.startWatching();
  console.log(banner(port));
  process.on('exit', () => { try { embedded.stopAll(); } catch (e) { /* children already gone */ } });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  if (OPEN_BROWSER && parsed.open !== false) {
    const ok = launchBrowser(url);
    if (!ok) console.log(' 无法自动打开浏览器，请手动访问上方 URL。');
  }
  return { server, port, url };
}

if (require.main === module) {
  if (argv.help) {
    console.log(`BATCAVE OS ${VERSION} ${CODENAME}

Usage: node server.js [options]

  --port <n>            HTTP port (default 7777)
  --host <addr>         bind address (default 127.0.0.1)
  --no-open             do not open a browser
  --kiosk               try to open an app window / fullscreen
  --home <dir>          home directory exposed to the file manager
  --data <dir>          runtime data directory
  --allow-local-net     allow the web proxy to reach LAN/localhost
  --allow-destructive   skip the destructive-command confirmation gate
  --tui                 launch the terminal UI instead
  --version             print version
  --help                this help
`);
    process.exit(0);
  }
  if (argv.version) {
    console.log(VERSION + ' ' + CODENAME);
    process.exit(0);
  }
  if (argv.tui) {
    require('./bin/tui').run({ home: HOME_ROOT, data: DATA_DIR, version: VERSION });
  } else {
    start({ explicitPort: !!argv.port }).catch((e) => {
      console.error('[batcave] failed to start:', e.message);
      process.exit(1);
    });
  }
}

module.exports = { start, VERSION, CODENAME };