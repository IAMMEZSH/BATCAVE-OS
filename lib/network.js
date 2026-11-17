'use strict';
/* BATCAVE OS // real network control: Wi-Fi + Ethernet */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';
const TMP = path.join(os.tmpdir(), 'batcave-net');

function run(file, args, opts = {}) {
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
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ code: -1, stdout: Buffer.concat(out).toString('utf8'), stderr: 'timeout' }); }, opts.timeoutMs || 25000);
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => err.push(d));
    child.on('error', e => finish({ code: -1, stdout: Buffer.concat(out).toString('utf8'), stderr: e.message }));
    child.on('close', code => finish({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
  });
}

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function ps(script, timeoutMs = 25000) {
  return run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference="SilentlyContinue"; ' + script
  ], { timeoutMs });
}

async function writePs1(body) {
  await fsp.mkdir(TMP, { recursive: true });
  const tag = crypto.randomBytes(6).toString('hex');
  const file = path.join(TMP, tag + '.ps1');
  await fsp.writeFile(file, '\uFEFF' + body, 'utf8');
  return file;
}

async function runElevated(inner, timeoutMs = 120000) {
  const ps1 = await writePs1(inner);
  const cmd = 'Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait ' +
    "-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File'," + psQuote(ps1) + ')';
  const r = await ps(cmd, timeoutMs);
  try { await fsp.unlink(ps1); } catch {}
  const cancelled = /取消|cancel/i.test((r.stderr || '') + (r.stdout || ''));
  return { ...r, cancelled };
}

async function elevatedCommand(exe, args, timeoutMs = 120000) {
  await fsp.mkdir(TMP, { recursive: true });
  const tag = crypto.randomBytes(6).toString('hex');
  const outFile = path.join(TMP, tag + '.out.txt');
  const codeFile = path.join(TMP, tag + '.code.txt');
  const list = args.map(a => psQuote(a)).join(' ');
  const inner = `$out = & ${psQuote(exe)} ${list} 2>&1 | Out-String; ` +
    `[IO.File]::WriteAllText(${psQuote(outFile)}, $out, [Text.Encoding]::UTF8); ` +
    `[IO.File]::WriteAllText(${psQuote(codeFile)}, [string]$LASTEXITCODE, [Text.Encoding]::UTF8)`;
  const r = await runElevated(inner, timeoutMs);
  let out = '', code = -1;
  try { out = await fsp.readFile(outFile, 'utf8'); } catch {}
  try { code = Number((await fsp.readFile(codeFile, 'utf8')).trim()); } catch {}
  try { await fsp.unlink(outFile); } catch {}
  try { await fsp.unlink(codeFile); } catch {}
  return { code, output: out, cancelled: r.cancelled, message: r.cancelled ? '管理员授权被取消' : (out || r.stderr || '') };
}

function needsElevation(text) {
  return /需要提升|管理员|拒绝访问|access is denied|error 5|requires elevation|elevated/i.test(String(text || ''));
}
function needsLocation(text) {
  return /位置权限|位置服务|location/i.test(String(text || ''));
}

