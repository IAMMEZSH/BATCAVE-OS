# 架构说明

## 运行形态

BATCAVE OS 由两层组成：

1. **Node.js 本地服务**（`server.js` + `lib/`）：唯一监听进程，默认 `127.0.0.1:7777`，负责静态资源、认证、Shell 桥、网络、软件、邮件、内嵌应用、系统更新与地理桥接。
2. **浏览器桌面**（`public/`）：原生 JavaScript 实现窗口管理器、文件管理器、终端、编辑器与各应用面板；所有系统能力通过同源 `/api/*` 调用。

没有前端框架、没有数据库依赖、没有云端账号体系。运行数据写入 `data/` 与 `~/Batcave`，卸载源码目录即可移除程序本体。

## 请求与认证

```text
浏览器 ──> GET /               注入随机 token
       ──> /api/*  + x-batcave-token + Origin 校验
server.js ──> lib/bridge|home|network|apps|mail|embedded|update
       ──> 子进程 / PowerShell / WSL / win32 API / IMAP / SMTP / HTTPS
```

- `TOKEN` 默认在启动时由 `crypto.randomBytes(24)` 生成，仅注入首页 `BOOT` 对象，不写入磁盘。
- 更新重启时通过 `BATCAVE_TOKEN` 环境变量把原令牌传给新进程，使已打开的页面和更新轮询在重启后仍能通过认证；令牌依然不落盘。
- 敏感路由同时校验令牌与 Origin；静态资源与少量只读桥接端点例外。
- 默认只监听回环地址；`--allow-local-net` 才允许局域网访问，`--allow-destructive` 才放行破坏性命令。
- 所有子进程使用参数数组启动，不拼接未转义的用户输入；文件操作限定在虚拟文件系统映射根目录内。

## 后端模块

| 模块 | 职责 | 关键实现 |
| --- | --- | --- |
| `server.js` | 路由、静态资源、令牌、代理、地理桥、更新 API | 原生 `http/https`，自动端口顺延 |
| `lib/bridge.js` | 真实 Shell 桥 | 探测 PowerShell 7 / Windows PowerShell / CMD / Git Bash / WSL，流式输出与中止 |
| `lib/home.js` | 本机文件映射 | 虚拟路径到宿主目录的安全解析、目录列举、文件读写 |
| `lib/network.js` | Windows 网络控制 | `Get-NetAdapter`、`Get-NetIPConfiguration`、`netsh wlan`、UAC 提权命令 |
| `lib/apps.js` | 软件与游戏中心 | winget 搜索/导出、官方源更新检查、注册表卸载项、开始菜单应用枚举、启动与卸载 |
| `lib/mail.js` | 邮件桥 | 真实 IMAP/SMTP/TLS，QQ/163/126/yeah.net 服务器配置，凭据仅内存 |
| `lib/embedded.js` | 内嵌应用生命周期 | 端口健康探测、工作区复制、子进程树终止、CodeForge Java 运行时探测 |
| `lib/update.js` | 系统更新 | 双平台清单、SHA-256 校验、内置 ZIP 解压、暂存校验、事务替换、备份与恢复 |
| `lib/restart-helper.js` | 重启助手 | 延迟 2.5 秒拉起新服务进程，保留端口/主机/数据目录/令牌，记录重启日志 |

### Shell 桥模式

- Windows：`powershell`、`cmd`、`gitbash`（若安装 Git for Windows）；检测到 WSL 时额外提供 `linux`。
- Linux：`bash`，以及可选的 `pwsh`。
- Code Forge 的语言执行命令在 `public/js/apps-extra.js` 中按模式生成；Windows 下使用 PowerShell 语法，Unix 下使用 POSIX 语法。

### 内嵌应用

`lib/embedded.js` 的 `APPS` 注册表定义端口、健康检查、数据目录与启动方式：

- `tensaint`：复制 Node 模板到 `data/apps/tensaint` 后以子进程运行，端口 7781。
- `reading`：直接运行发行包，数据目录 `data/apps/reading`，端口 7782。
- `codeforge`：优先查找 `BATCAVE_CODEFORGE_ROOT`、桌面 `CodeForge-AI*`，最后回退 `embedded/CodeForge-AI`；以 `java --add-modules jdk.httpserver -jar CodeForgeServer.jar` 启动，控制台路径 `/console/`，端口 7790。

启动状态保存在进程内 `Map`；停止时 Windows 使用 `taskkill /T /F` 终止整棵进程树，服务退出时调用 `stopAll()`。

