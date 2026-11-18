'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

let ROOT = null;

const FILES = {
  'README.md': `# BATCAVE OS // SENTINEL 3.1.4

> 这座城市睡着了。我们不睡。

欢迎回到蝙蝠洞。这是你的操作台首页（Home），文件管理器与终端共享这里的真实文件。

## 快速开始
- 终端模式：BASH（ISO / Linux）、GIT BASH（Windows 真实 Unix 工具）、CMD、POWER SHELL
- Linux Core 可用时，sudo、apt-get、Homebrew 都是真实命令，不是模拟
- Windows 下未安装 WSL 时，BASH 标签不可用；可使用 Git Bash 的 Unix 工具与 PowerShell 的 Windows 命令
- 更多说明见 Documents/BATCAVE-MANUAL.md

## 终端示例
    ls -la
    cat README.md
    sudo apt-get update && sudo apt-get install -y nmap
    python3 Projects/welcome.py
    node Projects/hello.js
    gcc Projects/main.c -o Projects/main && ./Projects/main

## 注意
终端是真实的：命令会作用于当前系统。危险命令（磁盘、重启、账户、删除根目录）会要求二次确认。
`,
  'Documents/BATCAVE-MANUAL.md': `# BATCAVE OS 操作手册

## 一、真实命令环境
本系统不伪造命令结果。

| 模式 | 适用平台 | 说明 |
|---|---|---|
| BASH | ISO / Linux / WSL | 原生 bash，可 sudo、apt-get、编译 |
| LINUX CORE | Windows + WSL2 | 通过 WSL 执行 Ubuntu 命令 |
| GIT BASH | Windows | Git for Windows 自带的真实 Unix 工具 |
| CMD | Windows / ISO 兼容层 | Windows 命令；ISO 中使用安全兼容层 |
| POWERSHELL | Windows / 已安装 pwsh 的 Linux | Windows PowerShell |

## 二、软件安装
Linux（BASH / LINUX CORE）：
    sudo apt-get update
    sudo apt-get install -y <package>

Homebrew on Linux：
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

Windows（POWERSHELL，需管理员）：
    winget install --id Git.Git
    winget install --id Python.Python.3.12

## 三、多语言开发
Code Forge 会调用真实编译器/解释器。已安装的语言直接运行；未安装的语言会给出真实安装命令。
Kali / Ubuntu 软件源包含 C、C++、Rust、Go、Java、Python、Node.js、Ruby、PHP、Lua、Perl、.NET 等生态。

## 四、Windows 命令与 Linux 命令
- Windows 主机版：CMD / PowerShell 模式调用真实 cmd.exe / powershell.exe。
- ISO：CMD 兼容层覆盖 dir、copy、move、del、type、md、rd、ren、where、findstr、ipconfig、tasklist、set 等常用命令；Windows 专有 GUI 程序无法在 Linux 内原生运行。
- Kali 工具（nmap、metasploit、sqlmap、hydra、wireshark 等）随 Kali 基座提供，或通过 apt 安装。

## 五、文件与系统
- 文件管理器只管理 Home 目录，避免网页误删系统文件。
- 终端拥有真实系统权限，可以访问整个文件系统。
- 退出全屏/回到桌面：浏览器 F11；锁屏：Ctrl+Alt+L。

## 六、安全
这是本地个人系统。网页服务只监听 127.0.0.1，所有执行请求需要一次性会话令牌。
不要把服务绑定到 0.0.0.0，也不要在浏览器中打开不可信页面后授予其执行权限。
`,
  'Documents/SENTINEL-BRIEFING.md': `# SENTINEL // 夜间简报 03:17

- 天气：持续降雨，能见度 1.2 km
- 东区变电站信号异常，已派遣无人机
- 黑市频道出现“红面具”交易暗语，追踪中
- 城市主干道监控离线 7 分钟，备份信道已接管

> 你不需要成为英雄。你只需要让这座城市活到天亮。

—— 夜巡调度台
`,
  'Documents/GOTHAM-GRID.md': `# 哥谭网格

五个分区：
1. 尖塔区 (The Spire) — 金融与行政中枢
2. 铁码头 (Iron Docks) — 货运、走私与旧仓库
3. 灰烬街 (Cinder Row) — 工业带与黑市
4. 夜market (Nightmarket) — 霓虹商业区
5. 维斯珀湾 (Vesper Bay) — 住宅与旧灯塔

终端命令 gotham 可查看实时网格状态（本地模拟数据）。
`,
  'Projects/welcome.py': `#!/usr/bin/env python3
# BATCAVE OS - Python 示例
name = "Detective"
print(f"Welcome back, {name}.")
print("The city is quiet. For now.")
for i in range(1, 4):
    print(f"[sentinel] sector {i:02d} secure")
`,
  'Projects/hello.js': `// BATCAVE OS - Node.js 示例
console.log('BATCAVE NODE RUNTIME ONLINE');
console.log('platform:', process.platform, process.arch);
console.log('node:', process.version);
`,
  'Projects/main.c': `#include <stdio.h>
int main(void) {
    puts("BATCAVE OS // C toolchain online");
    puts("The night is dark and full of signals.");
    return 0;
}
`,
  'Projects/hello.rs': `fn main() {
    println!("BATCAVE OS // Rust toolchain online");
}
`,
  'Projects/hello.go': `package main
import "fmt"
func main() {
    fmt.Println("BATCAVE OS // Go toolchain online")
}
`,
  'Projects/Hello.java': `public class Hello {
    public static void main(String[] args) {
        System.out.println("BATCAVE OS // JVM online");
    }
}
`,
  'Notes/welcome.md': `# 待办
- 检查东区信号异常
- 更新终端访问密钥
- 备份夜巡日志
`
};