function splitTerse(line) {
  const parts = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && i + 1 < line.length) { cur += line[i + 1]; i++; continue; }
    if (c === ':') { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

/* ---------------------------------------------------------------- WINDOWS */
function parseWlanInterfaces(text) {
  const out = { connected: false, ssid: '', signal: null, auth: '', state: '' };
  if (!text) return out;
  let m = /^\s*SSID\s*:\s*(.*)$/m.exec(text);
  if (m) { out.ssid = m[1].trim(); out.connected = !!out.ssid; }
  m = /^\s*(?:状态|State)\s*:\s*(.+)$/m.exec(text);
  if (m) out.state = m[1].trim();
  m = /^\s*(?:信号|Signal)\s*:\s*(\d+)%/m.exec(text);
  if (m) out.signal = Number(m[1]);
  m = /^\s*(?:身份验证|Authentication)\s*:\s*(.+)$/m.exec(text);
  if (m) out.auth = m[1].trim();
  return out;
}

function parseWlanProfiles(text) {
  const names = [];
  const re = /^\s*(?:所有用户配置文件|All User Profile)\s*:\s*(.+)$/gim;
  let m;
  while ((m = re.exec(text || ''))) {
    const name = m[1].trim();
    if (name && name !== '<无>' && name !== '<None>' && !names.includes(name)) names.push(name);
  }
  return names;
}

function parseWlanNetworks(text) {
  const map = new Map();
  let cur = null;
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    let m;
    if ((m = /^\s*SSID\s+\d+\s*:\s*(.*)$/.exec(line))) {
      const name = m[1].trim();
      cur = name ? { ssid: name, auth: '', encryption: '', signal: 0 } : null;
      if (cur && !map.has(name)) map.set(name, cur);
      continue;
    }
    if (!cur) continue;
    if (/^\s*BSSID\s+\d+\s*:/i.test(line)) continue;
    if ((m = /^\s*(?:身份验证|Authentication)\s*:\s*(.+)$/.exec(line))) cur.auth = m[1].trim();
    else if ((m = /^\s*(?:加密|Encryption)\s*:\s*(.+)$/.exec(line))) cur.encryption = m[1].trim();
    else if ((m = /^\s*(?:信号|Signal)\s*:\s*(\d+)%/.exec(line))) cur.signal = Math.max(cur.signal, Number(m[1]));
  }
  return Array.from(map.values())
    .map(n => ({
      ...n,
      open: /open|开放式/i.test(n.auth) && /none|无/i.test(n.encryption),
      secured: !(/open|开放式/i.test(n.auth) && /none|无/i.test(n.encryption))
    }))
    .sort((a, b) => b.signal - a.signal);
}

async function windowsStatus() {
  const script = `
$ErrorActionPreference='SilentlyContinue';
$adapters = @(Get-NetAdapter | Where-Object { $_.InterfaceDescription -notmatch 'Loopback|Npcap|Hyper-V|Virtual' } |
  Select-Object Name,InterfaceDescription,Status,LinkSpeed,MacAddress,ifIndex,PhysicalMediaType);
$ips = @(Get-NetIPConfiguration | ForEach-Object {
  [pscustomobject]@{
    Name=$_.InterfaceAlias;
    IPv4=($_.IPv4Address.IPAddress -join ',');
    Gateway=($_.IPv4DefaultGateway.NextHop -join ',');
    DNS=(($_.DNSServer | Where-Object { $_.AddressFamily -eq 2 } | ForEach-Object { $_.ServerAddresses }) -join ',')
  }
});
$profiles = @(Get-NetConnectionProfile | Select-Object Name,InterfaceAlias,NetworkCategory,IPv4Connectivity);
[pscustomobject]@{adapters=$adapters;ips=$ips;profiles=$profiles} | ConvertTo-Json -Depth 6 -Compress
`;
  const r = await ps(script, 30000);
  let data = { adapters: [], ips: [], profiles: [] };
  try { data = JSON.parse(r.stdout.trim() || '{}'); } catch {}
  if (!Array.isArray(data.adapters)) data.adapters = data.adapters ? [data.adapters] : [];
  if (!Array.isArray(data.ips)) data.ips = data.ips ? [data.ips] : [];
  if (!Array.isArray(data.profiles)) data.profiles = data.profiles ? [data.profiles] : [];

  const wifiAdapter = data.adapters.find(a => /802\.11|wireless|wi-?fi|wlan/i.test(String(a.PhysicalMediaType || '') + ' ' + String(a.InterfaceDescription || ''))) || null;
  const ipBy = new Map(data.ips.map(i => [i.Name, i]));
  const profile = wifiAdapter ? data.profiles.find(p => p.InterfaceAlias === wifiAdapter.Name) : null;

  const wifi = {
    available: !!wifiAdapter,
    adapter: wifiAdapter ? { name: wifiAdapter.Name, status: wifiAdapter.Status, speed: wifiAdapter.LinkSpeed, mac: wifiAdapter.MacAddress } : null,
    connected: false,
    ssid: '',
    signal: null,
    auth: '',
    profiles: [],
    requiresElevation: false,
    requiresLocation: false,
    note: ''
  };

  if (wifiAdapter) {
    const ifc = await run('netsh', ['wlan', 'show', 'interfaces'], { timeoutMs: 12000 });
    const parsed = parseWlanInterfaces(ifc.stdout);
    wifi.connected = parsed.connected || (!!profile && wifiAdapter.Status === 'Up');
    wifi.ssid = parsed.ssid || (profile ? String(profile.Name || '') : '');
    wifi.signal = parsed.signal;
    wifi.auth = parsed.auth;
    wifi.requiresElevation = ifc.code !== 0 && needsElevation(ifc.stdout + ifc.stderr);
    wifi.requiresLocation = needsLocation(ifc.stdout + ifc.stderr);
    if (ifc.code !== 0 && !wifi.requiresLocation) {
      wifi.note = firstLine(ifc.stdout + ifc.stderr);
    }
    const prof = await run('netsh', ['wlan', 'show', 'profiles'], { timeoutMs: 12000 });
    wifi.profiles = parseWlanProfiles(prof.stdout);
  }

  const ethernet = data.adapters
    .filter(a => a !== wifiAdapter && (/802\.3|ethernet/i.test(String(a.PhysicalMediaType || '') + ' ' + String(a.InterfaceDescription || ''))))
    .map(a => {
      const ip = ipBy.get(a.Name) || {};
      return {
        name: a.Name,
        description: a.InterfaceDescription,
        status: a.Status,
        speed: a.LinkSpeed,
        mac: a.MacAddress,
        ipv4: ip.IPv4 || '',
        gateway: ip.Gateway || '',
        dns: ip.DNS || ''
      };
    });

  return { platform: 'windows', supported: true, wifi, ethernet, checkedAt: Date.now() };
}