## 系统更新

### 目标

更新只替换**程序层**（服务、前端、内嵌应用发行包、文档），不重装 Windows、不重建 VHD、不触碰用户数据：

```text
可替换：server.js  bin  lib  public  embedded  docs  update/sources.json
         README.md  LICENSE  version.json  package.json
不可替换/不包含：data/  iso/  node.exe  .tsowner  OWNER.pin  auth.json  system.db
```

### 组件关系

```text
Update Center (public/js/apps-update.js)
        │  GET /api/update/status | check | job
        │  POST /api/update/apply | restart
        ▼
lib/update.js
        │  update/sources.json  → GitHub / GitCode 清单 URL
        │  HTTPS（主机白名单、重定向逐跳校验、8 秒超时）
        ▼
latest.json ──> Release ZIP（SHA-256 + 字节数）
        │
        ▼
data/updates/staging-*  → validateStaging → transaction.json → 原子替换
```

### 清单与来源

`update/sources.json` 为每个平台配置多个清单地址，检查时**并行请求**，取最先成功的一个：

- GitHub：`raw.githubusercontent.com`、`github.com/.../raw/...`、`api.github.com` 内容接口。
- GitCode：`raw.gitcode.com`、`api.gitcode.com`。
- 允许主机集合固定在内置清单中，并可由 `allowedHosts` 追加；所有清单与资产 URL 必须为 HTTPS 且命中白名单。
- 手动重定向最多 6 跳，每一跳都重新做主机校验，避免被重定向到任意站点。

清单（`update/latest.json`）字段：

```json
{
  "schema": 1,
  "version": "3.1.3",
  "codename": "SENTINEL",
  "released": "2026-11-18",
  "notes": "面向用户的中文更新说明",
  "notesUrls": { "github": "...", "gitcode": "..." },
  "assets": {
    "github": { "url": "...", "sha256": "64 位小写十六进制", "size": 12345678 },
    "gitcode": { "url": "...", "sha256": "...", "size": 12345678 }
  }
}
```

两个平台必须指向**同一 SHA-256、同一字节数**的发布包；检查顺序为"用户选择的平台 → 另一平台"，成功结果会标记 `fallback`，前端显示实际来源。

### 更新包

`tools/package-update.js` 生成 `dist/BATCAVE-OS-<version>.zip`：

- 只收录允许条目；`update/` 目录只放行 `sources.json`，防止把清单自身打进包里。
- 使用内置 ZIP 写入器（deflate、CRC32、UTF-8 文件名），不依赖第三方库。
- 生成 `dist/SHA256SUMS.txt`，并把真实大小与 SHA-256 写回 `update/latest.json`。

`lib/update.js` 内置 ZIP 读取器，支持 stored/deflate，拒绝：

- 加密条目、符号链接、Zip64、路径穿越、绝对路径、空路径段
- 超过 2 万条目、解压总量超过 1 GiB、单文件超过 64 MiB、压缩包超过 256 MiB
- CRC32 或解压尺寸不符

### 安装事务

1. 下载到 `data/updates/download-*.zip`，边下边算 SHA-256，并核对清单中的字节数。
2. 解压到 `data/updates/staging-<version>-<job>/`。
3. `validateStaging` 要求存在 `server.js`、`version.json`、`lib/update.js`、`public/index.html`、`public/js/apps-update.js`、`update/sources.json`，且 `version.json` 必须等于清单版本；禁止凭据文件、`node.exe`、`data/`、`iso/out/`。
4. 写 `transaction.json`（状态 `applying`），把每个顶层条目移动到 `rollback-<version>-<job>/` 备份后替换。
5. 成功后写 `installed.json` 与 `history.json`（最多 30 条）；失败则按已完成条目逐个回滚。
6. 进程启动时 `init()` 读取未完成事务：删除半成品、恢复备份，并写入 `recovery.json`。
7. 新版本需要重启才生效。重启由 `lib/restart-helper.js` 在旧进程退出后拉起；若新进程版本号已等于清单版本，`installed.json` 的 `restartRequired` 自动清除。

`update/latest.json` 不进入更新包；升级后的安装仍保留 `update/sources.json`，可继续检查后续版本。

### 更新 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/update/status` | 当前版本、状态目录、已安装版本、历史、是否需要重启 |
| GET | `/api/update/check?source=github\|gitcode` | 拉取清单并比较版本，支持跨平台回退 |
| POST | `/api/update/apply` | 启动后台更新任务，返回 `jobId` |
| GET | `/api/update/job?id=...` | 查询下载/校验/解压/替换进度 |
| POST | `/api/update/restart` | 拉起重启助手并退出旧进程 |

