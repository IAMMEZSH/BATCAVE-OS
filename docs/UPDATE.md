# 系统更新说明

BATCAVE OS 从早期版本起内置更新中心。它解决的是一个具体问题：**换新版本不应该等于重装系统。** 程序层可以单独替换，个人数据与 Windows 基座（可启动 ISO 安装的系统盘或 Windows To Go 盘）保持不动。

## 更新什么，不更新什么

| 会更新 | 不更新 |
| --- | --- |
| `server.js`、`bin/`、`lib/` | `data/`（会话、虚拟文件系统、内嵌应用数据） |
| `public/`（桌面、面板、样式） | `~/Batcave`（本机文件映射根目录） |
| `embedded/`（TenSaint73OS、环球报阁、CodeForge 发行包） | `node.exe` 与 Node.js 运行时 |
| `docs/`、`README.md`、`LICENSE` | Windows 系统本体、驱动、激活状态 |
| `version.json`、`package.json` | Windows 基座：ISO 安装的系统盘、Windows To Go 的 VHD / U 盘分区 |
| `update/sources.json` | `.tsowner`、`OWNER.pin`、`auth.json`、`system.db` |

更新包本身不含 `update/latest.json`，避免"清单描述自己"的循环；但升级后仍保留 `update/sources.json`，可继续检查后续版本。

### Windows 基座与 Windows 12

更新中心不负责给 Windows 打补丁。基座里的完整 Windows 继续通过 **Windows Update** 获取质量更新、驱动与安全补丁；BATCAVE 更新只替换程序层，不会修改系统分区或引导文件。

