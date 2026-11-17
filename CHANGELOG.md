# 版本变更记录

本文件记录面向用户的版本变化。更新器的详细机制见 [docs/UPDATE.md](docs/UPDATE.md)。

## 3.1.1 · SENTINEL · 2026-11-17

### 新增

- **自带应用内更新**：TenSaint73OS、环球报阁、CodeForge AI 三个应用可在窗口顶部点“更新”，各自选择 GitHub 或 GitCode 检查、下载并安装新版本。
  - 发布查询、Windows x64 包选择、SHA-256 / SHA256SUMS.txt 校验、大小校验。
  - 内置解压与路径安全检查；更新包版本必须与发布版本一致。
  - 更新前停止应用并备份被替换文件；启动失败自动回滚并恢复旧版本。
  - 保留用户数据、账号、配置、模型与工作区；`.tsowner`、`OWNER.pin`、`auth.json`、`system.db` 等凭据类文件会被跳过且不会写入本机。
  - 更新进度显示阶段、百分比、已下载字节与错误信息；记录更新历史与安装来源。
- **独立启动器**：为 TenSaint73OS、环球报阁、CodeForge AI 补充 Windows 启动器，可不经过 BATCAVE 单独启动；优先使用目录内 `runtime\node.exe` 或 `JAVA_HOME`，找不到时回退系统运行时。

### 变更

- 移除 TenSaint73OS、环球报阁、定位工作站三个项目的群聊入口、面板、中继接口与样式；旧聊天数据文件不删除，TenSaint73OS 的站内 AI 助手对话保留。
- 更新说明、版本文件与发布清单同步到 3.1.1。

### 验证

- 真实 GitHub / GitCode 检查更新：TenSaint73OS、环球报阁、CodeForge AI 四组查询全部通过。
- GitCode 真实包端到端更新：TenSaint73OS v1.7.0→1.7.1、环球报阁 v1.1.9→1.2.0，SHA-256、解压、覆盖、数据保留、应用重启均通过；`owner/OWNER.pin` 被识别并跳过。
- 三个桌面启动器分别以独立端口启动，HTTP 健康检查均返回 200。

## 3.1.0 · SENTINEL · 2026-11-17

### 新增

- **系统更新中心**：可从 GitHub 或 GitCode 检查、下载、校验并安装程序层更新，无需重装系统。
  - 双平台清单并行探测，8 秒超时，失败自动回退。
  - SHA-256 + 字节数双重校验；HTTPS 主机白名单与逐跳重定向校验。
  - 内置 ZIP 读取器，拒绝路径穿越、符号链接、加密条目、Zip64、超限解压。
  - 事务式替换：备份、失败回滚、启动时恢复未完成事务。
  - 安装后重启助手拉起新版本，并通过 `BATCAVE_TOKEN` 延续会话令牌。
  - 更新历史、来源记忆、错误重试与"等待重启"状态。
- **可启动 Windows 安装 ISO**：保留官方安装树，仅在 `sources\$OEM$` 注入 BATCAVE、对应架构 `node.exe` 与 `SetupComplete.cmd`；安装完成即带桌面，首次登录自动全屏启动，适合直接重装系统。x64 同时带 BIOS / UEFI 引导，ARM64 为 UEFI 引导。
- **内置影音播放器**：扫描 `/Music`、`/Videos`、`/Downloads`、`/Uploads` 与自定义目录，支持音频 / 视频播放列表、进度拖动、倍速、循环、音量、全屏、上传与拖放；`/api/fs/raw` 改为 HTTP Range 流式响应，视频可随机跳转。
- **内置图片查看器**：扫描 `/Pictures`、`/Gallery`、`/Uploads`、`/Downloads` 与自定义目录，支持缩略图网格、适应窗口 / 原尺寸 / 缩放、旋转、幻灯片、前后切换、全屏、上传、下载与删除；文件管理器和桌面快捷方式均可直接打开。
- **游戏加速器官网安装与更新**：软件中心内置网易UU加速器、雷神加速器、迅游加速器；从厂商官网解析安装包，校验 HTTPS 主机与 Authenticode 厂商签名后启动官方安装器，并核验注册表安装结果。
- **Windows To Go ARM64 基座**：ARM64 官方 ISO（专业版索引 3）+ win-arm64 Node.js 24.22.1；引导管理器、`winload.efi`、`node.exe` 均校验为 `0xAA64`。
- **动态盘符分配**：按 GPT 分区类型定位 EFI / Windows 分区，依次尝试空闲盘符，修复 S: 被占用导致构建失败。
- **内嵌 CodeForge AI 1.0.4**。
- `LICENSE`（MIT）、`.gitignore`、`tools/package-update.js`、更新器测试与完整发布文档。

