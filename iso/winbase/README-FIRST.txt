BATCAVE OS · Windows 基座使用说明
=================================

这是什么
--------
BATCAVE OS 是一个运行在 Windows 之上的本地 Web 桌面：终端、代码工坊、
软件中心、邮件、内嵌应用与系统更新都调用真实的本机能力。

本目录的镜像有两种形态，均使用你自己的官方 Windows 11 安装介质制作，
不含第三方修改版 Windows，不含激活密钥，也不绕过激活：

1. 可启动 ISO：BATCAVE-OS-3.1.3.iso / BATCAVE-OS-3.1.3-arm64.iso
   像普通 Windows 安装盘一样安装，装完即带 BATCAVE。
2. Windows To Go VHD：BATCAVE-Win11-Pro.vhd / BATCAVE-Win11-Pro-arm64.vhd
   放入 Ventoy、直写 U 盘或挂进虚拟机使用。

首次进入系统后，请在“设置 → 系统 → 激活”中使用你自己的正版许可激活。

选择哪一个
----------
- 想直接重装本机系统、并保留普通 Windows 的安装体验：用可启动 ISO。
- 想随身携带、不破坏现有硬盘：用 Ventoy 加载 VHD。
- 想做一块专用 Windows To Go U 盘：直写 VHD，整盘会被清空。
- x64 与 ARM64 必须匹配设备架构。ARM64 镜像只能在 ARM64 设备启动；
  x64 宿主可以构建和离线校验 ARM64 镜像，但不能启动它。

可启动 ISO：安装到本机
----------------------
1. 用 Rufus、Ventoy 或厂商工具把 ISO 写入 U 盘。
2. UEFI 启动 U 盘，进入官方 Windows 11 安装界面。
3. 分区、Windows 版本、账户与激活都由你本人确认；BATCAVE 不会替你
   清盘，也不会跳过这些选择。
4. 安装完成、OOBE 之前，安装程序会自动执行 sources\$OEM$\$$\Setup\Scripts\
   SetupComplete.cmd，把 BATCAVE 安装到 C:\BATCAVE-OS，并创建公共桌面、
   开始菜单与所有用户启动快捷方式。
5. 首次登录后，BATCAVE 以 Edge 全屏应用模式自动打开；如果没有出现，
   双击公共桌面的 BATCAVE 快捷方式。
6. 运行数据位于当前用户的 %LOCALAPPDATA%\BATCAVE-OS，日志为同目录
   server.log；程序层在 C:\BATCAVE-OS，可由应用内“系统更新”替换。

ISO 只在官方安装树的 sources\$OEM$ 中加入载荷，install.wim / boot.wim
保持原样；安装程序仍是微软官方安装程序。

Windows To Go VHD
-----------------
方式 A：Ventoy U 盘（推荐，非破坏性）
1. 将对应的 BATCAVE-Win11-Pro.vhd 或 BATCAVE-Win11-Pro-arm64.vhd 复制到
   Ventoy 数据分区（需约 30–60 GB 空间）。
2. 在 Ventoy 官网下载 ventoy_vhdboot.img，放到 U 盘的 ventoy 目录。
3. 重启选择 U 盘启动，在 Ventoy 菜单选择该 VHD。
4. 首次启动进入 Windows OOBE：选择地区/键盘，建议“我没有 Internet”→
   “继续执行受限设置”创建本地账户，进入桌面后 BATCAVE 会自动全屏启动。

方式 B：直接写入 U 盘（会清空整块 U 盘，谨慎）
1. 准备 64 GB 以上 U 盘，以及至少 20 GB 的 C 盘临时空间。
2. 以管理员身份运行 iso\winbase\deploy-to-usb.ps1；ARM64 镜像需加
   -Arch arm64，并用 -Vhd 指向 BATCAVE-Win11-Pro-arm64.vhd。
3. 按提示输入 U 盘磁盘编号（脚本只列出 USB 磁盘），再输入 ERASE 确认。
4. 脚本会捕获 VHD 为临时镜像、重建 GPT 分区、展开 Windows、写入 UEFI
   引导与 BATCAVE，并做部署后校验；全程约 30–60 分钟。
5. 该操作不可撤销，执行前备份 U 盘全部数据。

方式 C：虚拟机
- 新建 UEFI 虚拟机，挂载本 VHD 为硬盘即可启动；建议 4 核 / 8 GB 内存 /
  128 GB 动态磁盘，开启虚拟化以支持 WSL2。

第一次进入桌面
--------------
- BATCAVE 默认全屏启动（Edge 应用模式）。按 Alt+Tab 可切回 Windows 桌面。
- 如果 BATCAVE 没有自动出现，双击桌面 BATCAVE 快捷方式，或以管理员身份
  运行 C:\BATCAVE-OS\start-batcave.cmd。