function ensureRoot(root) {
  ROOT = path.resolve(root);
  fs.mkdirSync(ROOT, { recursive: true });
  return ROOT;
}

function getRoot() {
  if (!ROOT) throw new Error('home not initialised');
  return ROOT;
}

function normalizeVirtual(p) {
  let s = String(p == null ? '/' : p).replace(/\\/g, '/');
  if (!s.startsWith('/')) s = '/' + s;
  const out = [];
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    if (seg.includes('\0')) throw new Error('invalid path');
    out.push(seg);
  }
  return '/' + out.join('/');
}

function abs(vp) {
  const root = getRoot();
  const v = normalizeVirtual(vp);
  const hp = path.resolve(root, '.' + v);
  const rootCmp = process.platform === 'win32' ? root.toLowerCase() : root;
  const hpCmp = process.platform === 'win32' ? hp.toLowerCase() : hp;
  if (hpCmp !== rootCmp && !hpCmp.startsWith(rootCmp + path.sep)) {
    throw new Error('path escapes home');
  }
  return hp;
}

function statSyncSafe(vp) {
  try { return fs.statSync(abs(vp)); } catch { return null; }
}

function isDir(vp) {
  const st = statSyncSafe(vp);
  return !!(st && st.isDirectory());
}

function exists(vp) {
  return fs.existsSync(abs(vp));
}

async function init(root) {
  ensureRoot(root);
  fs.mkdirSync(path.join(ROOT, 'Documents'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'Projects'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'Pictures'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'Music'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'Videos'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'Downloads'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'Notes'), { recursive: true });
  for (const [name, content] of Object.entries(FILES)) {
    const target = path.join(ROOT, name);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
    }
  }
  return ROOT;
}

async function list(vp) {
  const dir = abs(vp);
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (e) { throw new Error('无法读取目录: ' + e.message); }
  const out = [];
  for (const ent of entries) {
    if (ent.name === '.batcave-seed') continue;
    const full = path.join(dir, ent.name);
    let st = null;
    try { st = await fsp.stat(full); } catch {}
    const vpath = (normalizeVirtual(vp) === '/' ? '' : normalizeVirtual(vp)) + '/' + ent.name;
    out.push({
      name: ent.name,
      path: vpath,
      dir: !!(st && st.isDirectory()),
      size: st ? st.size : 0,
      mtime: st ? st.mtimeMs : 0,
      hidden: ent.name.startsWith('.')
    });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return out;
}

async function readText(vp, max = 2 * 1024 * 1024) {
  const hp = abs(vp);
  const st = await fsp.stat(hp);
  if (st.isDirectory()) throw new Error('这是一个目录');
  if (st.size > max) throw new Error('文件过大（超过 ' + Math.floor(max / 1024 / 1024) + ' MB）');
  const buf = await fsp.readFile(hp);
  if (buf.subarray(0, 4096).includes(0)) throw new Error('二进制文件，无法在文本编辑器中打开');
  return { content: buf.toString('utf8'), size: st.size, mtime: st.mtimeMs };
}

async function readBuffer(vp, max = 30 * 1024 * 1024) {
  const hp = abs(vp);
  const st = await fsp.stat(hp);
  if (st.isDirectory()) throw new Error('这是一个目录');
  if (st.size > max) throw new Error('文件过大');
  return { buffer: await fsp.readFile(hp), stat: st };
}

async function writeText(vp, content, append = false) {
  const hp = abs(vp);
  if (fs.existsSync(hp) && fs.statSync(hp).isDirectory()) throw new Error('同名目录已存在');
  await fsp.mkdir(path.dirname(hp), { recursive: true });
  if (append) await fsp.appendFile(hp, content, 'utf8');
  else await fsp.writeFile(hp, content, 'utf8');
  const st = await fsp.stat(hp);
  return { size: st.size, mtime: st.mtimeMs };
}

async function writeBuffer(vp, buffer) {
  const hp = abs(vp);
  if (fs.existsSync(hp) && fs.statSync(hp).isDirectory()) throw new Error('同名目录已存在');
  await fsp.mkdir(path.dirname(hp), { recursive: true });
  await fsp.writeFile(hp, buffer);
  const st = await fsp.stat(hp);
  return { size: st.size, mtime: st.mtimeMs };
}

async function mkdir(vp) {
  await fsp.mkdir(abs(vp), { recursive: true });
  return { ok: true };
}

async function remove(vp) {
  const v = normalizeVirtual(vp);
  if (v === '/') throw new Error('不能删除根目录');
  const hp = abs(v);
  const st = await fsp.stat(hp);
  await fsp.rm(hp, { recursive: st.isDirectory(), force: false });
  return { ok: true };
}

async function rename(from, to) {
  const src = abs(from);
  const dst = abs(to);
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.rename(src, dst);
  return { ok: true };
}

async function complete(prefix, cwd = '/') {
  const p = String(prefix || '');
  const slash = p.lastIndexOf('/');
  const dirPart = slash >= 0 ? p.slice(0, slash + 1) : '';
  const base = slash >= 0 ? p.slice(slash + 1) : p;
  const dirV = dirPart.startsWith('/') ? (dirPart || '/') : path.posix.join(cwd, dirPart || '.');
  let entries;
  try { entries = await list(dirV); } catch { return []; }
  return entries
    .filter(e => e.name.toLowerCase().startsWith(base.toLowerCase()))
    .slice(0, 50)
    .map(e => ({
      value: dirPart + e.name + (e.dir ? '/' : ''),
      label: e.name + (e.dir ? '/' : ''),
      dir: e.dir
    }));
}

module.exports = {
  init, getRoot, normalizeVirtual, abs, list, readText, readBuffer,
  writeText, writeBuffer, mkdir, remove, rename, complete, exists, isDir
};