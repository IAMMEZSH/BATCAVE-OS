'use strict';
/* BATCAVE OS // real Windows software & game center (winget + registry + Start Menu) */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';

function run(file, args, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: e.message });
    }
    const out = [], err = [];
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ code: -1, stdout: Buffer.concat(out).toString('utf8'), stderr: 'timeout' }); }, timeoutMs);
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => err.push(d));
    child.on('error', e => finish({ code: -1, stdout: Buffer.concat(out).toString('utf8'), stderr: e.message }));
    child.on('close', code => finish({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
  });
}

function ps(script, timeoutMs = 40000) {
  return run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference="SilentlyContinue"; ' + script
  ], timeoutMs);
}

function parseSearch(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line || /^-{4,}/.test(line)) continue;
    if (/^\s*(Name|名称)\s{2,}/i.test(line)) continue;
    let parts = line.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 4) continue;
    const source = parts[parts.length - 1];
    if (!/^(winget|msstore)$/i.test(source)) continue;
    parts = parts.slice(0, -1);
    const id = parts[1] || '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ name: parts[0], id, version: parts[2] || '', source: source.toLowerCase() });
  }
  return out;
}

function parseUpgrades(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line || /^-{4,}/.test(line)) continue;
    if (/^\s*(Name|名称)\s{2,}/i.test(line)) continue;
    const tokens = Array.from(line.matchAll(/\S+/g));
    if (tokens.length < 5) continue;
    const source = tokens[tokens.length - 1][0];
    if (!/^(winget|msstore)$/i.test(source)) continue;
    const idTok = tokens[tokens.length - 4];
    const id = idTok[0];
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      name: line.slice(0, idTok.index).trim(),
      id,
      version: tokens[tokens.length - 3][0] || 'Unknown',
      available: tokens[tokens.length - 2][0] || '',
      source: source.toLowerCase()
    });
  }
  return out;
}

async function search(q) {
  if (!IS_WIN) return { ok: false, available: false, packages: [], message: '软件中心依赖 Windows winget；当前平台不支持原生 .exe 安装。' };
  q = String(q || '').trim();
  if (!q) return { ok: true, available: true, packages: [] };
  if (q.length > 80) throw new Error('搜索词过长');
  const r = await run('winget', ['search', '--query', q, '--source', 'winget', '--accept-source-agreements'], 60000);
  const text = r.stdout + r.stderr;
  const packages = parseSearch(r.stdout);
  return {
    ok: r.code === 0 && packages.length > 0,
    available: true,
    packages,
    message: packages.length ? '' : (/no package|找不到|未找到/i.test(text) ? '没有找到匹配的软件包' : (text.trim().split(/\r?\n/).slice(-3).join(' ') || 'winget 未返回结果'))
  };
}

const WINGET_NAMES = {
  'Tencent.QQMusic': 'QQ音乐',
  'NetEase.CloudMusic': '网易云音乐',
  'Valve.Steam': 'Steam',
  'EpicGames.EpicGamesLauncher': 'Epic Games',
  'Ubisoft.Connect': 'Ubisoft Connect',
  'ElectronicArts.EADesktop': 'EA app',
  'TheDocumentFoundation.LibreOffice': 'LibreOffice',
  'Tencent.WeChat.Universal': '微信',
  'Tencent.QQ.NT': 'QQ',
  'Google.Chrome': 'Google Chrome',
  'Mozilla.Firefox': 'Firefox',
  'Microsoft.VisualStudioCode': 'VS Code',
  'Discord.Discord': 'Discord',
  'VideoLAN.VLC': 'VLC',
  'OBSProject.OBSStudio': 'OBS Studio',
  '7zip.7zip': '7-Zip'
};
let wingetCache = { at: 0, data: null };

