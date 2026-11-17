# Windows 基座构建与部署

本项目的 Windows 基座不是预先分发的系统镜像，而是由脚本从**官方 Windows 11 ISO** 离线生成：

- **可启动 ISO**：保留官方安装树，只在 `sources\$OEM$` 中加入 BATCAVE 载荷。安装完成后直接得到带 BATCAVE 的 Windows，适合“重装系统”。
- **Windows To Go VHD**：把官方映像展开为可启动 VHD，放入 Ventoy、直写 U 盘或挂进虚拟机。

两条线都不分发 Windows、不包含激活密钥、不修改激活状态。x64 与 ARM64 使用同一套脚本，仅镜像、索引与 `node.exe` 不同。

## 前置条件

| 项目 | x64 | ARM64 |
| --- | --- | --- |
| 宿主机 | Windows 10/11 x64，管理员权限 | 同左（可构建与离线校验，但不能在 x64 宿主启动） |
| 官方 ISO | Windows 11 x64 | Windows 11 ARM64 |
| WIM 索引 | 专业版 = 4（以 `dism /Get-WimInfo` 为准） | 专业版 = 3（ARM64 ISO 只有 3 个索引） |
| Node.js | x64 `node.exe` | 单独的 win-arm64 `node.exe`（本项目实测 24.22.1） |
| ISO 工具 | `oscdimg.exe`（Microsoft.OSCDIMG 或 Windows ADK） | 同左 |
| 磁盘空间 | 暂存与输出各约 ISO 体积的 1.1 倍；建议 ≥ 30 GB 可用 | 同左 |
| 目标介质 | ISO 写入 ≥ 8 GB U 盘；Ventoy ≥ 32 GB；直写 ≥ 64 GB | 同左 |

ISO 文件名会随 Windows 版本变化，脚本不硬编码文件名，只要 `sources\install.wim`（或 `install.esd`）、`sources\boot.wim`、`setup.exe` 与引导文件存在即可。

## 一、可启动 ISO

### 1.1 它如何工作

ISO 的阶段只有两步：

1. `build-iso.ps1` 把官方 ISO 完整复制到暂存目录（逐文件、逐字节核对），**不修改** `install.wim` / `boot.wim` / `setup.exe`。
2. 在暂存树中加入 `sources\$OEM$`：
   - `$1\BATCAVE-OS` 安装到目标系统 `C:\BATCAVE-OS`。
   - `$$\Setup\Scripts\SetupComplete.cmd` 在安装完成、OOBE 之前执行安装脚本。
   - `install-batcave.ps1` 创建公共桌面、开始菜单与所有用户启动快捷方式，并授予 Users 修改权限，供应用内更新替换程序层。

安装程序仍是微软官方安装程序：分区、版本、账户与激活都由用户在安装界面确认。项目不写入无人值守磁盘清除，不会替用户选择磁盘。

### 1.2 构建命令

```powershell
# x64（专业版通常索引 4）
powershell -NoProfile -ExecutionPolicy Bypass -File iso\winbase\build-iso.ps1 `
  -Iso "D:\images\Windows11_Client_x64_zh-cn.iso" -Index 4

# ARM64（专业版通常索引 3，必须提供 win-arm64 的 node.exe）
powershell -NoProfile -ExecutionPolicy Bypass -File iso\winbase\build-iso.ps1 `
  -Arch arm64 `
  -Iso "D:\images\Windows11_Client_arm64_zh-cn.iso" -Index 3 `
  -NodeExe "D:\tools\node-v24.22.1-win-arm64.exe"
```

> 需要管理员权限（挂载 ISO、写暂存目录、调用 DISM）。ARM64 ISO 中专业版通常是索引 3，而不是 x64 的 4；脚本会先用 DISM 校验名称与架构，索引选错会直接中止。