- 网络：任务栏 → 网络图标，可选 Wi-Fi 并输入密码，或插入网线自动获取。
- 驱动：Windows 更新会自动安装大部分驱动。x64 可去 NVIDIA / AMD / Intel
  官网安装显卡驱动；ARM64 请优先使用设备厂商提供的驱动。

软件、游戏与办公
----------------
- 软件中心（winget）：可搜索并真实安装 Windows 软件。
- 游戏平台：Steam / Epic Games / Ubisoft Connect / EA app / Xbox 可检测、
  启动、安装与更新；游戏本体在各自平台内下载。
- 游戏加速器：软件中心内置网易UU加速器、雷神加速器、迅游加速器。安装与
  更新会从各自官网解析当前 Windows 安装包，校验官方 HTTPS 主机与
  Authenticode 厂商签名后再启动官方安装器；已安装版本与官网版本分别展示。
- 微信、QQ：软件中心搜索安装；若 winget 源暂时不可用，可从腾讯官网下载
  官方安装包。
- 办公：本机若未预装 Microsoft Office，可安装 WPS Office 或 LibreOffice；
  BATCAVE 办公套件内置 PDF 浏览、旋转、删除、排序、合并、页码与导出。
- x64 基座与实体 Windows 使用同一内核、同一显卡驱动、同一反作弊服务，
  平台内能运行的游戏行为一致。ARM64 基座上的 x86/x64 游戏依赖 Windows 11
  ARM64 的模拟层，带内核级反作弊的游戏可能无法运行。

Linux 命令（sudo / apt-get / brew）
----------------------------------
本镜像已尝试离线启用“适用于 Linux 的 Windows 子系统”和“虚拟机平台”。
首次进入桌面后：
1. 以管理员身份打开 PowerShell。
2. 运行：wsl --update
3. 运行：wsl --install -d Ubuntu
4. 重启后按提示创建 Linux 用户名与密码。
之后在 BATCAVE 终端里可直接使用 wsl 进入 Ubuntu；sudo、apt-get 等命令
在 Ubuntu 内真实可用。Kali 可再执行：wsl --install -d kali-linux。
Homebrew 需在 WSL 的 Linux 内安装（brew.sh 官方脚本）。
注意：Deepin 的专有命令不等同于 Ubuntu/Debian 通用命令；Deepin 基于 Debian，
绝大多数 apt 生态命令可用，但深度桌面组件（dde-*）不会出现在 WSL 中。

已包含 / 未包含
---------------
已包含：BATCAVE OS 全部源码、内置终端、文件管理、浏览器安全网关、软件中心、
办公/PDF、地理定位站、TenSaint73OS 与环球报阁（不含任何所有者凭据或个人
数据）、三款游戏加速器的官方入口、便携 node.exe、开机自启脚本。
未包含：Windows 授权密钥、第三方账号、任何 .tsowner / OWNER.pin / auth.json /
system.db / 安装盐值、用户个人文件、游戏本体。

安全与合规
----------
- 本镜像只使用你提供的 Windows 安装介质，不分发 Windows。
- 请在拥有有效 Windows 许可的设备上使用。
- BATCAVE 的“不安全网站拦截”只是浏览器侧风险提示与授权网关，不能替代
  杀毒软件；终端命令以当前用户权限运行，请只运行可信代码。
- 安装任何第三方软件前请确认来源与许可。

故障排查
--------
- 黑屏/无桌面：等待 1–2 分钟；若仍无，Ctrl+Alt+Del → 任务管理器 → 运行
  C:\BATCAVE-OS\start-batcave.cmd。
- 服务日志：%LOCALAPPDATA%\BATCAVE-OS\server.log（ISO 安装）；
  C:\BATCAVE-OS\server.log（VHD 版本）。
- 端口占用：BATCAVE 默认 127.0.0.1:7777；如被占用可关闭占用程序，或运行
  start-batcave.cmd --port=7788。
- 安装日志：C:\Windows\Setup\Scripts\batcave-setup.log。
- 构建日志：iso\out\build-iso.log、build-iso-arm64.log、
  build-winbase.log 与 dism-apply.log。

版本与更新
----------
BATCAVE 程序层可以独立更新：打开桌面“系统更新”，选择 GitHub 或 GitCode，
校验后热替换程序文件，不触碰 Windows 分区、node.exe 与个人数据。
Windows 本体继续由 Windows Update 提供；更换 Windows 大版本或内嵌 node.exe
时才需要重新构建 ISO / VHD。
