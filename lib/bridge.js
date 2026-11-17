'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { StringDecoder } = require('string_decoder');

const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

let INFO = null;

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function decodeMaybeUtf16(buf) {
  if (!buf || !buf.length) return '';
  try {
    if (buf.includes(0)) return buf.toString('utf16le').replace(/\0/g, '').replace(/^\uFEFF/, '');
  } catch {}
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function findExeIn(base, exe, depth) {
  try {
    if (fileExists(path.join(base, exe))) return base;
    if (depth <= 0) return null;
    for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const hit = findExeIn(path.join(base, ent.name), exe, depth - 1);
      if (hit) return hit;
    }
  } catch {}
  return null;
}

function collectToolDirs() {
  const dirs = [];
  const add = p => { if (p && isDir(p) && !dirs.includes(p)) dirs.push(p); };
  if (IS_WIN) {
    add(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Go', 'bin'));
    add(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Go', 'bin'));
    if (process.env.USERPROFILE) {
      add(path.join(process.env.USERPROFILE, '.cargo', 'bin'));
      add(path.join(process.env.USERPROFILE, 'scoop', 'shims'));
      try {
        fs.readdirSync(process.env.USERPROFILE)
          .filter(n => /^Ruby\d/i.test(n))
          .forEach(n => add(path.join(process.env.USERPROFILE, n, 'bin')));
      } catch {}
    }
    if (process.env.ProgramData) add(path.join(process.env.ProgramData, 'chocolatey', 'bin'));
    try {
      fs.readdirSync('C:\\')
        .filter(n => /^Ruby\d/i.test(n))
        .forEach(n => add(path.join('C:\\', n, 'bin')));
    } catch {}
    if (process.env.LOCALAPPDATA) {
      const pkgs = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
      try {
        const names = fs.readdirSync(pkgs);
        names.filter(n => /^PHP\.PHP/i.test(n)).forEach(n => {
          const hit = findExeIn(path.join(pkgs, n), 'php.exe', 2);
          if (hit) add(hit);
        });
        names.filter(n => /^RubyInstallerTeam\.Ruby/i.test(n)).forEach(n => {
          const hit = findExeIn(path.join(pkgs, n), 'ruby.exe', 3);
          if (hit) add(hit);
        });
      } catch {}
    }
    if (process.env.LOCALAPPDATA) add(path.join(process.env.LOCALAPPDATA, 'Programs', 'PHP'));
  } else {
    ['/usr/local/go/bin', '/usr/local/bin', '/opt/homebrew/bin',
      path.join(process.env.HOME || '', '.cargo', 'bin'),
      path.join(process.env.HOME || '', '.local', 'bin')].forEach(add);
  }
  return dirs;
}

let EXTRA_PATH = [];
function ensureToolPath() {
  const have = new Set(String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(s => s.toLowerCase()));
  const add = [];
  for (const d of collectToolDirs()) {
    if (have.has(d.toLowerCase())) continue;
    have.add(d.toLowerCase());
    add.push(d);
  }
  if (!add.length) return;
  EXTRA_PATH = add;
  process.env.PATH = add.concat(process.env.PATH ? [process.env.PATH] : []).join(path.delimiter);
}

function findGitBash() {
  const cands = [];
  if (process.env.BATCAVE_GIT_BASH) cands.push(process.env.BATCAVE_GIT_BASH);
  if (process.env.USERPROFILE) {
    cands.push(path.join(process.env.USERPROFILE, '.qoder-cn', 'bin', 'git', 'bin', 'bash.exe'));
    cands.push(path.join(process.env.USERPROFILE, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'));
  }
  if (process.env.LOCALAPPDATA) {
    cands.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  }
  cands.push('C:\\Program Files\\Git\\bin\\bash.exe');
  cands.push('C:\\Program Files (x86)\\Git\\bin\\bash.exe');
  return cands.find(fileExists) || null;
}

function findPwsh() {
  if (IS_WIN) {
    const cands = [
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    ];
    return cands.find(fileExists) || null;
  }
  const r = spawnSync('bash', ['-lc', 'command -v pwsh'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function detectWsl() {
  if (!IS_WIN) return null;
  try {
    const r = spawnSync('wsl.exe', ['-l', '-q'], {
      encoding: 'buffer', timeout: 3500, windowsHide: true
    });
    if (r.status !== 0 || !r.stdout) return null;
    const out = decodeMaybeUtf16(r.stdout);
    const names = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return names.length ? names[0] : null;
  } catch {
    return null;
  }
}

function toWslPath(winPath) {
  if (!winPath) return null;
  const abs = path.win32.resolve(winPath);
  const m = /^([A-Za-z]):\\(.*)$/.exec(abs);
  if (!m) return null;
  const rest = m[2].split('\\').filter(Boolean).map(encodeURIComponent).join('/');
  return '/mnt/' + m[1].toLowerCase() + '/' + rest;
}

function quoteSh(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function init() {
  ensureToolPath();
  const gitBash = IS_WIN ? findGitBash() : null;
  const pwsh = findPwsh();
  const wsl = detectWsl();
  const modes = [];

  if (IS_LINUX) {
    modes.push({ id: 'bash', label: 'BASH', kind: 'linux', available: true });
    modes.push({ id: 'cmd', label: 'CMD COMPAT', kind: 'windows', available: true, note: '兼容层' });
    if (pwsh) modes.push({ id: 'pwsh', label: 'POWERSHELL', kind: 'windows', available: true });
    if (gitBash) modes.push({ id: 'gitbash', label: 'GIT BASH', kind: 'unix', available: true });
  } else if (IS_WIN) {
    modes.push({ id: 'powershell', label: 'POWERSHELL', kind: 'windows', available: true });
    modes.push({ id: 'cmd', label: 'CMD', kind: 'windows', available: true });
    if (gitBash) modes.push({ id: 'gitbash', label: 'GIT BASH', kind: 'unix', available: true, note: '真实 Unix 工具' });
    if (wsl) modes.push({ id: 'linux', label: 'LINUX CORE', kind: 'linux', available: true, note: wsl });
  } else {
    modes.push({ id: 'bash', label: 'SHELL', kind: 'unix', available: true });
  }

  let defaultMode;
  if (IS_LINUX) defaultMode = 'bash';
  else if (wsl) defaultMode = 'linux';
  else if (gitBash) defaultMode = 'gitbash';
  else defaultMode = 'powershell';

  INFO = {
    platform: process.platform,
    isWin: IS_WIN,
    isLinux: IS_LINUX,
    gitBash,
    pwsh,
    wsl,
    linuxAvailable: IS_LINUX || !!wsl,
    extraPath: EXTRA_PATH,
    modes,
    defaultMode,
    homeUnixOnWindows: wsl && process.env.HOME ? null : null
  };
  return INFO;
}

function getInfo() {
  return INFO || init();
}

function getMode(id) {
  return getInfo().modes.find(m => m.id === id && m.available) || null;
}

function isRisky(cmd) {
  const s = String(cmd || '').trim().toLowerCase();
  if (!s) return null;
  const checks = [
    { reason: '磁盘格式化 / 分区操作', re: /(^|\s)(format|diskpart|mkfs(\.\w+)?|wipefs|fdisk|parted|mkswap)(\s|$)/ },
    { reason: '删除根目录或磁盘数据', re: /(rm\s+(-[^\s]*\s+)*\/\s*$|rm\s+-rf\s+\/(\s|$)|del\s+\/[fsq].*[a-z]:\\\s*$|rd\s+\/s.*[a-z]:\\\s*$)/ },
    { reason: '写入裸设备', re: /\bdd\b[^\n]*\bof=\/dev\// },
    { reason: '关机 / 重启 / 睡眠', re: /(^|\s)(shutdown|reboot|halt|poweroff|init\s+0|Restart-Computer|Stop-Computer)(\s|$)/i },
    { reason: '修改启动配置 / 系统恢复', re: /(bcdedit|bootrec|vssadmin\s+delete|sfc\s+\/scannow|chkdsk\s+\/[fr])/i },
    { reason: '注册表 / 账户 / 所有权变更', re: /(reg\s+delete|net\s+user|takeown|icacls\s+[a-z]:\\|userdel|passwd\s+root|visudo)/i },
    { reason: '递归权限 / 所有权破坏', re: /(chmod\s+-R\s+0|chown\s+-R\s+[^\s]+\s+\/(\s|$)|attrib\s+.*[a-z]:\\)/i }
  ];
  for (const c of checks) if (c.re.test(s)) return c.reason;
  return null;
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (IS_WIN) {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch { try { child.kill('SIGKILL'); } catch {} }
    }
  } catch {}
}

function decodeChunk(decoder, chunk) {
  return decoder.write(chunk);
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

function tokenizeLoose(s) {
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q) q = null; else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

async function exec(opts) {
  const { mode, cmd, cwd, timeoutMs = 600000, onData = () => {}, signal = null } = opts;
  const info = getInfo();
  const m = getMode(mode);
  if (!m) throw new Error('Shell mode unavailable: ' + mode);

  const start = Date.now();
  let spec;

  if (m.id === 'cmd' && IS_LINUX) {
    return execCmdCompat({ cmd, cwd, start, onData, timeoutMs, signal });
  }

  if (m.id === 'linux') {
    if (IS_LINUX) {
      spec = {
        file: '/bin/bash',
        args: ['-lc', cmd],
        options: {
          cwd,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            FORCE_COLOR: '1',
            CLICOLOR_FORCE: '1',
            GIT_PAGER: 'cat',
            PAGER: 'cat',
            DEBIAN_FRONTEND: 'noninteractive',
            BATCAVE: '1'
          },
          detached: true
        }
      };
    } else if (info.wsl) {
      const wrapped = [
        'export TERM=xterm-256color FORCE_COLOR=1 CLICOLOR_FORCE=1 GIT_PAGER=cat PAGER=cat DEBIAN_FRONTEND=noninteractive BATCAVE=1;',
        'cd ' + quoteSh(cwd) + ' 2>/dev/null || { printf "batcave: 目录不存在: %s\\n" ' + quoteSh(cwd) + '; exit 1; };',
        cmd
      ].join(' ');
      spec = {
        file: 'wsl.exe',
        args: ['-d', info.wsl, '--', 'bash', '-lc', wrapped],
        options: { windowsHide: true }
      };
    } else {
      throw new Error('Linux Core 未安装：apt-get/sudo/Homebrew 需要 WSL2 或 Batcave ISO。');
    }
  } else if (m.id === 'bash') {
    if (IS_LINUX) {
      spec = {
        file: '/bin/bash',
        args: ['-lc', cmd],
        options: {
          cwd,
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            FORCE_COLOR: '1',
            CLICOLOR_FORCE: '1',
            GIT_PAGER: 'cat',
            PAGER: 'cat',
            BATCAVE: '1'
          },
          detached: true
        }
      };
    } else {
      throw new Error('BASH 仅适用于 Linux 与 ISO。Windows 请使用 GIT BASH。');
    }
  } else if (m.id === 'gitbash') {
    if (!info.gitBash) throw new Error('Git Bash 未安装。');
    spec = {
      file: info.gitBash,
      args: ['-lc', cmd],
      options: {
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          FORCE_COLOR: '1',
          CLICOLOR_FORCE: '1',
          GIT_PAGER: 'cat',
          PAGER: 'cat',
          CHERE_INVOKING: '1',
          BATCAVE: '1'
        }
      }
    };
  } else if (m.id === 'cmd') {
    spec = {
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', 'chcp 65001>nul & ' + cmd],
      options: { cwd, windowsHide: true }
    };
  } else if (m.id === 'powershell' || m.id === 'pwsh') {
    if (IS_WIN && m.id === 'powershell') {
      const exe = info.pwsh || 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
      const psCmd = "$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; " + cmd;
      spec = {
        file: exe,
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', psCmd],
        options: { cwd, windowsHide: true }
      };
    } else if (info.pwsh) {
      const psCmd = "$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; " + cmd;
      spec = {
        file: info.pwsh,
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', psCmd],
        options: { cwd }
      };
    } else {
      throw new Error('PowerShell 未安装。');
    }
  } else {
    throw new Error('Unsupported shell mode.');
  }

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(spec.file, spec.args, { ...spec.options, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      onData('batcave: 无法启动进程: ' + e.message + '\n', 'err');
      return resolve({ code: -1, duration: Date.now() - start, timedOut: false, truncated: false });
    }

    const outDec = new StringDecoder('utf8');
    const errDec = new StringDecoder('utf8');
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let exitTimer = null;
    const LIMIT = 4 * 1024 * 1024;

    const emit = (s, kind) => {
      if (!s) return;
      bytes += Buffer.byteLength(s);
      if (bytes <= LIMIT) onData(s, kind);
      else if (!truncated) {
        truncated = true;
        onData('\n[batcave] 输出超过 4MB，后续输出已截断。\n', 'err');
      }
    };

    child.stdout.on('data', (b) => emit(decodeChunk(outDec, b), 'out'));
    child.stderr.on('data', (b) => emit(decodeChunk(errDec, b), 'err'));

    const timer = setTimeout(() => {
      timedOut = true;
      emit('\n[batcave] 命令执行超时（' + Math.round(timeoutMs / 1000) + 's），已终止。\n', 'err');
      killTree(child);
    }, timeoutMs);

    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      emit('\n[batcave] 命令已被终止。\n', 'err');
      killTree(child);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    const done = (code, sig) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(exitTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      try { child.stdout.destroy(); child.stderr.destroy(); } catch {}
      emit(outDec.end(), 'out');
      emit(errDec.end(), 'err');
      resolve({ code: aborted ? 130 : (code === null ? -1 : code), signal: sig || null, duration: Date.now() - start, timedOut, aborted, truncated });
    };

    child.on('error', (err) => {
      emit('batcave: ' + err.message + '\n', 'err');
      done(-1, null);
    });
    child.on('exit', (code, sig) => {
      exitTimer = setTimeout(() => done(code, sig), 250);
    });
    child.on('close', done);
  });
}

async function execCmdCompat({ cmd, cwd, start, onData, timeoutMs, signal = null }) {
  const parts = tokenizeLoose(cmd);
  const name = (parts.shift() || '').toLowerCase();
  const args = parts;
  const fix = (s) => s.replace(/\\/g, '/');

  let bash = null;
  const pathArgs = args.filter(a => !a.startsWith('/')).map(fix);
  switch (name) {
    case 'dir': {
      let flags = '-la';
      if (args.includes('/b')) flags = '-1';
      const targets = pathArgs.map(quoteSh);
      bash = 'ls ' + flags + (targets.length ? ' ' + targets.join(' ') : '');
      break;
    }
    case 'copy': bash = 'cp ' + pathArgs.map(quoteSh).join(' '); break;
    case 'move': bash = 'mv ' + pathArgs.map(quoteSh).join(' '); break;
    case 'ren': case 'rename': bash = 'mv ' + pathArgs.map(quoteSh).join(' '); break;
    case 'del': case 'erase': bash = 'rm -f ' + pathArgs.map(quoteSh).join(' '); break;
    case 'md': case 'mkdir': bash = 'mkdir -p ' + pathArgs.map(quoteSh).join(' '); break;
    case 'rd': case 'rmdir': bash = 'rm -r ' + pathArgs.map(quoteSh).join(' '); break;
    case 'type': bash = 'cat ' + pathArgs.map(quoteSh).join(' '); break;
    case 'where': bash = 'which -a ' + pathArgs.map(quoteSh).join(' '); break;
    case 'findstr': bash = 'grep ' + pathArgs.map(quoteSh).join(' '); break;
    case 'ipconfig': bash = 'ip addr'; break;
    case 'tasklist': bash = 'ps aux'; break;
    case 'set': bash = 'env'; break;
    case 'cls':
      onData('\x1b[2J\x1b[H', 'out');
      return { code: 0, duration: Date.now() - start, timedOut: false, truncated: false };
    case 'ver':
      onData('BATCAVE OS CMD COMPAT [Version 3.1.0-sentinel]\n', 'out');
      return { code: 0, duration: Date.now() - start, timedOut: false, truncated: false };
    case 'systeminfo':
      onData(
        'Host Name:      ' + os.hostname() + '\n' +
        'OS Name:        ' + 'Batcave OS / Linux (CMD compatibility layer)\n' +
        'OS Version:     ' + os.release() + '\n' +
        'System Type:    ' + os.arch() + '\n' +
        'Total Memory:   ' + Math.round(os.totalmem() / 1048576) + ' MB\n' +
        'Note:           Windows 专有子命令在 ISO 中由兼容层处理。\n', 'out'
      );
      return { code: 0, duration: Date.now() - start, timedOut: false, truncated: false };
    case 'echo':
      onData(args.join(' ') + '\n', 'out');
      return { code: 0, duration: Date.now() - start, timedOut: false, truncated: false };
    case 'cd': case 'chdir': case 'title': case 'color':
      onData('[batcave] 该命令由终端处理：' + name + '\n', 'out');
      return { code: 0, duration: Date.now() - start, timedOut: false, truncated: false };
    case 'help':
      bash = 'echo "CMD COMPAT: dir copy move del type md rd ren where findstr ipconfig tasklist set cls ver systeminfo"';
      break;
    default:
      onData('batcave: CMD 兼容层不支持 "' + name + '"。\n' +
        '这是 Linux ISO，Windows 专有可执行文件无法原生运行。\n' +
        '已支持: dir copy move del type md rd ren where findstr ipconfig tasklist set cls ver systeminfo echo\n', 'err');
      return { code: 127, duration: Date.now() - start, timedOut: false, truncated: false };
  }

  let child;
  try {
    child = spawn('/bin/bash', ['-lc', bash], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', BATCAVE: '1' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    onData('batcave: ' + e.message + '\n', 'err');
    return { code: -1, duration: Date.now() - start, timedOut: false, truncated: false };
  }

  return new Promise((resolve) => {
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let exitTimer = null;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      killTree(child);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const done = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(exitTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      try { child.stdout.destroy(); child.stderr.destroy(); } catch {}
      resolve({ code: aborted ? 130 : (code === null ? -1 : code), duration: Date.now() - start, timedOut, aborted, truncated: false });
    };
    child.stdout.on('data', b => onData(b.toString('utf8'), 'out'));
    child.stderr.on('data', b => onData(b.toString('utf8'), 'err'));
    child.on('error', e => onData('batcave: ' + e.message + '\n', 'err'));
    child.on('exit', (code) => { exitTimer = setTimeout(() => done(code), 250); });
    child.on('close', done);
  });
}

module.exports = {
  init, getInfo, exec, isRisky, getMode, toWslPath, quoteSh, killTree, stripAnsi
};