/* ---------------------------------------------------------------- LINUX */
async function nmcli(args, timeoutMs = 20000) {
  return run('nmcli', args, { timeoutMs });
}

async function linuxStatus() {
  const wifi = { available: false, adapter: null, connected: false, ssid: '', signal: null, auth: '', profiles: [], requiresElevation: false, requiresLocation: false, note: '' };
  const ethernet = [];
  const dev = await nmcli(['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status']);
  if (dev.code !== 0) {
    return { platform: 'linux', supported: false, wifi, ethernet, note: dev.stderr || 'nmcli 不可用' };
  }
  const wifiDevices = [];
  for (const line of dev.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, type, state, conn] = splitTerse(line);
    if (type === 'wifi') {
      wifiDevices.push(name);
      wifi.available = true;
      wifi.adapter = { name, status: state };
      wifi.connected = state === 'connected';
      if (wifi.connected) wifi.ssid = conn || '';
    } else if (type === 'ethernet') {
      const ip = await nmcli(['-t', '-f', 'IP4.ADDRESS,IP4.GATEWAY', 'device', 'show', name]);
      const ip4 = (/: (\d+\.\d+\.\d+\.\d+)/.exec(ip.stdout) || [])[1] || '';
      ethernet.push({ name, description: name, status: state, speed: '', mac: '', ipv4: ip4, gateway: conn || '', dns: '' });
    }
  }
  if (wifiDevices.length) {
    const list = await nmcli(['-t', '-f', 'AVAILABLE', 'dev', 'wifi', 'list', '--rescan', 'no']);
    if (list.code !== 0 && /not authorized|权限|denied/i.test(list.stderr)) wifi.requiresElevation = true;
  }
  return { platform: 'linux', supported: true, wifi, ethernet, checkedAt: Date.now() };
}

/* ---------------------------------------------------------------- PUBLIC */
function firstLine(s) {
  return String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, 2).join(' ');
}

async function status() {
  try {
    if (IS_WIN) return await windowsStatus();
    if (IS_LINUX) return await linuxStatus();
    return { platform: process.platform, supported: false, wifi: { available: false }, ethernet: [], note: '当前平台不支持系统网络控制。' };
  } catch (e) {
    return { platform: process.platform, supported: false, wifi: { available: false }, ethernet: [], note: e.message };
  }
}