### 1.3 参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-Arch` | `x64` | `x64` 或 `arm64` |
| `-Iso` | 无（必填） | 官方 Windows 11 ISO 完整路径 |
| `-Index` | x64=4，ARM64=3 | WIM 索引 |
| `-NodeExe` | x64 自动查找 `node.exe`；ARM64 必填 | 目标架构的 Node.js 可执行文件 |
| `-Out` | `iso\out\BATCAVE-OS-<version>[-arm64].iso` | 输出 ISO，必须不存在 |
| `-WorkDir` | `%SystemDrive%\BATCAVE-ISO-BUILD` | 暂存目录，成功构建后自动清理 |
| `-Oscdimg` | 自动查找 | `oscdimg.exe` 路径 |
| `-SkipSourceHash` | 关闭 | 跳过来源 ISO 的 SHA-256 计算（只影响报告，不推荐） |
| `-KeepStage` | 关闭 | 成功后保留暂存目录，便于检查 |
| `-SkipVerify` | 关闭 | 跳过成品 ISO 校验，不推荐 |

### 1.4 脚本流程

1. 校验管理员权限、源 ISO、输出路径不存在、`node.exe` 的 PE 架构（x64 = `0x8664`，ARM64 = `0xAA64`）。
2. 只读挂载源 ISO；定位 `sources/install.wim`（缺失时回退 `install.esd`）、`sources/boot.wim`、`setup.exe`、`boot/etfsboot.com`、`efi/microsoft/boot/efisys.bin`。
3. 用 DISM 读取所选索引的名称与架构；架构不匹配立即中止。
4. 计算源 ISO 的 SHA-256 与体积，检查暂存盘和输出盘剩余空间。
5. 以 `robocopy /E /COPY:DAT /DCOPY:DAT /XJ` 复制官方安装树，核对文件数与总字节数，并单独核对 `install.wim` 大小。
6. 构建 `$OEM$` 载荷：程序源码、前端、内嵌应用、文档、`bin`、`update/sources.json`、对应架构 `node.exe`、Kiosk 启动脚本、`BATCAVE-ISO.json` 与使用说明。
7. 载荷安全检查：拒绝 `.tsowner`、`OWNER.pin`、`auth.json`、`system.db`、`data/`、`update/latest.json`，拒绝已删除的任务 HUD 引用，并确认三款游戏加速器代码与 API 存在。
8. 用 `oscdimg.exe` 生成 ISO：
   - x64：`-bootdata:2#p0,e,b<etfsboot.com>#pEF,e,b<efisys.bin>`，同时带 BIOS 与 UEFI 引导。
   - ARM64：`-bootdata:1#pEF,e,b<efisys.bin>`，只带 UEFI 引导。
   - 公共参数：`-m -o -u2 -udfver102 -h -l<label>`；卷标形如 `BATCAVE_OS_311_X64`。
9. 计算输出 ISO 的 SHA-256 与字节数，调用 `verify-iso.ps1` 只读挂载成品并复检。
10. 写出构建报告与校验报告；成功后删除暂存目录，失败时保留暂存并删除未通过校验的输出。

### 1.5 产物

```text
iso/out/
├── BATCAVE-OS-3.1.3.iso
├── BATCAVE-OS-3.1.3-arm64.iso
├── ISO-BUILD.json / ISO-BUILD-arm64.json
├── VERIFY-ISO.json / VERIFY-ISO-arm64.json
├── ISO-SHA256SUMS.txt
├── build-iso.log / build-iso-arm64.log
├── BATCAVE-Win11-Pro.vhd
├── BATCAVE-Win11-Pro-arm64.vhd
└── BUILD-INFO.json / BUILD-INFO-arm64.json
```

`ISO-BUILD*.json` 记录源 ISO 的 SHA-256、WIM 名称/架构、Node 版本/架构、载荷文件数与字节数、输出 SHA-256/字节数与校验结果。`ISO-SHA256SUMS.txt` 会按文件名去重后累加两个架构的 ISO。