只有当你要更换 Windows 大版本、调整分区或升级内嵌 `node.exe` 时，才需要重建基座：重装用可启动 ISO，随身用 VHD。Windows 12 发布后，可把同一构建脚本的 `-Iso` 指向 Windows 12 官方 ISO 重新构建，但 DISM 映像布局、`$OEM$` 安装行为、OOBE 注册表项、ARM64 Node.js 与 Prism 兼容性必须重新实测。应用更新与 Windows 大版本完全无关，不需要为了升级 BATCAVE 而重装系统。详见 [Windows 基座构建与部署](BUILD-ISO.md#五windows-12-与后续基座)。

## 使用更新中心

### 1. 打开

桌面或开始菜单 → **系统更新**（窗口标题 `UPDATE CENTER`）。

### 2. 选择来源

界面顶部有两个按钮：**GitHub** 与 **GitCode**。选择会保存到浏览器本地（`bc.update.source`），下次打开保持。

- 选择 GitHub：先尝试 GitHub 的多个清单地址，失败则自动尝试 GitCode。
- 选择 GitCode：顺序相反。
- 实际使用的来源会显示在结果卡片上；发生回退时会标注"已切换到另一来源"。

国内网络访问 GitHub 不稳定时，选择 GitCode 通常更快。

### 3. 检查更新

点击 **检查更新**。更新器会：

1. 并行请求所选平台的多个清单 URL（原始文件、网页 raw、API 内容接口），单个 8 秒超时。
2. 校验清单结构：版本号、发布说明、资产 URL、SHA-256、字节数。
3. 要求资产 URL 为 HTTPS 且命中主机白名单。
4. 与当前版本做数字段比较（`3.10.0 > 3.9.9`，不是字符串比较）。
5. 显示"已是最新"或"发现新版本"，并列出更新说明与包大小。

### 4. 下载并安装

点击 **下载并安装**，界面依次显示：

| 阶段 | 说明 |
| --- | --- |
| 下载 | 流式写入 `data/updates/`，显示百分比、已下载 / 总字节 |
| 校验 | 重新计算 SHA-256，并核对字节数 |
| 解压 | 内置 ZIP 读取器逐条校验 CRC32 与解压尺寸 |
| 结构检查 | 必需文件、版本一致性、禁用文件与路径 |
| 替换 | 备份当前条目后逐个替换，显示"已替换 xxx" |
| 完成 | 显示"更新已安装，重启 BATCAVE 后生效" |

下载期间可以关闭窗口，任务在服务端继续；再次打开会读取任务状态。

### 5. 重启

点击 **重启 BATCAVE**：

1. 服务启动 `lib/restart-helper.js`，延迟 2.5 秒。
2. 旧进程退出；助手用相同端口、主机、数据目录与参数拉起新进程。
3. 旧会话令牌通过 `BATCAVE_TOKEN` 环境变量传递给新进程，因此页面不需要重新获取令牌。
4. 前端轮询 `/api/hello`，确认版本号变化后自动刷新。
5. 启动时 `lib/update.js` 检测到"已安装版本 = 当前运行版本"，自动清除 `restartRequired`。

若自动刷新未发生，手动刷新浏览器即可。

### 6. 更新历史

更新中心底部列出最近 30 次安装记录：版本、代号、来源、安装时间、上一版本。数据在 `data/updates/history.json`。

## 发布新版本（维护者）

### 1. 准备

1. 修改 `version.json`：`version`、`codename`、`released`。
2. 更新 `CHANGELOG.md` 与 `update/latest.json` 的 `notes`（中文，面向用户）。
3. 同步 `package.json` 的版本号。
4. 运行测试：

```bash
node --test test/update.test.js
```

### 2. 打包

```bash
node tools/package-update.js
```

输出：

```text
dist/BATCAVE-OS-<version>.zip
dist/SHA256SUMS.txt
```

同时把真实字节数与 SHA-256 写回 `update/latest.json` 的两个平台资产。打包器会拒绝：

- 缺失 `server.js` 或 `update/sources.json`
- 把 `update/latest.json` 打进包
- 符号链接、空文件、日志、`data/`（`public/geo/app/data/` 除外）、`iso/`、`test/`、`tools/`、`node_modules/`、`memory/`

列出包内容（Windows PowerShell）：

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::OpenRead("$PWD\dist\BATCAVE-OS-3.1.3.zip").Entries |
  Select-Object FullName, Length | Sort-Object FullName
```

确认顶层只有 `server.js`、`bin`、`lib`、`public`、`embedded`、`docs`、`update/sources.json`、`README.md`、`LICENSE`、`version.json`、`package.json`，且没有 `update/latest.json`。

### 3. 发布

1. 把 ZIP 与 `SHA256SUMS.txt` 上传到 GitHub Release 与 GitCode Release，标签均为 `v<version>`。
2. 把更新后的 `update/latest.json` 提交到两个仓库的默认分支（更新器从 `raw` / API 内容接口读取）。
3. 两个平台的资产必须**字节一致**，SHA-256 相同。
4. 确认 `update/sources.json` 中的仓库地址与实际仓库一致。
5. 用旧版本安装实测一次更新，再发布公告。

### 4. 校验线上清单

```bash
curl -L https://raw.githubusercontent.com/IAMMEZSH/BATCAVE-OS/main/update/latest.json
# GitCode 的 raw 域名可能返回 403，改用 API 内容接口（content 字段为 Base64）：
curl -L "https://api.gitcode.com/api/v5/repos/gcw_So3EkhfR/BATCAVE-OS/contents/update/latest.json?ref=main"
```

两条返回的 `assets.github` / `assets.gitcode` 都应指向可匿名下载的 Release 资产，且 SHA-256 与本地 `dist/SHA256SUMS.txt` 一致。

## 清单格式

```json
{
  "schema": 1,
  "version": "3.1.3",
  "codename": "SENTINEL",
  "released": "2026-11-18",
  "notes": "中文更新说明，最长 30000 字符",
  "notesUrl": "https://github.com/IAMMEZSH/BATCAVE-OS/releases/tag/v3.1.3",
  "notesUrls": {
    "github": "https://github.com/IAMMEZSH/BATCAVE-OS/releases/tag/v3.1.3",
    "gitcode": "https://gitcode.com/gcw_So3EkhfR/BATCAVE-OS/releases/v3.1.3"
  },
  "assets": {
    "github": { "url": "https://.../BATCAVE-OS-3.1.3.zip", "sha256": "64位十六进制", "size": 12345678 },
    "gitcode": { "url": "https://.../BATCAVE-OS-3.1.3.zip", "sha256": "64位十六进制", "size": 12345678 }
  }
}
```

约束：

- `version` 必须是 `x.y.z` 纯数字三段。
- 每个资产必须有 `url`、64 位十六进制 `sha256`、正整数字节数。
- 包大小上限 256 MiB，解压总量上限 1 GiB，单文件上限 64 MiB，条目上限 20000。
- GitHub / GitCode 的 API 内容接口可能返回 base64 包装，更新器会自动解包后再校验。

## 安全模型

| 风险 | 对策 |
| --- | --- |
| 清单被替换 | 只允许 HTTPS + 固定主机白名单；不允许任意镜像 |
| 重定向到恶意站点 | 手动跟随最多 6 跳，每一跳重新校验主机 |
| 下载内容被篡改 | 边下边算 SHA-256，与清单比对；同时核对字节数 |
| ZIP 路径穿越 | 拒绝 `..`、绝对路径、盘符、空路径段；目标必须位于暂存目录内 |
| ZIP 炸弹 | 条目数、单文件、总解压量、压缩包大小四重限制 |
| 符号链接/加密条目 | 直接拒绝 |
| 更新包夹带凭据 | `validateStaging` 与打包器双重禁止 `.tsowner`、`OWNER.pin`、`auth.json`、`system.db` |
| 替换中途失败 | 事务日志 + 备份目录，逐条回滚 |
| 替换后进程崩溃 | 下次启动 `init()` 恢复未完成事务 |
| 更新包版本与清单不符 | `version.json` 必须等于清单 `version` |
| 重启后会话丢失 | `BATCAVE_TOKEN` 延续原令牌（仍不落盘） |

## 失败与恢复

### 自动回滚

替换阶段任何一步抛错，更新器会按已完成条目逆序恢复：

- 目录：删除新目录，把备份目录移回原位。
- 文件：用备份覆盖。
- 新增条目：若原本不存在，直接删除。

之后 `transaction.json` 标记为 `failed`，界面显示错误，可重新检查并重试。

### 启动恢复

如果进程在替换中途被强制结束，下次启动时：

1. 读取 `data/updates/transaction.json`。
2. 对每个条目检查"当前文件"与"回滚备份"。
3. 删除半成品、恢复备份，把动作写入 `recovery.json`。
4. 删除事务文件。

### 手动恢复

备份位于：

```text
data/updates/rollback-<version>-<jobId>/
```

把其中需要恢复的顶层条目复制回程序根目录即可。恢复前先停止服务，避免文件占用。

### 完全手动升级

若两个平台都无法访问：

1. 下载 `BATCAVE-OS-<version>.zip` 与 `SHA256SUMS.txt`。
2. 校验：`sha256sum BATCAVE-OS-<version>.zip`（Windows 可用 `Get-FileHash`）。
3. 停止 BATCAVE 服务。
4. 解压并覆盖程序目录的 `server.js`、`bin/`、`lib/`、`public/`、`embedded/`、`docs/`、`README.md`、`LICENSE`、`version.json`、`package.json`、`update/sources.json`。
5. **保留** `data/`、`node.exe`、`iso/` 与个人文件。
6. 重新启动 `node server.js`。

## 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 检查更新转圈后报错 | 两个平台都不可达 / DNS / 代理 | 切换来源；确认能打开 Release 页面；稍后重试 |
| 提示"manifest host not allowed" | 清单或资产 URL 不在白名单 | 检查 `update/sources.json` 与清单中的 URL 主机 |
| 提示"sha256 mismatch" | 资产被替换、下载不完整或清单未更新 | 重新下载；核对 Release 资产与 `update/latest.json` |
| 提示"update payload missing ..." | ZIP 不是用 `tools/package-update.js` 生成 | 重新打包，确认顶层结构完整 |
| 提示"version mismatch" | ZIP 内 `version.json` 与清单不一致 | 修改 `version.json` 后重新打包 |
| 一直显示"等待重启" | 新进程没有成功启动 | 查看 `data/updates/restart.log`；手动重启服务 |
| 重启后仍是旧版本 | 新进程启动失败并退回旧进程 | 查看 `server.err.log`、`restart.log`，检查端口占用与文件权限 |
| 更新后页面空白 | 前端缓存或替换不完整 | 强制刷新（Ctrl+F5）；检查 `public/index.html` 是否存在 |
| 离线环境 | 更新器需要联网 | 使用"完全手动升级"流程 |

重启日志位于 `data/updates/restart.log`，包含助手启动参数与子进程 PID，不包含令牌明文。

## 已知限制

- 更新器不升级 Windows、驱动、BIOS 或 `node.exe`。
- 更新器不重建可启动 ISO 或 Windows To Go 的 VHD；系统盘中的 BATCAVE 程序层（ISO 安装位于 `C:\BATCAVE-OS`）可以直接更新，Windows 本体仍需 Windows Update。
- 可启动 ISO 与 VHD 均包含微软 Windows 文件，仅限在自己的合法授权介质上为本机构建，项目不公开分发。
- 更新包不包含 `data/`，因此新版本新增的默认数据文件只会在首次启动时按需生成。
- 若同时打开多个 BATCAVE 标签页，重启后它们都会尝试重新连接；以最先完成轮询的标签页为准。
- GitHub / GitCode 的匿名下载可能触发限流；更新器会回退到另一平台，但不保证永久高速。