async function scanWifi({ elevated = false } = {}) {
  if (IS_WIN) {
    let r;
    if (elevated) {
      const res = await elevatedCommand('netsh', ['wlan', 'show', 'networks', 'mode=bssid'], 120000);
      if (res.cancelled) return { ok: false, cancelled: true, needsElevation: true, networks: [], message: '管理员授权被取消' };
      r = { code: res.code, stdout: res.output, stderr: res.message };
    } else {
      const res = await run('netsh', ['wlan', 'show', 'networks', 'mode=bssid'], { timeoutMs: 20000 });
      r = { code: res.code, stdout: res.stdout, stderr: res.stderr };
    }
    const text = (r.stdout || '') + (r.stderr || '');
    const networks = parseWlanNetworks(r.stdout);
    const location = needsLocation(text);
    const elevation = needsElevation(text);
    return {
      ok: r.code === 0 || networks.length > 0,
      elevated: !!elevated,
      networks,
      needsLocation: location,
      needsElevation: elevation && !elevated,
      message: networks.length ? '' : firstLine(text) || '未发现 Wi-Fi 网络'
    };
  }
  if (IS_LINUX) {
    const r = await nmcli(['-t', '-f', 'SSID,SIGNAL,SECURITY', 'dev', 'wifi', 'list', '--rescan', 'yes'], 40000);
    if (r.code !== 0) {
      return { ok: false, networks: [], needsElevation: /not authorized|权限|denied/i.test(r.stderr), message: firstLine(r.stderr) || '扫描失败' };
    }
    const networks = [];
    const seen = new Set();
    for (const line of r.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [ssid, signal, security] = splitTerse(line);
      if (!ssid || seen.has(ssid)) continue;
      seen.add(ssid);
      const open = !security || /^--$/.test(security);
      networks.push({ ssid, signal: Number(signal) || 0, auth: security || '', encryption: security || '', open, secured: !open });
    }
    networks.sort((a, b) => b.signal - a.signal);
    return { ok: true, networks, needsElevation: false, needsLocation: false, message: '' };
  }
  return { ok: false, networks: [], message: '当前平台不支持 Wi-Fi 扫描' };
}

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function profileXml({ ssid, password, open }) {
  const security = open
    ? `<authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption>`
    : `<authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
      <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${xmlEscape(password)}</keyMaterial></sharedKey>`;
  return `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${xmlEscape(ssid)}</name>
  <SSIDConfig><SSID><name>${xmlEscape(ssid)}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>auto</connectionMode>
  <MSM><security>${security}</security></MSM>
</WLANProfile>`;
}

async function connectWifi({ ssid, password, open, elevated = false } = {}) {
  ssid = String(ssid || '');
  if (!ssid || ssid.length > 32 || /[\x00-\x1f]/.test(ssid)) {
    return { ok: false, message: 'SSID 无效（1-32 个字符，不能包含控制字符）' };
  }
  if (!open && (!password || String(password).length < 8)) {
    return { ok: false, message: 'WPA/WPA2 密码至少需要 8 个字符' };
  }
  if (!open && String(password).length > 128) {
    return { ok: false, message: '密码过长' };
  }

  if (IS_WIN) {
    await fsp.mkdir(TMP, { recursive: true });
    const tag = crypto.randomBytes(6).toString('hex');
    const xmlPath = path.join(TMP, tag + '.xml');
    await fsp.writeFile(xmlPath, profileXml({ ssid, password, open }), 'utf8');
    try {
      let add, conn;
      if (elevated) {
        const inner = `$o1 = & netsh wlan add profile ${psQuote('filename=' + xmlPath)} user=current 2>&1 | Out-String; ` +
          `$c1 = $LASTEXITCODE; ` +
          `$o2 = & netsh wlan connect ${psQuote('name=' + ssid)} ${psQuote('ssid=' + ssid)} 2>&1 | Out-String; ` +
          `$c2 = $LASTEXITCODE; ` +
          `Write-Output ($o1 + $o2); if ($c1 -ne 0) { exit $c1 } else { exit $c2 }`;
        const res = await runElevated(inner, 120000);
        if (res.cancelled) return { ok: false, cancelled: true, needsElevation: true, message: '管理员授权被取消' };
        add = { code: 0, stdout: '' };
        conn = { code: res.code, stdout: res.stdout + res.stderr, stderr: res.stderr };
      } else {
        add = await run('netsh', ['wlan', 'add', 'profile', 'filename=' + xmlPath, 'user=current'], { timeoutMs: 20000 });
        if (add.code !== 0 && needsElevation(add.stdout + add.stderr)) {
          return { ok: false, needsElevation: true, message: '添加 Wi-Fi 配置需要管理员权限：' + firstLine(add.stdout + add.stderr) };
        }
        conn = await run('netsh', ['wlan', 'connect', 'name=' + ssid, 'ssid=' + ssid], { timeoutMs: 30000 });
        if (conn.code !== 0 && needsElevation(conn.stdout + conn.stderr)) {
          return { ok: false, needsElevation: true, message: '连接 Wi-Fi 需要管理员权限：' + firstLine(conn.stdout + conn.stderr) };
        }
      }
      const text = (add.stdout || '') + (conn.stdout || '') + (conn.stderr || '');
      if (/需要位置权限|位置服务|location/i.test(text)) {
        return { ok: false, needsLocation: true, message: '系统位置服务未开启，Windows 拒绝访问 WLAN 信息。' };
      }
      return {
        ok: conn.code === 0 || /已成功|successfully|连接请求|connection request/i.test(text),
        needsElevation: needsElevation(text),
        needsLocation: false,
        output: firstLine(text),
        message: firstLine(text) || (conn.code === 0 ? '已发送连接请求' : '连接失败（退出码 ' + conn.code + '）')
      };
    } finally {
      try { await fsp.unlink(xmlPath); } catch {}
    }
  }

  if (IS_LINUX) {
    const args = ['--wait', '40', 'device', 'wifi', 'connect', ssid];
    if (!open) args.push('password', String(password));
    const r = await nmcli(args, 60000);
    return { ok: r.code === 0, output: firstLine(r.stdout + r.stderr), message: r.code === 0 ? '已连接' : (firstLine(r.stderr) || '连接失败') };
  }
  return { ok: false, message: '当前平台不支持 Wi-Fi 连接' };
}