### 1.6 成品 ISO 校验

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File iso\winbase\verify-iso.ps1 `
  -Iso iso\out\BATCAVE-OS-3.1.3.iso -Arch x64 -Index 4 `
  -ExpectVersion 3.1.3 -Report iso\out\VERIFY-ISO.json
```

`verify-iso.ps1` 只读挂载 ISO，检查：

- 卷标以 `BATCAVE` 开头。
- `setup.exe`、`sources/install.wim|esd`、`sources/boot.wim`、`boot/etfsboot.com`、`efi/microsoft/boot/efisys.bin`、与架构匹配的 `efi/boot/bootx64.efi` 或 `bootaa64.efi`。
- El Torito 引导目录：x64 必须同时有 BIOS（`0x00`）与 UEFI（`0xEF`）；ARM64 必须为 UEFI（`0xEF`）。
- WIM 索引名称/架构与 `-Arch`、`-Index` 一致。
- `sources\$OEM$\$1\BATCAVE-OS` 载荷：`server.js`、`node.exe`、`start-batcave-kiosk.cmd/.vbs`、`BATCAVE-OS-README.txt`、`version.json`、`BATCAVE-ISO.json`、`update/sources.json`、`public/js/apps-player.js`、`public/css/player.css`。
- `sources\$OEM$\$$\Setup\Scripts`：`SetupComplete.cmd`、`install-batcave.ps1`，且安装脚本含 Kiosk 快捷方式与 `ProgramData`。
- `node.exe` 与 EFI fallback 的 PE 机器类型与目标架构一致。
- 载荷中不存在 `.tsowner`、`OWNER.pin`、`auth.json`、`system.db`，且全文扫描不到任何任务进度组件或相关引用。
- 载荷中不存在 `data/` 与 `update/latest.json`。
- 三款游戏加速器（网易UU、雷神、迅游）仍存在于后端、前端与 API。
- 结果写入 `VERIFY-ISO*.json`；`allCoreOk` 为 `true` 才算通过。

> 离线校验证明的是结构、架构与载荷完整性，**不等于实体启动回归**。首次安装仍建议先在备用机或虚拟机验证，再写入常用设备。

### 1.7 本机实测结果（v3.1.1，2026-11-17）

> 3.1.2 与 3.1.3 只更新程序包，未重新构建 ISO；使用同一脚本会输出 `BATCAVE-OS-3.1.3*.iso`。

| 项目 | x64 | ARM64 |
| --- | --- | --- |
| 输出文件 | `BATCAVE-OS-3.1.1.iso` | `BATCAVE-OS-3.1.1-arm64.iso` |
| 字节数 | 9,249,867,776 | 8,971,454,464 |
| SHA-256 | `5ae1a37ee61309cbee1e994b451ffb1b3c2cc93e8f2351ce1a026965bf728bd3` | `983e8ab5f70849aec4fcbdc36614ef03faab94c16346376c612c07f1d79e4261` |
| 源 ISO | Windows 11 专业版，索引 4 | Windows 11 专业版，索引 3 |
| 引导 | BIOS（`0x00`）+ UEFI（`0xEF`） | UEFI（`0xEF`） |
| WIM 架构 | x64 | arm64 |
| Node.js | 26.13.0 / `0x8664` | 24.22.1 / `0xAA64` |
| 卷标 | `BATCAVE_OS_311_X64` | `BATCAVE_OS_311_ARM64` |
| `allCoreOk` | `true` | `true` |

两份成品 ISO 均已挂载校验：`setup.exe`、`install.wim`、`boot.wim`、BIOS/UEFI 引导目录、EFI fallback、WIM 架构、载荷文件、播放器文件、加速器代码、禁入凭据与任务进度组件。尚未在实体硬件上完成启动回归。


## 二、Windows To Go VHD

### 2.1 构建命令

```powershell
# x64（专业版通常为索引 4）
powershell -NoProfile -ExecutionPolicy Bypass -File iso\winbase\build-winbase.ps1 `
  -Iso "D:\images\Windows11_Client_x64_zh-cn.iso" -Index 4

# ARM64（专业版通常为索引 3，需提供 win-arm64 的 node.exe）
powershell -NoProfile -ExecutionPolicy Bypass -File iso\winbase\build-winbase.ps1 `
  -Arch arm64 `
  -Iso "D:\images\Windows11_Client_arm64_zh-cn.iso" -Index 3 `
  -NodeExe "D:\tools\node-v24.22.1-win-arm64.exe"