## 前端结构

| 文件 | 作用 |
| --- | --- |
| `public/js/boot.js` | 开机动画、登录、BOOT 数据解码 |
| `public/js/core.js` | 窗口管理器、任务栏、开始菜单、桌面图标、事件总线 |
| `public/js/terminal.js` | 终端 UI 与流式命令 |
| `public/js/files.js` | 文件管理器 |
| `public/js/browser.js` | 安全浏览器与网关提示 |
| `public/js/apps-*.js` | 各应用面板（工具、办公、媒体、商店、邮件、系统、地理、内嵌、代码工坊、更新中心） |
| `public/js/apps-update.js` | 更新中心：来源选择、检查、进度、重启、历史、错误重试 |
| `public/js/api.js` | 统一 API 客户端，自动附加令牌 |

窗口使用绝对定位与拖拽/缩放事件，应用以 `BC.registerApp` 注册，桌面图标顺序由 `core.js` 的 `DESK` 数组控制。

## Windows To Go 基座

`iso/winbase/` 从官方 Windows 11 ISO 离线构建可启动 VHD，x64 与 ARM64 共用脚本：

- 通过 GPT 分区类型（EFI System `{c12a7328-...}`、Basic `{ebd0a0a2-...}`）定位分区，并动态分配空闲盘符，不假设 S/W。
- x64 校验 `bootmgfw.efi` / `winload.efi` / `node.exe` 的 PE 机器类型为 `0x8664`。
- ARM64 使用 ARM64 ISO（专业版索引 3）、win-arm64 的 `node.exe`，替换 ARM64 引导文件并写入 `EFI\Boot\bootaa64.efi`，三者 PE 类型均为 `0xAA64`。
- 构建结果、分区布局与架构校验写入 `iso/out/BUILD-INFO*.json`、`VERIFY*.json`。

详见 [Windows To Go 镜像构建与部署](BUILD-ISO.md)。

## 代码工坊诊断

`public/js/apps-extra.js` 内置两层诊断：

1. **静态诊断**（HTML/CSS 预览模式）：标签栈校验、可选闭合标签处理、`<style>` 块行号偏移、CSS 声明与括号/字符串闭合检查，结果可点击跳转。
2. **编译器诊断**（真实运行）：解析 GCC/Clang、Rust、Go、Java、PHP、Python、Node、Bash 的常见错误格式，汇总为"文件:行:列 + 严重级别 + 消息"，最多展示 80 条，并统计错误/警告数量。

HTML 预览使用 `sandbox="allow-scripts allow-modals"` 的 `srcdoc` iframe，每次刷新重建 iframe，避免 Chromium 复用旧文档。

## 数据与隐私

| 路径 | 内容 |
| --- | --- |
| `data/` | 虚拟文件系统、会话、内嵌应用数据 |
| `data/updates/` | 更新暂存、下载包、备份、事务与历史 `history.json`、`installed.json`、`recovery.json` |
| `~/Batcave` | 默认本机映射根目录（Linux 为 `$HOME`） |
| `embedded/TenSaint73OS` | 发行模板，不含 `auth.json` / `OWNER.pin` |
| `embedded/CodeForge-AI` | 精简发行包，`config.json` 中 API 密钥为空 |

- 邮箱授权码只在单次请求的内存中存在，不落盘、不写日志。
- 所有者身份仅来自用户桌面 `.tsowner`；仓库与镜像不生成、不复制凭据。
- 更新包校验禁止 `auth.json`、`OWNER.pin`、`.tsowner`、`system.db`；备份目录只包含程序文件。
- 外部软件安装由 winget 或其官方安装器完成，项目不内置第三方安装包。

## 扩展点

- 新增内嵌应用：在 `lib/embedded.js` 的 `APPS` 注册端口/健康路径/启动方式，并在 `public/js/apps-embedded.js` 注册窗口。
- 新增桌面应用：在 `public/js/apps-*.js` 调用 `BC.registerApp`，在 `core.js` 的 `DESK` 增加图标。
- 新增系统能力：在 `lib/` 建立模块，在 `server.js` 增加带令牌校验的路由，在 `public/js/api.js` 增加客户端方法。
- 发布新版本：修改 `version.json` 与 `CHANGELOG.md` → 运行 `node tools/package-update.js` → 上传 ZIP 与 `update/latest.json` 到 GitHub/GitCode → 打标签。