### 改进

- 更新检查从串行请求改为并行请求，离线最坏等待由 40 秒以上降至约 8 秒。
- 更新清单支持 GitHub / GitCode API 内容接口的 base64 包装。
- 修复重启助手参数错误（旧实现会把 `node.exe` 当作脚本执行，导致重启静默失败）。
- 重启助手增加入口日志与异步错误日志，便于诊断。
- 版本代号从 NIGHTWATCH 统一为 SENTINEL，界面、终端提示、服务器横幅与文档同步。
- 构建、校验、直写脚本移除本机绝对路径，默认值改为基于 `$PSScriptRoot` 推导。
- Windows To Go 构建信息与日志按架构拆分，支持 x64 / ARM64 并存。
- 移除已完成任务的全部界面标签与进度数据文件，ISO 与程序包不再包含任务进度组件。
- `start-batcave.cmd` / `.vbs` 优先使用程序目录内的 `node.exe`，离线基座不依赖系统 PATH；ISO 安装版把运行数据写入 `%LOCALAPPDATA%\BATCAVE-OS`，更新程序层时不触碰用户数据。
- 软件中心标签栏改为可横向滚动，窄窗口下“游戏加速器”等标签与按钮不再挤压换行。

### 验证

- 更新器单元测试 10/10 通过（CRC32、版本排序、清单解包、路径安全、ZIP、暂存校验、清单校验、安装/备份/历史、中断恢复）。
- x64 VHD：`allCoreOk=true`，PE 类型 `0x8664`，16,762,073,088 字节。
- ARM64 VHD：`allCoreOk=true`，PE 类型 `0xAA64`，17,266,372,608 字节。
- x64 可启动 ISO：`allCoreOk=true`，BIOS + UEFI，WIM x64，9,249,839,104 字节，SHA-256 `bbc718bf6791e1e335ca6d2f6068d23d3dd677799564a836e305247d76ad7570`。
- ARM64 可启动 ISO：`allCoreOk=true`，UEFI，WIM arm64，8,971,425,792 字节，SHA-256 `bfbb00b104a02b172223f0617324f5989e2a63477348a219d3a366cd924158e3`。
- 更新重启实测：旧进程 → 新进程，令牌延续，版本保持 3.1.0。

### 已知限制

- 两个 VHD 尚未在实体 USB 硬件上完成启动回归。
- 可启动 ISO 与 VHD 都只做过挂载结构、架构与引导项校验，尚未在实体硬件上安装启动。
- 更新器只更新程序层，不更新 Windows、驱动、`node.exe`、ISO 或 VHD。
- 更新包不包含 `data/`，用户数据始终保留在本机。
- 可启动 ISO 与 VHD 均包含微软 Windows 文件，仅限在自己的合法授权介质上为本机构建，项目不公开分发。

## 3.0.0 · NIGHTWATCH · 2026-11

- 桌面、窗口管理器、任务栏、开始菜单、多窗口拖拽/吸附。
- 真实终端桥：PowerShell、CMD、Git Bash、WSL。
- 代码工坊、HTML/CSS 静态诊断、多语言编译运行。
- 网络面板、安全中心、软件中心、邮件、办公套件、PDF 编辑、播客、电台。
- 内嵌 TenSaint73OS、环球报阁、CodeForge AI。
- Windows To Go x64 构建、Ventoy / 直写 U 盘部署。