async function wingetPackages(force) {
  if (!force && wingetCache.data && Date.now() - wingetCache.at < 60000) return wingetCache.data;
  const file = path.join(os.tmpdir(), 'batcave-winget-' + process.pid + '-' + Date.now() + '.json');
  const exp = await run('winget', ['export', '--include-versions', '-o', file, '--accept-source-agreements', '--disable-interactivity'], 60000);
  let list = [];
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    list = (j.Sources || []).flatMap(s => s.Packages || []).map(p => ({
      id: p.PackageIdentifier || '',
      version: p.Version || '',
      name: '',
      source: (s.SourceDetails && s.SourceDetails.Name) || ''
    })).filter(p => p.id);
  } catch { }
  try { fs.unlinkSync(file); } catch { }
  if (list.length) {
    const names = await run('winget', ['list', '--accept-source-agreements', '--disable-interactivity'], 60000);
    const lines = names.stdout.split(/\r?\n/);
    for (const p of list) {
      const hit = lines.find(line => line.includes(p.id));
      if (hit) {
        const idx = hit.indexOf(p.id);
        const left = hit.slice(0, idx).trim();
        const right = hit.slice(idx + p.id.length).trim().split(/\s+/).filter(Boolean);
        if (left) p.name = left;
        if (!p.version && right[0] && !/^(winget|msstore)$/i.test(right[0])) p.version = right[0];
        const lastSrc = right[right.length - 1];
        if (/^(winget|msstore)$/i.test(lastSrc)) p.source = lastSrc.toLowerCase();
      }
      if (!p.name) p.name = WINGET_NAMES[p.id] || p.id.split('.').pop() || p.id;
    }
    const seen = new Set();
    list = list.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }
  wingetCache = { at: Date.now(), data: exp.code === 0 || list.length ? list : null };
  return list;
}

let upgradeCache = { at: 0, data: null };

async function upgrades(force) {
  if (!IS_WIN) {
    return { ok: false, available: false, upgrades: [], message: '仅 Windows 主机支持官方更新检查。' };
  }
  if (!force && upgradeCache.data && Date.now() - upgradeCache.at < 120000) return upgradeCache.data;
  if (force) {
    await run('winget', ['source', 'update', '--disable-interactivity'], 60000);
  }
  const r = await run('winget', ['upgrade', '--include-unknown', '--accept-source-agreements', '--disable-interactivity'], 180000);
  const text = r.stdout || '';
  const combined = text + '\n' + (r.stderr || '');
  const list = parseUpgrades(text);
  const noUpdates = !list.length && /no installed package|no applicable|not applicable|没有.*(升级|更新)|找不到/i.test(combined);
  const tail = combined.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
  const data = {
    ok: list.length > 0 || r.code === 0 || noUpdates,
    available: true,
    upgrades: list,
    checkedAt: new Date().toISOString(),
    message: list.length ? '' : (noUpdates ? '所有已纳入 winget 官方清单的软件均为最新版' : (tail || 'winget 未返回可升级列表'))
  };
  if (data.ok) upgradeCache = { at: Date.now(), data };
  return data;
}

async function installedRaw(force) {
  if (!IS_WIN) {
    return { ok: false, available: false, apps: [], start: [], message: '仅 Windows 主机支持已安装软件枚举。' };
  }
  const script = `
$ErrorActionPreference='SilentlyContinue';
$keys='HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*';
$apps = @(Get-ItemProperty $keys | Where-Object { $_.DisplayName -and -not $_.SystemComponent } |
  Select-Object DisplayName,DisplayVersion,Publisher,InstallLocation,UninstallString,QuietUninstallString | Sort-Object DisplayName);
$start = @(Get-StartApps | Select-Object Name,AppID | Sort-Object Name);
[pscustomobject]@{apps=$apps;start=$start} | ConvertTo-Json -Depth 5 -Compress
`;
  const r = await ps(script, 60000);
  let data = { apps: [], start: [] };
  try { data = JSON.parse(r.stdout.trim() || '{}'); } catch {}
  if (!Array.isArray(data.apps)) data.apps = data.apps ? [data.apps] : [];
  if (!Array.isArray(data.start)) data.start = data.start ? [data.start] : [];
  const apps = data.apps.map(a => ({
    name: a.DisplayName || '',
    version: a.DisplayVersion || '',
    publisher: a.Publisher || '',
    location: a.InstallLocation || '',
    canUninstall: Boolean(a.QuietUninstallString || a.UninstallString),
    _uninstall: a.QuietUninstallString || a.UninstallString || ''
  })).filter(a => a.name);
  const regNames = new Set(apps.map(a => a.name.toLowerCase()));
  const packages = (await wingetPackages(force)).filter(p => !regNames.has(p.name.toLowerCase()));
  return {
    ok: true,
    available: true,
    apps,
    packages,
    start: data.start.map(s => ({ name: s.Name || '', appId: s.AppID || '' })).filter(s => s.name && s.appId),
    message: ''
  };
}