```

### 2.2 参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-Arch` | `x64` | `x64` 或 `arm64` |
| `-Iso` | 无（必填） | 官方 Windows 11 ISO 完整路径 |
| `-Index` | `4` | WIM 索引；ARM64 专业版通常为 3 |
| `-Out` | `iso\out\BATCAVE-Win11-Pro[-arm64].vhd` | 输出 VHD，必须不存在 |
| `-SizeMB` | `204800` | 动态 VHD 上限（200 GB） |
| `-Source` | 仓库根目录 | BATCAVE 源码目录 |
| `-NodeExe` | x64 使用本机 `node.exe` | ARM64 必填 |
| `-SkipWsl` | 关闭 | 跳过离线启用 WSL / 虚拟机平台 |
| `-KeepFailed` | 关闭 | 失败时保留 VHD 便于诊断 |

### 2.3 脚本流程

1. 校验管理员权限、ISO、输出路径与 `node.exe` 的 PE 架构。
2. 只读挂载 ISO，读取 `sources/install.wim`（缺失时回退 `install.esd`），用 DISM 校验所选索引的名称与架构。
3. 用 diskpart 创建 GPT 动态 VHD：EFI 300 MB + Windows 主分区（`convert gpt` 自动创建 MSR）。
4. 按 GPT 类型定位两个分区，并**动态分配空闲盘符**（依次尝试 S、W、X、Y…），不假设盘符固定。
5. `dism /Apply-Image` 展开系统，日志写入 `iso\out\dism-apply[-arm64].log`。
6. `bcdboot <Windows 盘>\Windows /s <EFI 盘> /f UEFI /l zh-cn` 写入 UEFI 引导。
7. ARM64 额外步骤：用镜像自带的 `bootmgfw.efi`、`bootmgr.efi`、`memtest.efi`、`SecureBootRecovery.efi` 覆盖 EFI 分区中的版本，写入 `EFI\Boot\bootaa64.efi`，最后校验 PE 机器类型为 `0xAA64`。
8. 复制 BATCAVE 源码（排除 `data`、`iso`、`node_modules`、`.git`）、对应架构 `node.exe`、`start-batcave.vbs` / `.cmd`、开始菜单、启动目录与公共桌面快捷方式。
9. 离线注册表调整：`BypassNRO`、关闭首次隐私体验、`PreventDeviceEncryption`。
10. 离线启用 `Microsoft-Windows-Subsystem-Linux` 与 `VirtualMachinePlatform`，结果记录在 `BUILD-INFO[-arm64].json`。
11. 输出构建信息、日志，并安全分离 VHD。

### 2.4 产物

```text
iso/out/
├── BATCAVE-Win11-Pro.vhd
├── BATCAVE-Win11-Pro-arm64.vhd
├── BUILD-INFO.json
├── BUILD-INFO-arm64.json
├── build-winbase.log
├── build-winbase-arm64.log
├── dism-apply.log / dism-apply-arm64.log
├── dism-wsl.log / dism-wsl-arm64.log
└── dism-vmp.log / dism-vmp-arm64.log
```

x64 与 ARM64 的日志、信息文件使用不同后缀，可在同一目录并存。VHD 体积超出 GitHub / GitCode 的单个 Release 资产限制，因此仓库发布的是构建脚本，镜像需在本机构建；可启动 ISO 因包含微软 Windows 文件，同样不公开分发。