async function disconnectWifi() {
  if (IS_WIN) {
    const r = await run('netsh', ['wlan', 'disconnect'], { timeoutMs: 15000 });
    if (r.code !== 0 && needsElevation(r.stdout + r.stderr)) {
      return { ok: false, needsElevation: true, message: firstLine(r.stdout + r.stderr) };
    }
    return { ok: r.code === 0, message: firstLine(r.stdout + r.stderr) || (r.code === 0 ? '已断开' : '断开失败') };
  }
  if (IS_LINUX) {
    const st = await linuxStatus();
    const dev = st.wifi && st.wifi.adapter && st.wifi.adapter.name;
    if (!dev) return { ok: false, message: '未找到无线网卡' };
    const r = await nmcli(['device', 'disconnect', dev]);
    return { ok: r.code === 0, message: r.code === 0 ? '已断开' : (firstLine(r.stderr) || '断开失败') };
  }
  return { ok: false, message: '当前平台不支持' };
}

async function ethernetAction({ name, action } = {}) {
  name = String(name || '');
  if (!name || name.length > 64 || /[\x00-\x1f"']/.test(name)) return { ok: false, message: '网卡名称无效' };
  if (!['enable', 'disable', 'renew'].includes(action)) return { ok: false, message: '未知操作' };

  if (IS_WIN) {
    if (action === 'renew') {
      const res = await elevatedCommand('ipconfig', ['/renew', name], 180000);
      return { ok: res.code === 0, needsElevation: res.cancelled, output: firstLine(res.output), message: res.cancelled ? res.message : (res.code === 0 ? '已重新获取 IP' : (firstLine(res.output) || 'renew 失败')) };
    }
    const res = await elevatedCommand('netsh', ['interface', 'set', 'interface', 'name=' + name, 'admin=' + (action === 'enable' ? 'enabled' : 'disabled')], 120000);
    return {
      ok: res.code === 0,
      needsElevation: res.cancelled,
      output: firstLine(res.output),
      message: res.cancelled ? res.message : (res.code === 0 ? (action === 'enable' ? '已启用网卡' : '已禁用网卡') : (firstLine(res.output) || '操作失败，可能缺少管理员权限'))
    };
  }
  if (IS_LINUX) {
    const r = action === 'renew'
      ? await nmcli(['connection', 'up', name], 60000)
      : await nmcli(['device', action === 'enable' ? 'connect' : 'disconnect', name], 60000);
    return { ok: r.code === 0, message: r.code === 0 ? '完成' : (firstLine(r.stderr) || '操作失败（可能需要 root/nmcli 权限）') };
  }
  return { ok: false, message: '当前平台不支持' };
}

function openSettings(target) {
  try {
    if (IS_WIN) {
      spawn('cmd.exe', ['/d', '/c', 'start', '', target], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
      return { ok: true, message: '已请求打开系统设置' };
    }
    return { ok: false, message: '请在系统设置中配置网络' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

module.exports = { status, scanWifi, connectWifi, disconnectWifi, ethernetAction, openSettings };