async function installed(force) {
  const r = await installedRaw(force);
  if (r.apps) r.apps = r.apps.map(({ _uninstall, ...a }) => a);
  return r;
}

async function uninstall(name) {
  if (!IS_WIN) return { ok: false, message: '仅 Windows 主机支持卸载本机程序。' };
  const target = String(name || '').trim();
  if (!target) return { ok: false, message: '缺少程序名称' };
  const inv = await installedRaw();
  const hit = (inv.apps || []).find(a => a.name.toLowerCase() === target.toLowerCase() && a.canUninstall);
  if (!hit) return { ok: false, message: '未找到可卸载条目：' + target };
  let cmd = hit._uninstall.trim();
  if (!cmd || cmd.length > 4096) return { ok: false, message: '卸载命令无效' };
  const msi = cmd.match(/^(?:MsiExec\.exe|msiexec(?:\.exe)?)\s+\/I(\{[0-9A-Fa-f-]+\})/i);
  if (msi) cmd = 'msiexec.exe /x' + msi[1] + ' /qb /norestart';
  if (/^winget\s+uninstall\b/i.test(cmd)) {
    const full = cmd + ' --silent --accept-source-agreements --disable-interactivity';
    const r = await run('cmd.exe', ['/c', full], 300000);
    const tail = (r.stdout + r.stderr).trim().split(/\r?\n/).filter(Boolean).slice(-4).join(' ');
    return r.code === 0
      ? { ok: true, message: '已卸载 ' + hit.name }
      : { ok: false, message: '卸载失败（退出码 ' + r.code + '）：' + (tail || 'winget 未返回原因') };
  }
  try {
    spawn('cmd.exe', ['/c', cmd], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return { ok: true, message: '已启动 ' + hit.name + ' 的卸载程序；如出现 UAC 提示请确认，并按卸载向导完成。' };
  } catch (e) {
    return { ok: false, message: '启动卸载失败：' + e.message };
  }
}

const LAUNCHERS = [
  { id: 'Valve.Steam', name: 'Steam', label: 'STEAM', exe: 'C:\\Program Files (x86)\\Steam\\steam.exe', match: /^steam$/i },
  { id: 'EpicGames.EpicGamesLauncher', name: 'Epic Games', label: 'EPIC', exe: 'C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe', match: /epic games launcher/i },
  { id: 'Ubisoft.Connect', name: 'Ubisoft Connect', label: 'UBISOFT', exe: 'C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\UbisoftConnect.exe', match: /ubisoft connect|uplay/i },
  { id: 'ElectronicArts.EADesktop', name: 'EA app', label: 'EA', exe: 'C:\\Program Files\\Electronic Arts\\EA Desktop\\EA Desktop\\EADesktop.exe', match: /ea app|ea desktop|electronic arts/i },
  { id: 'Microsoft.GamingApp', name: 'Xbox', label: 'XBOX', winget: '9MV0B5HZVK9Z', source: 'msstore', exe: '', match: /^xbox$/i,
    appId: 'Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App' }
];
let launcherCache = { at: 0, data: null };

async function launchers(force) {
  if (!IS_WIN) return { ok: false, available: false, launchers: [], message: '仅 Windows 主机支持游戏平台检测。' };
  if (!force && launcherCache.data && Date.now() - launcherCache.at < 60000) return launcherCache.data;
  const inv = await installed();
  const start = inv.start || [];
  const out = LAUNCHERS.map(L => {
    const reg = (inv.apps || []).find(a => L.match.test(a.name));
    const onDisk = fs.existsSync(L.exe);
    const menu = start.find(s => L.match.test(s.name) && !/uninstall/i.test(s.name));
    return {
      id: L.id, name: L.name, label: L.label,
      winget: L.winget || L.id,
      source: L.source || 'winget',
      installed: Boolean(reg || onDisk || menu),
      registered: Boolean(reg),
      version: reg ? reg.version : '',
      appId: menu ? menu.appId : (L.appId || ''),
      exe: onDisk ? L.exe : ''
    };
  });
  const data = { ok: true, available: true, launchers: out, message: '' };
  launcherCache = { at: Date.now(), data };
  return data;
}

const ESSENTIALS = [
  { id: 'wechat', group: 'im', name: '微信', winget: 'Tencent.WeChat.Universal', match: /^(微信|wechat|weixin)$/i,
    exes: ['C:\\Program Files\\Tencent\\Weixin\\Weixin.exe', 'C:\\Program Files (x86)\\Tencent\\WeChat\\WeChat.exe'] },
  { id: 'qq', group: 'im', name: 'QQ', winget: 'Tencent.QQ.NT', match: /^(qq|腾讯qq)$/i,
    exes: ['C:\\Program Files\\Tencent\\QQNT\\QQ.exe', 'C:\\Program Files (x86)\\Tencent\\QQ\\Bin\\QQ.exe', 'C:\\Program Files (x86)\\Tencent\\QQ\\Bin\\QQScLauncher.exe'] },
  { id: 'word', group: 'office', name: 'Word', match: /^word$/i, exes: [] },
  { id: 'excel', group: 'office', name: 'Excel', match: /^excel$/i, exes: [] },
  { id: 'powerpoint', group: 'office', name: 'PowerPoint', match: /^powerpoint$/i, exes: [] },
  { id: 'wps', group: 'office', name: 'WPS Office', winget: 'Kingsoft.WPSOffice.CN', match: /^wps( office| 文字| 表格| 演示)?$/i,
    exes: [] },
  { id: 'libreoffice', group: 'office', name: 'LibreOffice', winget: 'TheDocumentFoundation.LibreOffice', match: /^libreoffice/i,
    exes: ['C:\\Program Files\\LibreOffice\\program\\soffice.exe'] },
  { id: 'qqmusic', group: 'music', name: 'QQ音乐', winget: 'Tencent.QQMusic', match: /^qq音乐$|qq ?music/i,
    exes: ['C:\\Program Files\\Tencent\\QQMusic\\QQMusic.exe', 'C:\\Program Files (x86)\\Tencent\\QQMusic\\QQMusic.exe'] },
  { id: 'netease', group: 'music', name: '网易云音乐', winget: 'NetEase.CloudMusic', match: /网易云音乐|netease cloud music/i,
    exes: ['C:\\Program Files\\Netease\\CloudMusic\\cloudmusic.exe', 'C:\\Program Files (x86)\\Netease\\CloudMusic\\cloudmusic.exe'] },
  { id: 'kugou', group: 'music', name: '酷狗音乐', winget: '', official: 'https://download.kugou.com/dl/kugou_pc', match: /^酷狗音乐$|kugou/i,
    exes: ['C:\\Program Files\\Kugou\\KGMusic\\KuGou.exe', 'C:\\Program Files (x86)\\Kugou\\KGMusic\\KuGou.exe', 'C:\\Program Files (x86)\\KuGou\\KGMusic\\KuGou.exe'] }
];
const ACCELERATORS = [
  {
    id: 'uu', name: '网易UU加速器', label: 'UU',
    official: 'https://uu.163.com/download/',
    resolvePage: 'https://adl.netease.com/d/g/uu/c/gw?type=pc',
    download: '',
    hosts: new Set(['uu.163.com', 'adl.netease.com', 'uu.gdl.netease.com']),
    match: /网易\s*UU|UU加速器|UUGameBooster|^uu$/i,
    exeHint: /^uu(\.exe)?$|uu/i,
    exes: [
      'C:\\Program Files (x86)\\NetEase\\UU\\uu.exe',
      'C:\\Program Files\\NetEase\\UU\\uu.exe',
      'C:\\Program Files (x86)\\UU\\uu.exe',
      'C:\\Program Files\\UU\\uu.exe'
    ]
  },
  {
    id: 'leigod', name: '雷神加速器', label: 'LEIGOD',
    official: 'https://www.leigod.com/',
    resolvePage: 'https://www.leigod.com/',
    download: 'https://update.leigod.com/soft/channel/LeiGodSetup_guanwang_hd2.exe',
    hosts: new Set(['www.leigod.com', 'update.leigod.com']),
    match: /雷神加速器|LeiGod/i,
    exeHint: /leigod|雷神/i,
    exes: [
      'C:\\Program Files (x86)\\LeiGod\\LeiGod.exe',
      'C:\\Program Files\\LeiGod\\LeiGod.exe',
      'C:\\Program Files (x86)\\LeiGod\\leigod\\LeiGod.exe'
    ]
  },
  {
    id: 'xunyou', name: '迅游加速器', label: 'XUNYOU',
    official: 'https://www.xunyou.com/',
    resolvePage: 'https://www.xunyou.com/',
    download: 'https://partnerdownload.xunyou.com/xunyouclient/install/XunYouinstall.exe',
    hosts: new Set(['www.xunyou.com', 'partnerdownload.xunyou.com']),
    match: /迅游加速器|^迅游$|Xunyou/i,
    exeHint: /xunyou|迅游/i,
    exes: [
      'C:\\Program Files (x86)\\Xunyou\\Xunyou.exe',
      'C:\\Program Files\\Xunyou\\Xunyou.exe',
      'C:\\Program Files (x86)\\Xunyou\\client\\Xunyou.exe'
    ]
  }
];
const acceleratorResolveCache = new Map();
let acceleratorCache = { at: 0, data: null };

function versionParts(v) {
  const m = String(v || '').match(/\d+(?:\.\d+)*/);
  if (!m) return null;
  return m[0].split('.').map(Number);
}

function compareAppVersion(a, b) {
  const pa = versionParts(a), pb = versionParts(b);
  if (!pa || !pb) return 0;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

async function officialText(raw, hosts, timeoutMs = 9000, maxBytes = 512 * 1024) {
  let current = new URL(raw);
  for (let i = 0; i < 5; i++) {
    if (current.protocol !== 'https:' || !hosts.has(current.hostname.toLowerCase())) {
      throw new Error('非官方 HTTPS 地址：' + current.hostname);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'Mozilla/5.0 BatcaveOS/3.1', 'accept': 'text/html,application/xhtml+xml,*/*;q=0.8' }
      });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('重定向缺少地址');
      current = new URL(loc, current);
      continue;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) throw new Error('页面过大');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('页面过大');
    return { text: buf.toString('utf8'), url: current.toString(), lastModified: res.headers.get('last-modified') || '' };
  }
  throw new Error('重定向次数过多');
}