### 2.5 VHD 离线校验

```powershell
# x64（默认读 iso\out\BATCAVE-Win11-Pro.vhd，输出 VERIFY.json）
powershell -NoProfile -ExecutionPolicy Bypass -File iso\winbase\verify-vhd.ps1

# ARM64
powershell -NoProfile -ExecutionPolicy Bypass -File iso\winbase\verify-vhd.ps1 -Arch arm64
```

`-Vhd` 与 `-Report` 可省略，默认按架构选择文件名。脚本只读挂载 VHD，按**分区类型**（EFI System / Basic）而不是分区号定位，检查：

- `EFI\Microsoft\Boot\bootmgfw.efi`、`EFI\Microsoft\Boot\BCD`、`EFI\Boot\bootx64.efi`（ARM64 为 `bootaa64.efi`）
- `Windows\System32\winload.efi`
- `BATCAVE-OS\server.js`、`node.exe`、`start-batcave.vbs`
- 开机启动快捷方式、公共桌面快捷方式与说明文件
- 内嵌 TenSaint73OS / 环球报阁，且不含 `auth.json`、`OWNER.pin`、`system.db`
- `wsl.exe`、`vmcompute.exe`
- PE 机器类型：`bootmgfw.efi`、`winload.efi`、`node.exe` 必须与目标架构一致

### 2.6 VHD 实测结果

| 项目 | x64 | ARM64 |
| --- | --- | --- |
| `allCoreOk` | `true` | `true` |
| 引导管理器 | `bootmgfw.efi` = `0x8664` | `bootmgfw.efi` = `0xAA64` |
| `winload.efi` | `0x8664` | `0xAA64` |
| `node.exe` | `0x8664` | `0xAA64` |
| EFI / Windows 分区 | 2 / 4（旧构建，含重复 MSR） | 2 / 3 |
| 分区总数 | 4 | 3 |
| 实际大小 | 16,762,073,088 字节 | 17,266,372,608 字节 |
| 构建时间 | 2026-11-17 | 2026-11-17 |

新版构建脚本已移除重复 MSR 步骤，未来 x64 镜像也会是 3 个分区；校验脚本不依赖分区号，两种布局都适用。

`iso\winbase\inspect-vhd.ps1` 可输出完整分区表与 EFI 文件清单（默认 `iso\out\INSPECT.json`）。

## 三、部署与首次启动

### 3.1 可启动 ISO

1. 用 Rufus、Ventoy 或厂商工具把 ISO 写入 U 盘。
2. UEFI 启动，进入官方 Windows 安装界面，选择磁盘、版本与账户。
3. 安装完成后首次登录，BATCAVE 自动全屏启动；未启动时双击公共桌面的 BATCAVE。
4. 程序位于 `C:\BATCAVE-OS`，用户数据位于 `%LOCALAPPDATA%\BATCAVE-OS`，安装日志位于 `C:\Windows\Setup\Scripts\batcave-setup.log`。

### 3.2 Ventoy（推荐，非破坏性）

1. 用 Ventoy 制作 U 盘，数据分区保留 ≥ 20 GB 空间。
2. 复制 `BATCAVE-Win11-Pro[-arm64].vhd` 到数据分区。
3. 下载 Ventoy 官方 `ventoy_vhdboot.img`，放入 U 盘的 `ventoy` 目录。
4. U 盘 UEFI 启动，在 Ventoy 菜单选择该 VHD。
5. 首次启动进入 Windows OOBE，创建本地账户；进入桌面后 BATCAVE 自动全屏启动。

Ventoy 对 VHD 是“文件级”使用，不会清空 U 盘，也不影响盘中现有镜像。注意：ARM64 VHD 只能在 ARM64 设备上启动。

### 3.3 直写 U 盘（破坏性）

```powershell
# 管理员 PowerShell；VHD 默认按 -Arch 从 iso\out 选择
powershell -NoProfile -ExecutionPolicy Bypass -File iso\winbase\deploy-to-usb.ps1

powershell -NoProfile -ExecutionPolicy Bypass -File iso\winbase\deploy-to-usb.ps1 -Arch arm64
```

- 只列出 `BusType = USB` 且非系统盘的磁盘；内置磁盘一律不会被列出。
- 需要输入磁盘编号并键入 `ERASE` 二次确认。
- 脚本先校验源 VHD 的 `winload.efi` 架构与 `-Arch` 一致，再执行部署。
- ARM64 在 `bcdboot` 后替换为 ARM64 `bootmgfw.efi` / `bootmgr.efi`，并写入 `EFI\Boot\bootaa64.efi`。
- 流程：只读挂载 VHD → 捕获为临时 WIM → 重建 GPT（EFI + NTFS）→ 展开 → `bcdboot` → 架构校验。
- 输出 `iso\out\DEPLOY-USB.json` 与 `deploy-usb.log`，`bootmgfw`、`bcd`、`fallbackBoot`、`winload`、`serverJs`、`nodeExe`、`archOk` 应全部为 `true`。
- 全程约 30–60 分钟，依赖 USB 读写速度与 C 盘临时空间。

### 3.4 首次启动

- OOBE：选择地区/键盘，建议“我没有 Internet”→“继续执行受限设置”创建本地账户。
- 进入桌面后双击 `BATCAVE`（若未自动启动），服务监听 `http://127.0.0.1:7777`。
- 激活：设置 → 系统 → 激活，使用自己的正版许可。
- 驱动：Windows Update 安装基础驱动；显卡驱动建议使用 NVIDIA / AMD / Intel 官方版本，ARM64 设备使用 OEM 驱动。
- WSL：管理员 PowerShell 执行 `wsl --update`，再 `wsl --install -d Ubuntu`，重启后创建 Linux 账户。

## 四、故障排查

| 现象 | 处理 |
| --- | --- |
| 构建报 `oscdimg.exe not found` | 安装 `Microsoft.OSCDIMG`（winget）或 Windows ADK，或用 `-Oscdimg` 指定路径 |
| 构建报暂存空间不足 | 清理 `%SystemDrive%\BATCAVE-ISO-BUILD` 或把 `-WorkDir` 指到空间更大的盘 |
| 构建报 WIM 架构不匹配 | 确认 `-Arch`、源 ISO 与 WIM 索引三者一致 |
| 成品 ISO 校验 `allCoreOk=false` | 查看 `VERIFY-ISO*.json` 中为 `false` 的字段；构建脚本会保留暂存目录便于诊断 |
| 黑屏/无桌面 | 等待 1–2 分钟；Ctrl+Alt+Del → 任务管理器 → 运行 `C:\BATCAVE-OS\start-batcave.cmd` |
| 端口占用 | 默认 7777；检查 `netstat -ano | findstr 7777`，或用 `--port` 指定其他端口 |
| UEFI 找不到启动项 | 确认 U 盘为 GPT、EFI 分区 FAT32 且存在 `EFI\Microsoft\Boot\bootmgfw.efi` |
| 构建报盘符不可用 | 新版脚本会自动尝试多个盘符；若仍失败，重启后重试或先释放被占用的盘符 |
| ARM64 构建报架构不匹配 | 确认使用了 ARM64 ISO、正确的 WIM 索引和 win-arm64 的 `node.exe` |
| 直写脚本拒绝执行 | 确认目标为 USB 磁盘、容量 ≥ 64 GB、C 盘临时空间 ≥ 20 GB |
| 校验 `allCoreOk=false` | 查看 `VERIFY.json` / `VERIFY-arm64.json` 中具体为 false 的项；重新运行构建脚本 |