async function officialProbe(raw, hosts, timeoutMs = 10000) {
  let current = new URL(raw);
  for (let i = 0; i < 5; i++) {
    if (current.protocol !== 'https:' || !hosts.has(current.hostname.toLowerCase())) {
      throw new Error('非官方 HTTPS 地址：' + current.hostname);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(current, {
        method: 'HEAD',
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'Mozilla/5.0 BatcaveOS/3.1', 'accept': '*/*' }
      });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('重定向缺少地址');
      current = new URL(loc, current);
      continue;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return {
      size: Number(res.headers.get('content-length') || 0),
      lastModified: res.headers.get('last-modified') || '',
      url: current.toString()
    };
  }
  throw new Error('重定向次数过多');
}

function officialInstaller(A, raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || !A.hosts.has(u.hostname.toLowerCase())) {
    throw new Error('安装包不在官方域名：' + u.hostname);
  }
  if (!/\.exe$/i.test(u.pathname)) throw new Error('官方地址不是 .exe 安装包');
  u.hash = '';
  const out = u.toString();
  if (/['"`\s\x00-\x1f]/.test(out)) throw new Error('官方地址包含不安全字符');
  return out;
}

async function resolveOneAccelerator(A, force) {
  const cached = acceleratorResolveCache.get(A.id);
  if (!force && cached && Date.now() - cached.at < 300000) return cached.data;
  const data = { latest: '', download: '', size: 0, updated: '', resolved: false, error: '' };
  try {
    if (A.id === 'uu') {
      const page = await officialText(A.resolvePage, A.hosts);
      const m = page.text.match(/https:\/\/uu\.gdl\.netease\.com\/[^"'<>\\\s]+\.exe[^"'<>\\\s]*/i);
      if (!m) throw new Error('官方下载页未返回 Windows 安装地址');
      data.download = officialInstaller(A, m[0]);
      const vm = data.download.match(/UU-(\d+(?:\.\d+){2,3})\.exe/i);
      if (vm) data.latest = vm[1];
      data.updated = page.lastModified;
      try {
        const probe = await officialProbe(data.download, A.hosts);
        if (probe.size) data.size = probe.size;
        if (!data.updated && probe.lastModified) data.updated = probe.lastModified;
      } catch { }
      data.resolved = true;
    } else if (A.id === 'leigod') {
      const page = await officialText(A.resolvePage, A.hosts);
      const m = page.text.match(/版本[：:]\s*V?([0-9]+(?:\.[0-9]+){2,3})/i);
      if (m) data.latest = m[1];
      data.download = officialInstaller(A, A.download);
      data.updated = page.lastModified;
      try {
        const probe = await officialProbe(data.download, A.hosts);
        if (probe.size) data.size = probe.size;
        if (probe.lastModified) data.updated = probe.lastModified;
      } catch { }
      data.resolved = true;
    } else if (A.id === 'xunyou') {
      const page = await officialText(A.resolvePage, A.hosts);
      if (!/XunYouinstall\.exe/i.test(page.text)) throw new Error('官网未找到 Windows 在线安装器');
      data.download = officialInstaller(A, A.download);
      try {
        const probe = await officialProbe(data.download, A.hosts);
        if (probe.size) data.size = probe.size;
        data.updated = probe.lastModified || page.lastModified;
      } catch { data.updated = page.lastModified; }
      data.resolved = true;
    }
  } catch (e) {
    data.error = e.message;
    if (!data.download && A.download) data.download = A.download;
  }
  acceleratorResolveCache.set(A.id, { at: Date.now(), data });
  return data;
}

function locateExe(location, hint) {
  if (!location || !fs.existsSync(location)) return '';
  const blocked = /unins|uninstall|setup|updat|crash|report|helper/i;
  const dirs = [location];
  try {
    for (const ent of fs.readdirSync(location, { withFileTypes: true })) {
      if (ent.isDirectory() && dirs.length < 6) dirs.push(path.join(location, ent.name));
    }
  } catch { return ''; }
  const hits = [];
  for (const dir of dirs) {
    try {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!ent.isFile() || !/\.exe$/i.test(ent.name) || blocked.test(ent.name)) continue;
        hits.push(path.join(dir, ent.name));
      }
    } catch { }
  }
  return hits.find(p => hint.test(path.basename(p))) || (hits.length === 1 ? hits[0] : '');
}

async function accelerators(force) {
  if (!IS_WIN) return { ok: false, available: false, accelerators: [], message: '仅 Windows 主机支持游戏加速器检测与官方安装。' };
  if (!force && acceleratorCache.data && Date.now() - acceleratorCache.at < 60000) return acceleratorCache.data;
  const inv = await installed(force);
  const resolved = await Promise.all(ACCELERATORS.map(async A => ({ A, info: await resolveOneAccelerator(A, force) })));
  const out = resolved.map(({ A, info }) => {
    const reg = (inv.apps || []).find(a => A.match.test(a.name));
    const menu = (inv.start || []).find(s => A.match.test(s.name) && !/uninstall|卸载/i.test(s.name));
    const fixed = A.exes.find(p => fs.existsSync(p)) || '';
    const exe = fixed || (reg ? locateExe(reg.location, A.exeHint) : '');
    const version = reg ? reg.version : '';
    const updateAvailable = Boolean(version && info.latest && compareAppVersion(info.latest, version) > 0);
    const updateUnknown = Boolean(version && !info.latest);
    return {
      id: A.id, name: A.name, label: A.label,
      official: A.official,
      installed: Boolean(reg || menu || exe),
      registered: Boolean(reg),
      displayName: reg ? reg.name : '',
      version,
      latest: info.latest,
      updateAvailable,
      updateUnknown,
      resolved: info.resolved,
      size: info.size,
      updated: info.updated,
      error: info.error,
      appId: menu ? menu.appId : '',
      exe
    };
  });
  const data = {
    ok: true,
    available: true,
    accelerators: out,
    checkedAt: new Date().toISOString(),
    message: out.every(x => x.error) ? '官网版本信息暂时不可用；仍可打开官网手动下载。' : ''
  };
  acceleratorCache = { at: Date.now(), data };
  return data;
}

async function resolveAccelerator(id) {
  if (!IS_WIN) return { ok: false, message: '仅 Windows 主机支持官方安装包解析。' };
  const A = ACCELERATORS.find(x => x.id === String(id || ''));
  if (!A) return { ok: false, message: '未知加速器' };
  const info = await resolveOneAccelerator(A, true);
  if (!info.resolved || !info.download) {
    return { ok: false, message: info.error || '未能解析官网最新安装包' };
  }
  return {
    ok: true,
    id: A.id,
    name: A.name,
    official: A.official,
    download: officialInstaller(A, info.download),
    latest: info.latest,
    size: info.size,
    updated: info.updated
  };
}

let essentialCache = { at: 0, data: null };

async function essentials(force) {
  if (!IS_WIN) return { ok: false, available: false, essentials: [], message: '仅 Windows 主机支持本机应用检测。' };
  if (!force && essentialCache.data && Date.now() - essentialCache.at < 60000) return essentialCache.data;
  const inv = await installed();
  const out = ESSENTIALS.map(E => {
    const reg = (inv.apps || []).find(a => E.match.test(a.name));
    const onDisk = E.exes.find(p => fs.existsSync(p)) || '';
    const menu = (inv.start || []).find(s => E.match.test(s.name) && !/uninstall/i.test(s.name));
    return {
      id: E.id, group: E.group, name: E.name,
      winget: E.winget || '',
      official: E.official || '',
      installed: Boolean(reg || onDisk || menu),
      version: reg ? reg.version : '',
      appId: menu ? menu.appId : '',
      exe: onDisk
    };
  });
  const data = { ok: true, available: true, essentials: out, message: '' };
  essentialCache = { at: Date.now(), data };
  return data;
}

function launch({ mode, target } = {}) {
  if (!IS_WIN) return { ok: false, message: '仅 Windows 主机支持启动本地程序。' };
  target = String(target || '');
  if (!target || target.length > 1024 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(target)) {
    return { ok: false, message: '目标无效' };
  }
  try {
    if (mode === 'appid') {
      if (!/^[A-Za-z0-9{}!._\\-]{1,300}$/.test(target)) return { ok: false, message: '应用 ID 无效' };
      spawn('explorer.exe', ['shell:AppsFolder\\' + target], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      return { ok: true, message: '已请求启动开始菜单应用' };
    }
    if (mode === 'exe') {
      const p = path.resolve(target);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return { ok: false, message: '文件不存在: ' + p };
      const ext = path.extname(p).toLowerCase();
      if (ext === '.exe') {
        spawn(p, [], { detached: true, stdio: 'ignore', cwd: path.dirname(p), windowsHide: false }).unref();
        return { ok: true, message: '已请求启动: ' + path.basename(p) };
      }
      if (ext === '.lnk') {
        spawn('explorer.exe', [p], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
        return { ok: true, message: '已请求打开快捷方式: ' + path.basename(p) };
      }
      return { ok: false, message: '只允许启动 .exe 或 .lnk' };
    }
    if (mode === 'dir') {
      const p = path.resolve(target);
      if (!fs.existsSync(p)) return { ok: false, message: '目录不存在: ' + p };
      spawn('explorer.exe', [p], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      return { ok: true, message: '已在资源管理器中打开' };
    }
    return { ok: false, message: '未知启动模式' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

module.exports = { search, installed, upgrades, launchers, essentials, accelerators, resolveAccelerator, launch, uninstall, parseSearch, parseUpgrades };