## 五、Windows 12 与后续基座

**程序更新与系统基座是两条线，互不替代。**

- **Windows 本体**：基座里是完整 Windows；质量更新、驱动与安全补丁继续由 Windows Update 提供。
- **BATCAVE 程序层**：应用内更新中心只替换 `server.js`、`lib`、`public`、`embedded`、`docs` 等文件，不碰 Windows 分区、引导文件、`node.exe` 与 `data/`。因此**应用升级永远不需要重装系统，也不需要重建 ISO / VHD**。
- **ISO / VHD 基座**：只有更换 Windows 大版本、调整分区或升级内嵌 `node.exe` 时才需要重新构建。

构建脚本不绑定 Windows 11 版本号：它只读取 ISO 中的 `sources/install.wim`（或 `install.esd`），按 `-Index` 展开或注入 `$OEM$`，再用目标系统自带的 `bcdboot` 写入 UEFI 引导。因此 Windows 12 ISO 发布后，原则上仍是“换 ISO 重新构建”。但每次 Windows 大版本更新都必须重新实测以下项目，不能直接假设兼容：

1. 用 `dism /Get-WimInfo` 确认新 ISO 的版本索引与架构（ARM64 专业版索引可能再次变化，当前为 3）。
2. `dism /Apply-Image`、`bcdboot /f UEFI` 与 `$OEM$\$$\Setup\Scripts\SetupComplete.cmd` 的触发行为是否仍适用。
3. OOBE 注册表项（`BypassNRO`、隐私体验、`PreventDeviceEncryption`）是否改名或失效。
4. `start-batcave-kiosk.vbs`、启动目录与公共桌面快捷方式是否仍能自动拉起 BATCAVE。
5. ARM64 版 Node.js 在新系统上是否可运行，x64 组件在 Prism 模拟下的行为是否变化。
6. 首次启动、驱动、WSL、休眠与更新中心做完整回归。

在这些项目通过前，文档只会写“可构建、待实测”，不会宣称 Windows 12 基座开箱即用。现有 Windows 11 基座在微软支持周期内继续接收 Windows Update；BATCAVE 应用更新与 Windows 大版本无关，不需要换基座。

跨大版本就地升级在 Windows To Go 场景下支持有限，不建议直接升级现有 VHD。更稳妥的路径是：新建 Windows 12 VHD 或 ISO → 安装并验证 → 把旧盘 `data/` 与 `~/Batcave` 迁移到新系统 → 保留旧 VHD 作为回退。

## 六、已知限制

- 可启动 ISO 与 VHD 均已完成挂载结构、WIM 架构和引导项校验；尚未在实体硬件上完成启动回归，首次实体启动仍需人工验证。
- ARM64 镜像可在 x64 宿主机上构建并离线校验，但 x64 宿主不能启动 ARM64 Windows；实体 ARM64 设备上的启动、驱动与游戏兼容性仍需真机验证。
- ARM64 跨架构离线启用 WSL / 虚拟机平台可能不被 DISM 支持；本项目实测两个特性均返回 0，结果同时记录在 `BUILD-INFO-arm64.json`。
- ARM64 上的 CodeForge 原生 x64 组件依赖 Windows 11 ARM64 的 x64 模拟（Prism），性能与兼容性以实际设备为准。
- 镜像不包含 Windows 激活、第三方账号、游戏本体或任何个人凭据。
- Ventoy 的 VHD 启动依赖官方 `ventoy_vhdboot.img`。
- 直写脚本通过 WIM 捕获/展开保留硬链接与 ACL，但仍建议在目标硬件上验证驱动与激活。
- 可启动 ISO 与 VHD 都包含微软 Windows 文件，仅限在自己的合法授权介质上为本机构建，项目不公开分发 Windows。
- 更新器只替换程序层，不升级 Windows 自身、不更新 `node.exe`、不重建 ISO / VHD。
