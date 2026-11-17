/* BATCAVE OS // 软件中心：真实 winget 搜索/安装 + 游戏平台预置 + 注册表与开始菜单枚举 */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;

  const QUICK = [
    { label: 'Steam', q: 'Steam' },
    { label: 'Epic Games', q: 'Epic Games Launcher' },
    { label: 'Ubisoft Connect', q: 'Ubisoft Connect' },
    { label: 'EA app', q: 'EA app' },
    { label: 'Discord', q: 'Discord' },
    { label: '微信', q: 'WeChat' },
    { label: 'QQ', q: 'Tencent QQ' },
    { label: 'Chrome', q: 'Google Chrome' },
    { label: 'VLC', q: 'VLC' },
    { label: 'OBS', q: 'OBS Studio' },
    { label: 'VS Code', q: 'Visual Studio Code' },
    { label: '7-Zip', q: '7zip' }
  ];

  const PLATFORM_META = {
    'Valve.Steam': { key: 'STEAM', tip: 'Steam 库内游戏由 Steam 客户端下载与更新。' },
    'EpicGames.EpicGamesLauncher': { key: 'EPIC', tip: 'Epic 库内游戏由 Epic 启动器下载；领取的游戏需登录账号。' },
    'Ubisoft.Connect': { key: 'UBISOFT', tip: '育碧游戏由 Ubisoft Connect 下载与启动。' },
    'ElectronicArts.EADesktop': { key: 'EA', tip: 'EA 游戏由 EA app 下载与启动。' },
    'Microsoft.GamingApp': { key: 'XBOX', tip: 'Xbox 应用用于 PC Game Pass 与微软商店游戏；需微软账号及对应订阅/许可证，安装走 Microsoft Store 源。' }
  };

  const MUSIC_META = {
    qqmusic: { key: 'QQ MUSIC', tip: 'QQ音乐客户端；登录 QQ/微信账号后同步歌单与会员权益。' },
    netease: { key: 'NETEASE', tip: '网易云音乐客户端；登录网易账号后同步歌单与会员权益。' },
    kugou: { key: 'KUGOU', tip: '酷狗音乐官方安装包：从 download.kugou.com 下载，校验厂商签名后静默安装。' }
  };

  const ACCEL_META = {
    uu: { key: 'UU', tip: '网易UU加速器：安装/更新时从网易官方下载链路取得当前 Windows 安装包，校验 Authenticode 签名后启动官方安装程序。' },
    leigod: { key: 'LEIGOD', tip: '雷神加速器：安装/更新时从雷神官网下载通道取得当前安装包，校验 Authenticode 签名后启动官方安装程序。' },
    xunyou: { key: 'XUNYOU', tip: '迅游加速器：安装/更新时从迅游官网取得在线安装器，校验 Authenticode 签名后启动官方安装程序。' }
  };

  const ACCEL_HOSTS = {
    uu: ['uu.gdl.netease.com'],
    leigod: ['update.leigod.com'],
    xunyou: ['partnerdownload.xunyou.com']
  };
  const ACCEL_SIGNERS = { uu: 'NetEase|网易', leigod: 'LeiGod|雷神', xunyou: 'Xunyou|迅游' };
  const ACCEL_REG = { uu: '网易\\s*UU|UU加速器', leigod: '雷神加速器|LeiGod', xunyou: '迅游加速器|Xunyou' };

  function createStore(body, win) {
    body.innerHTML =
      '<div class="app store-app">' +
        '<div class="store-top">' +
          '<div class="store-tabs"><button class="active" data-st="search">软件库 · winget</button><button data-st="music">音乐客户端</button><button data-st="games">游戏平台</button><button data-st="accelerators">游戏加速器</button><button data-st="updates">检查更新</button><button data-st="installed">已安装</button></div>' +
          '<div class="store-search"><svg class="ic"><use href="#i-search"></use></svg><input id="storeQ" placeholder="搜索 Windows 软件或游戏（真实 winget 源）" spellcheck="false"><button class="btn primary" id="storeGo">搜索</button></div>' +
          '<div class="store-quick">' + QUICK.map(x => '<button class="chip" data-q="' + U.esc(x.q) + '">' + U.esc(x.label) + '</button>').join('') + '</div>' +
        '</div>' +
        '<div class="store-body">' +
          '<div class="store-results" id="storeResults"><div class="store-empty">搜索 winget 软件库，或切到「已安装」查看本机程序。<br><span class="note">安装由 winget 在本机真实执行；UAC 与安装向导可能弹出。游戏启动器装好后，游戏本体仍需在启动器内下载。</span></div></div>' +
          '<div class="store-side">' +
            '<div class="store-console-head"><b>安装输出</b><span id="storeState">IDLE</span><button class="btn small" id="storeStop" disabled>停止</button></div>' +
            '<pre class="store-console" id="storeConsole">等待任务…</pre>' +
            '<div class="store-note">兼容性：这里安装的是真实 Windows 程序。Windows 主机上原生运行；Linux ISO 基座不内置 WINE，Windows 游戏与带反作弊驱动的程序无法在纯 Linux 环境中原生运行。系统不会伪造安装成功。</div>' +
          '</div>' +
        '</div>' +
        '<div class="app-status"><span id="storeStatus" class="ok">READY</span><span>WINGET · REGISTRY · START MENU</span><span class="spacer" style="flex:1"></span><span id="storeCount"></span></div>' +
      '</div>';

    const qInput = body.querySelector('#storeQ');
    const results = body.querySelector('#storeResults');
    const consoleEl = body.querySelector('#storeConsole');
    const stateEl = body.querySelector('#storeState');
    const statusEl = body.querySelector('#storeStatus');
    const countEl = body.querySelector('#storeCount');
    const stopBtn = body.querySelector('#storeStop');
    let tab = 'search';
    let ctrl = null;
    let busy = false;
    let updateAborted = false;
    let installedCache = null;
    let launcherData = null;

    function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = cls || ''; }
    function setState(text) { stateEl.textContent = text; }
    function log(text) {
      consoleEl.textContent += (consoleEl.textContent ? '\n' : '') + text;
      if (consoleEl.textContent.length > 200000) consoleEl.textContent = consoleEl.textContent.slice(-160000);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
    function resetConsole(title) { consoleEl.textContent = title || ''; }

    function switchTab(next) {
      tab = next;
      body.querySelectorAll('[data-st]').forEach(b => b.classList.toggle('active', b.dataset.st === next));
      body.querySelector('.store-top .store-search').style.display = (next === 'installed' || next === 'music' || next === 'accelerators' || next === 'updates') ? 'none' : '';
      body.querySelector('.store-quick').style.display = next === 'search' ? '' : 'none';
      if (next === 'installed') loadInstalled();
      else if (next === 'games') loadLaunchers();
      else if (next === 'music') loadMusic();
      else if (next === 'accelerators') loadAccelerators(true);
      else if (next === 'updates') loadUpdates(false);
    }

    async function doSearch(q) {
      q = String(q || '').trim();
      if (!q) return BC.toast('输入要搜索的软件名');
      setStatus('SEARCHING…', 'warn');
      results.innerHTML = '<div class="store-loading"><span class="term-spinner"></span> 正在查询 winget 源…</div>';
      countEl.textContent = '';
      try {
        const r = await A.appsSearch(q);
        if (!r.available) { results.innerHTML = '<div class="store-empty">' + U.esc(r.message || 'winget 不可用') + '</div>'; setStatus('UNAVAILABLE', 'err'); return; }
        if (!r.packages.length) {
          results.innerHTML = '<div class="store-empty">' + U.esc(r.message || '没有找到匹配的软件包') + '</div>';
          setStatus('NO RESULTS', 'warn');
          return;
        }
        countEl.textContent = r.packages.length + ' 个结果';
        results.innerHTML = r.packages.map((p, i) =>
          '<div class="store-item">' +
            '<div class="store-item-main"><b>' + U.esc(p.name) + '</b><span class="store-pid">' + U.esc(p.id) + '</span></div>' +
            '<div class="store-item-meta"><span>' + U.esc(p.version || '—') + '</span><span class="store-src">' + U.esc(p.source) + '</span></div>' +
            '<button class="btn small primary" data-install="' + i + '">安装</button>' +
          '</div>'
        ).join('');
        results.querySelectorAll('[data-install]').forEach(btn => {
          btn.addEventListener('click', () => install(r.packages[Number(btn.dataset.install)]));
        });
        setStatus('RESULTS · ' + r.packages.length, 'ok');
      } catch (e) {
        results.innerHTML = '<div class="store-empty error">搜索失败：' + U.esc(e.message) + '</div>';
        setStatus('SEARCH FAILED', 'err');
      }
    }

    function runInstall(id, source) {
      return new Promise((resolve) => {
        if (busy) return resolve(false);
        if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(id)) return resolve(false);
        const src = source === 'msstore' ? 'msstore' : 'winget';
        busy = true;
        stopBtn.disabled = false;
        setState('INSTALLING');
        setStatus('INSTALLING · ' + id, 'warn');
        log('> winget install --id ' + id + ' --source ' + src + '\n');
        const cmd = 'winget install --id "' + id + '" --source ' + src + ' --accept-package-agreements --accept-source-agreements --silent';
        let settled = false;
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          busy = false;
          stopBtn.disabled = true;
          ctrl = null;
          installedCache = null;
          launcherData = null;
          resolve(ok);
        };
        A.execStream({ mode: 'powershell', cmd }, {
          onController: (c) => { ctrl = c; },
          onData: (d) => log(d.replace(/\x1b\[[0-9;]*m/g, '')),
          onEnd: (ev) => {
            const code = ev && typeof ev.code === 'number' ? ev.code : null;
            setState(code === 0 ? 'DONE' : 'EXIT ' + code);
            setStatus(code === 0 ? 'INSTALL FINISHED' : 'INSTALL EXIT ' + code, code === 0 ? 'ok' : 'warn');
            finish(code === 0);
          }
        }).catch(e => {
          if (e.risky) {
            log('需要二次确认：' + (e.data && e.data.error || e.message));
            setState('CONFIRM');
            setStatus('NEEDS CONFIRMATION', 'warn');
          } else if (!e.aborted) {
            log('执行失败：' + e.message);
            setState('FAILED');
            setStatus('INSTALL FAILED', 'err');
          }
          finish(false);
        });
      });
    }

    async function install(pkg) {
      if (busy) return BC.toast('已有安装任务在运行');
      resetConsole('> winget install --id ' + pkg.id + '\n');
      const ok = await runInstall(pkg.id);
      if (ok) BC.toast('安装完成：' + pkg.name, { kind: 'ok' });
    }

    function validPkgId(id) { return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(String(id || '')); }

    async function askRemove(name, detail) {
      return BC.ui.confirm('卸载 ' + name, (detail || '将从本机移除该程序及其注册表条目。') +
        '<br><br>卸载程序和删除文件不可撤销；个人数据、存档或歌单是否保留取决于程序自己的卸载器。', { okText: '卸载', cancelText: '取消' });
    }

    async function refreshCurrent() {
      if (tab === 'installed') await loadInstalled();
      else if (tab === 'games') await loadLaunchers();
      else if (tab === 'music') await loadMusic();
      else if (tab === 'accelerators') await loadAccelerators(true);
      else if (tab === 'updates') await loadUpdates(false);
    }

    async function runWingetUninstall(id, name) {
      if (busy) return BC.toast('已有安装/卸载任务在运行');
      if (!validPkgId(id)) return BC.toast('软件包 ID 无效', { kind: 'err' });
      if (!await askRemove(name, '将通过 winget 调用该软件的官方卸载器，从本机移除 ' + name + '。')) return false;
      resetConsole('> winget uninstall --id ' + id + '\n');
      busy = true;
      stopBtn.disabled = false;
      setState('UNINSTALLING');
      setStatus('UNINSTALLING · ' + name, 'warn');
      let code = null;
      try {
        await new Promise((resolve) => {
          A.execStream({
            mode: 'powershell',
            cmd: 'winget uninstall --id "' + id + '" --silent --accept-source-agreements --disable-interactivity'
          }, {
            onController: (c) => { ctrl = c; },
            onData: (d) => log(d.replace(/\x1b\[[0-9;]*m/g, '')),
            onEnd: (ev) => { code = ev && typeof ev.code === 'number' ? ev.code : null; resolve(); }
          }).catch((e) => {
            log(e.aborted ? '[已停止]' : '卸载失败：' + e.message);
            resolve();
          });
        });
      } finally {
        busy = false;
        stopBtn.disabled = true;
        ctrl = null;
        installedCache = null;
        launcherData = null;
        setState(code === 0 ? 'REMOVED' : 'EXIT ' + code);
        setStatus(code === 0 ? 'UNINSTALL FINISHED' : 'UNINSTALL EXIT ' + code, code === 0 ? 'ok' : 'warn');
      }
      BC.toast(code === 0 ? '已卸载：' + name : name + ' 卸载未完成（可查看安装输出）', { kind: code === 0 ? 'ok' : 'err' });
      await refreshCurrent();
      return code === 0;
    }

    async function uninstallRegistry(name) {
      if (busy) return BC.toast('已有安装/卸载任务在运行');
      if (!await askRemove(name, '将调用 ' + name + ' 自带的官方卸载器。若弹出 UAC 或卸载向导，请确认并完成。')) return false;
      setStatus('UNINSTALLING · ' + name, 'warn');
      try {
        const r = await A.appsUninstall(name);
        BC.toast(r.message || (r.ok ? '已启动卸载' : '卸载失败'), { kind: r.ok ? 'ok' : 'err' });
        if (r.ok) {
          installedCache = null;
          launcherData = null;
          setTimeout(() => { refreshCurrent(); }, 4000);
        }
        return !!r.ok;
      } catch (e) {
        BC.toast('卸载失败：' + e.message, { kind: 'err' });
        return false;
      }
    }

    async function runOfficialInstall(app) {
      if (busy) return BC.toast('已有安装任务在运行');
      if (app.id !== 'kugou') return BC.toast('该程序没有可用的官方安装通道', { kind: 'err' });
      resetConsole('> 官方安装：酷狗音乐 download.kugou.com\n');
      busy = true;
      stopBtn.disabled = false;
      setState('INSTALLING');
      setStatus('INSTALLING · 酷狗音乐', 'warn');
      const cmd = "$ErrorActionPreference='Stop'; " +
        "$u='https://download.kugou.com/dl/kugou_pc'; " +
        "$o=Join-Path $env:TEMP ('batcave_kugou_' + [Guid]::NewGuid().ToString('N') + '.exe'); " +
        "Write-Output 'Downloading official Kugou installer...'; " +
        "Invoke-WebRequest -Uri $u -OutFile $o -UseBasicParsing; " +
        "$s=Get-AuthenticodeSignature $o; " +
        "if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'KuGou'){ Remove-Item $o -Force -ErrorAction SilentlyContinue; throw 'Invalid installer signature; aborted' }; " +
        "Write-Output ('Signature OK: ' + $s.SignerCertificate.Subject); " +
        "Start-Process -FilePath $o -ArgumentList '/S' -Wait; " +
        "Remove-Item $o -Force -ErrorAction SilentlyContinue; " +
        "$paths=@('C:/Program Files/Kugou/KGMusic/KuGou.exe','C:/Program Files (x86)/Kugou/KGMusic/KuGou.exe'); " +
        "if(@($paths | Where-Object { Test-Path $_ }).Count -gt 0){ Write-Output 'Kugou installed.'; exit 0 } else { throw 'Installer finished but executable was not found' }";
      let code = null;
      try {
        await new Promise((resolve) => {
          A.execStream({ mode: 'powershell', cmd }, {
            onController: (c) => { ctrl = c; },
            onData: (d) => log(d.replace(/\x1b\[[0-9;]*m/g, '')),
            onEnd: (ev) => { code = ev && typeof ev.code === 'number' ? ev.code : null; resolve(); }
          }).catch((e) => {
            log(e.aborted ? '[已停止]' : '安装失败：' + e.message);
            resolve();
          });
        });
      } finally {
        busy = false;
        stopBtn.disabled = true;
        ctrl = null;
        installedCache = null;
        setState(code === 0 ? 'DONE' : 'EXIT ' + code);
        setStatus(code === 0 ? 'INSTALL FINISHED' : 'INSTALL EXIT ' + code, code === 0 ? 'ok' : 'err');
      }
      BC.toast(code === 0 ? '酷狗音乐安装完成' : '酷狗音乐安装未完成（查看安装输出）', { kind: code === 0 ? 'ok' : 'err' });
      await loadMusic();
    }

    stopBtn.addEventListener('click', () => { if (ctrl) { try { ctrl.abort(); log('\n[任务已停止]'); } catch { } } });

    function renderLaunchers() {
      const data = launcherData;
      if (!data || !data.ok) {
        results.innerHTML = '<div class="store-empty">' + U.esc((data && data.message) || '无法读取游戏平台状态') + '</div>';
        setStatus('UNAVAILABLE', 'err');
        return;
      }
      const installedCount = data.launchers.filter(l => l.installed).length;
      countEl.textContent = installedCount + '/' + data.launchers.length + ' 已就绪';
      const missing = data.launchers.filter(l => !l.installed);
      results.innerHTML =
        '<div class="game-platforms-head">' +
          '<div><b>五大游戏平台</b><span>Steam · Epic Games · Ubisoft Connect · EA app · Xbox</span></div>' +
          '<div class="gp-actions" style="margin-top:0">' +
            '<button class="btn small" id="gpCheck">检查更新</button>' +
            '<button class="btn primary" id="gpAll"' + (busy || !missing.length ? ' disabled' : '') + '>' +
              (missing.length ? '一键预置缺失平台（' + missing.length + '）' : '全部已安装') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="game-platforms">' +
          data.launchers.map(l => {
            const meta = PLATFORM_META[l.id] || { key: 'PLATFORM', tip: '' };
            return '<div class="gp-card' + (l.installed ? ' ready' : '') + '">' +
              '<div class="gp-head"><span class="gp-badge">' + meta.key + '</span><span class="gp-status">' + (l.installed ? '已安装' : '未安装') + '</span></div>' +
              '<b>' + U.esc(l.name) + '</b>' +
              '<span class="gp-version">' + (l.version ? 'v' + U.esc(l.version) : (l.source === 'msstore' ? 'Microsoft Store' : (l.installed ? '已在磁盘' : '官方安装器 · winget'))) + '</span>' +
              '<p>' + U.esc(meta.tip) + '</p>' +
              '<div class="gp-actions">' +
                (l.installed
                  ? (l.appId || l.exe ? '<button class="btn small primary" data-gp-launch="' + U.esc(l.id) + '">启动</button>' : '<span class="note">请从开始菜单启动</span>') +
                    '<button class="btn small danger" data-gp-remove="' + U.esc(l.id) + '">卸载</button>'
                  : '<button class="btn small primary" data-gp-one="' + U.esc(l.id) + '"' + (busy ? ' disabled' : '') + '>安装</button>') +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div class="gp-note"><b>兼容性（实测口径）：</b>当前宿主是 Windows，BATCAVE 只是桌面外壳，五个平台与本机 Windows 使用同一 NT 内核、同一显卡驱动、同一反作弊服务——平台内能玩的游戏，在这里启动后完全一致地运行。' +
        '<br>平台安装器由 winget 从厂商官方源下载（Xbox 走 Microsoft Store 源）；系统不重打包、不改动第三方客户端，游戏本体与更新仍在平台内下载，账号与购买关系归各平台。' +
        '<br>若从 Linux ISO 基座启动则不同：仅 Proton/WINE 可覆盖部分游戏，内核级反作弊无法工作；要“全部游戏同 Windows”，必须使用 Windows 基座镜像，系统不会用 Linux 假装成功。' +
        '<br>平台客户端更新：点上方「检查更新」，winget 会按官方源更新已接管的启动器；启动平台时客户端也会连接厂商服务器自更新。游戏本体的更新始终在平台库内完成。' +
        '<br>卸载：已安装平台卡片右侧有「卸载」按钮，调用平台官方卸载器；平台内游戏请在平台库中卸载，或在本页「已安装」里调用对应卸载程序。卸载不会伪造成功，输出实时可见。</div>';

      const allBtn = body.querySelector('#gpAll');
      if (allBtn) allBtn.addEventListener('click', provisionMissing);
      const gpCheck = body.querySelector('#gpCheck');
      if (gpCheck) gpCheck.addEventListener('click', () => switchTab('updates'));
      results.querySelectorAll('[data-gp-one]').forEach(b => b.addEventListener('click', async () => {
        const l = data.launchers.find(x => x.id === b.dataset.gpOne);
        resetConsole('> winget install --id ' + (l.winget || l.id) + '\n');
        const ok = await runInstall(l.winget || l.id, l.source);
        BC.toast(ok ? l.name + ' 安装完成' : l.name + ' 安装未完成', { kind: ok ? 'ok' : 'err' });
        await loadLaunchers();
      }));
      results.querySelectorAll('[data-gp-launch]').forEach(b => b.addEventListener('click', async () => {
        const l = data.launchers.find(x => x.id === b.dataset.gpLaunch);
        const res = l.appId
          ? await A.appsLaunch('appid', l.appId)
          : await A.appsLaunch('exe', l.exe);
        BC.toast(res.message || (res.ok ? '已请求启动' : '启动失败'), { kind: res.ok ? 'ok' : 'err' });
      }));
      results.querySelectorAll('[data-gp-remove]').forEach(b => b.addEventListener('click', async () => {
        const l = data.launchers.find(x => x.id === b.dataset.gpRemove);
        if (!l) return;
        const ok = await uninstallRegistry(l.name);
        if (!ok) await runWingetUninstall(l.id, l.name);
      }));
      setStatus('PLATFORMS · ' + installedCount + '/' + data.launchers.length, 'ok');
    }

    async function loadLaunchers() {
      setStatus('PROBING PLATFORMS…', 'warn');
      results.innerHTML = '<div class="store-loading"><span class="term-spinner"></span> 正在检测注册表与安装路径…</div>';
      try {
        launcherData = await A.appsLaunchers(true);
        renderLaunchers();
      } catch (e) {
        results.innerHTML = '<div class="store-empty error">检测失败：' + U.esc(e.message) + '</div>';
        setStatus('PROBE FAILED', 'err');
      }
    }

    async function provisionMissing() {
      if (busy) return;
      const missing = (launcherData && launcherData.launchers || []).filter(l => !l.installed);
      if (!missing.length) return;
      resetConsole('> 批量预置：' + missing.map(l => l.name).join(' · ') + '\n');
      setStatus('PROVISIONING · ' + missing.length, 'warn');
      const failed = [];
      for (const l of missing) {
        log('\n=== ' + l.name + ' ===');
        const ok = await runInstall(l.winget || l.id, l.source);
        log(ok ? '[OK] ' + l.name : '[FAILED] ' + l.name);
        if (!ok) failed.push(l.name);
      }
      launcherData = null;
      await loadLaunchers();
      if (failed.length) BC.toast('未完成：' + failed.join('、') + '（可在输出面板查看原因）', { kind: 'err' });
      else BC.toast('五大平台已全部就绪', { kind: 'ok' });
    }

    function updateTabBadge(count) {
      const b = body.querySelector('[data-st="updates"]');
      if (b) b.textContent = count ? '检查更新 · ' + count : '检查更新';
    }

    function isGameUpgrade(id) {
      return Object.prototype.hasOwnProperty.call(PLATFORM_META, id) || id === 'Microsoft.GamingApp';
    }

    function renderUpdates(data) {
      const list = (data && data.upgrades) || [];
      const checked = data && data.checkedAt ? U.fmtDate(data.checkedAt) : '—';
      updateTabBadge(list.length);
      if (!data || !data.ok) {
        results.innerHTML = '<div class="store-empty error">' + U.esc((data && data.message) || '无法读取可升级列表') + '</div>';
        setStatus('UPDATE CHECK FAILED', 'err');
        return;
      }
      const head =
        '<div class="game-platforms-head">' +
          '<div><b>官方更新中心</b><span>winget 官方清单 · 检查于 ' + U.esc(checked) + '</span></div>' +
          '<div class="gp-actions" style="margin-top:0">' +
            '<button class="btn small" id="upCheck">检查更新</button>' +
            (list.length ? '<button class="btn primary" id="upAll">一键更新全部（' + list.length + '）</button>' : '') +
          '</div>' +
        '</div>';
      const note = '<div class="gp-note"><b>更新来源与边界：</b>检查时会先刷新 winget 官方源，再从官方源拉取最新安装包；Microsoft Store 源的软件（如微信、Xbox）通过 msstore 更新。' +
        '<br>只有被 winget 识别的软件才能自动比对版本；未纳入官方清单的自装程序不会出现在这里，需要软件自身的「检查更新」或厂商官网安装包。' +
        '<br>Steam、Epic、Ubisoft Connect、EA app 和音乐客户端启动时也会连接厂商服务器自更新；本页可以同时更新已被 winget 接管的启动器。更新过程中程序可能被关闭，UAC 可能弹出。' +
        '<br>命令输出实时显示在右侧；系统不会伪造“已是最新版”。</div>';
      if (!list.length) {
        results.innerHTML = head + '<div class="store-empty">' + U.esc(data.message || '所有已跟踪软件均为最新版') + '<br><span class="note">点击「检查更新」重新刷新官方源；未纳入 winget 的程序请使用软件自身的更新功能。</span></div>' + note;
        countEl.textContent = '0 项可升级';
        setStatus('UP TO DATE', 'ok');
        body.querySelector('#upCheck').addEventListener('click', () => loadUpdates(true));
        return;
      }
      countEl.textContent = list.length + ' 项可升级 · ' + list.filter(u => isGameUpgrade(u.id)).length + ' 个游戏平台';
      results.innerHTML = head +
        '<div class="store-section">可升级软件 <span>' + list.length + '</span></div>' +
        list.map(u => {
          const game = isGameUpgrade(u.id);
          return '<div class="store-item">' +
            '<div class="store-item-main"><b>' + U.esc(u.name) + '</b><span class="store-pid">' + U.esc(u.id) + '</span></div>' +
            '<div class="store-item-meta"><span>' + U.esc(u.version) + ' → ' + U.esc(u.available) + '</span>' +
              '<span class="store-src">' + (u.source === 'msstore' ? 'MSSTORE' : 'WINGET') + '</span>' +
              (game ? '<span class="store-src">GAME</span>' : '') + '</div>' +
            '<button class="btn small primary" data-update="' + U.esc(u.id) + '"' + (busy ? ' disabled' : '') + '>更新</button>' +
          '</div>';
        }).join('') + note;
      body.querySelector('#upCheck').addEventListener('click', () => loadUpdates(true));
      body.querySelector('#upAll').addEventListener('click', () => upgradeAll(list));
      results.querySelectorAll('[data-update]').forEach(b => b.addEventListener('click', async () => {
        const u = list.find(x => x.id === b.dataset.update);
        if (!u) return;
        resetConsole('> winget upgrade --id ' + u.id + '\n');
        const ok = await execUpgrade(u);
        BC.toast(ok ? u.name + ' 已更新' : u.name + ' 更新未完成（查看右侧输出）', { kind: ok ? 'ok' : 'err' });
        await loadUpdates(true);
      }));
      setStatus('UPDATES · ' + list.length, 'ok');
    }

    async function loadUpdates(force) {
      if (busy) return BC.toast('已有安装/更新任务在运行');
      setStatus(force ? 'REFRESHING SOURCE…' : 'CHECKING UPDATES…', 'warn');
      results.innerHTML = '<div class="store-loading"><span class="term-spinner"></span> ' + (force ? '正在刷新 winget 官方源并比对版本…' : '正在读取可升级列表…') + '</div>';
      countEl.textContent = '';
      try {
        renderUpdates(await A.appsUpgrades(!!force));
      } catch (e) {
        results.innerHTML = '<div class="store-empty error">检查更新失败：' + U.esc(e.message) + '</div>';
        setStatus('UPDATE CHECK FAILED', 'err');
      }
    }

    function execUpgrade(u) {
      return new Promise((resolve) => {
        if (busy) return resolve(false);
        if (!validPkgId(u.id)) return resolve(false);
        const src = u.source === 'msstore' ? 'msstore' : 'winget';
        busy = true;
        stopBtn.disabled = false;
        setState('UPDATING');
        setStatus('UPDATING · ' + u.name, 'warn');
        log('> winget upgrade --id ' + u.id + ' --source ' + src + ' --include-unknown\n');
        const cmd = 'winget upgrade --id "' + u.id + '" --source ' + src + ' --include-unknown --silent --accept-package-agreements --accept-source-agreements';
        let settled = false;
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          busy = false;
          stopBtn.disabled = true;
          ctrl = null;
          installedCache = null;
          launcherData = null;
          resolve(ok);
        };
        A.execStream({ mode: 'powershell', cmd }, {
          onController: (c) => { ctrl = c; },
          onData: (d) => log(d.replace(/\x1b\[[0-9;]*m/g, '')),
          onEnd: (ev) => {
            const code = ev && typeof ev.code === 'number' ? ev.code : null;
            setState(code === 0 ? 'UPDATED' : 'EXIT ' + code);
            setStatus(code === 0 ? 'UPDATE FINISHED' : 'UPDATE EXIT ' + code, code === 0 ? 'ok' : 'warn');
            finish(code === 0);
          }
        }).catch(e => {
          if (e.risky) {
            log('需要二次确认：' + (e.data && e.data.error || e.message));
            setState('CONFIRM');
            setStatus('NEEDS CONFIRMATION', 'warn');
          } else if (!e.aborted) {
            log('更新失败：' + e.message);
            setState('FAILED');
            setStatus('UPDATE FAILED', 'err');
          } else {
            log('[已停止]');
            updateAborted = true;
          }
          finish(false);
        });
      });
    }

    async function upgradeAll(list) {
      if (busy) return BC.toast('已有安装/更新任务在运行');
      if (!list.length) return;
      const ok = await BC.ui.confirm('更新全部软件', '将通过 winget 官方源依次更新 ' + list.length + ' 个程序。更新过程中相关程序可能被关闭，UAC 可能弹出；游戏内的游戏本体更新仍由各平台客户端负责。', { okText: '开始更新', cancelText: '取消' });
      if (!ok) return;
      resetConsole('> 批量更新 ' + list.length + ' 个程序\n');
      updateAborted = false;
      const failed = [];
      for (const u of list) {
        log('\n=== ' + u.name + ' ===');
        const done = await execUpgrade(u);
        log(done ? '[OK] ' + u.name : '[FAILED] ' + u.name);
        if (!done) {
          failed.push(u.name);
          if (updateAborted) break;
        }
      }
      await loadUpdates(true);
      if (failed.length) BC.toast('未完成：' + failed.join('、') + '（可在输出面板查看原因）', { kind: 'err' });
      else BC.toast('全部可升级软件已更新', { kind: 'ok' });
    }

    async function loadMusic() {
      setStatus('PROBING MUSIC CLIENTS…', 'warn');
      results.innerHTML = '<div class="store-loading"><span class="term-spinner"></span> 正在检测 QQ音乐 / 网易云音乐 / 酷狗音乐…</div>';
      try {
        const r = await A.appsEssentials(true);
        const music = (r.essentials || []).filter(x => x.group === 'music');
        if (!music.length) {
          results.innerHTML = '<div class="store-empty">' + U.esc(r.message || '无法读取音乐客户端状态') + '</div>';
          setStatus('UNAVAILABLE', 'err');
          return;
        }
        const installedCount = music.filter(m => m.installed).length;
        countEl.textContent = installedCount + '/' + music.length + ' 已安装';
        results.innerHTML =
          '<div class="game-platforms-head">' +
            '<div><b>三大音乐客户端</b><span>QQ音乐 · 网易云音乐 · 酷狗音乐</span></div>' +
            '<button class="btn small" id="muCheck">检查更新</button>' +
          '</div>' +
          '<div class="game-platforms">' +
            music.map(m => {
              const meta = MUSIC_META[m.id] || { key: 'MUSIC', tip: '' };
              return '<div class="gp-card' + (m.installed ? ' ready' : '') + '">' +
                '<div class="gp-head"><span class="gp-badge">' + meta.key + '</span><span class="gp-status">' + (m.installed ? '已安装' : '未安装') + '</span></div>' +
                '<b>' + U.esc(m.name) + '</b>' +
                '<span class="gp-version">' + (m.version ? 'v' + U.esc(m.version) : (m.winget ? 'winget · ' + U.esc(m.winget) : '官方安装包')) + '</span>' +
                '<p>' + U.esc(meta.tip) + '</p>' +
                '<div class="gp-actions">' +
                  (m.installed
                    ? (m.appId || m.exe
                        ? '<button class="btn small primary" data-mu-launch="' + U.esc(m.id) + '">启动</button>'
                        : '<span class="note">请从开始菜单启动</span>') +
                      '<button class="btn small danger" data-mu-remove="' + U.esc(m.id) + '">卸载</button>'
                    : '<button class="btn small primary" data-mu-install="' + U.esc(m.id) + '"' + (busy ? ' disabled' : '') + '>安装</button>') +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>' +
          '<div class="gp-note"><b>更新与卸载：</b>点上方「检查更新」可让 winget 按官方源更新 QQ音乐、网易云音乐等已接管客户端；酷狗等未纳入清单的程序请使用客户端自身的检查更新。' +
          '<br>卸载：QQ音乐和网易云音乐通过 winget 调用官方卸载器；酷狗音乐使用其自带卸载程序。' +
          '<br>软件中心安装的任何程序都可以在「已安装」页找到卸载入口；如果卸载器询问是否保留个人数据/歌单/存档，按你的选择处理。' +
          '<br>卸载不会伪造“已删除”：命令输出会实时显示在此面板，失败会明确报错。</div>';

        results.querySelectorAll('[data-mu-install]').forEach(b => b.addEventListener('click', async () => {
          const m = music.find(x => x.id === b.dataset.muInstall);
          if (!m) return;
          if (m.winget) {
            resetConsole('> winget install --id ' + m.winget + '\n');
            const ok = await runInstall(m.winget);
            BC.toast(ok ? m.name + ' 安装完成' : m.name + ' 安装未完成', { kind: ok ? 'ok' : 'err' });
            await loadMusic();
          } else {
            await runOfficialInstall(m);
          }
        }));
        const muCheck = body.querySelector('#muCheck');
        if (muCheck) muCheck.addEventListener('click', () => switchTab('updates'));
        results.querySelectorAll('[data-mu-launch]').forEach(b => b.addEventListener('click', async () => {
          const m = music.find(x => x.id === b.dataset.muLaunch);
          const res = m.appId ? await A.appsLaunch('appid', m.appId) : await A.appsLaunch('exe', m.exe);
          BC.toast(res.message || (res.ok ? '已请求启动' : '启动失败'), { kind: res.ok ? 'ok' : 'err' });
        }));
        results.querySelectorAll('[data-mu-remove]').forEach(b => b.addEventListener('click', async () => {
          const m = music.find(x => x.id === b.dataset.muRemove);
          if (!m) return;
          if (m.winget) await runWingetUninstall(m.winget, m.name);
          else await uninstallRegistry(m.name);
        }));
        setStatus('MUSIC · ' + installedCount + '/' + music.length, 'ok');
      } catch (e) {
        results.innerHTML = '<div class="store-empty error">检测失败：' + U.esc(e.message) + '</div>';
        setStatus('PROBE FAILED', 'err');
      }
    }

    function officialAccelUrl(id, raw) {
      let u;
      try { u = new URL(raw); } catch { throw new Error('官方安装地址无效'); }
      const hosts = ACCEL_HOSTS[id] || [];
      if (u.protocol !== 'https:' || hosts.indexOf(u.hostname.toLowerCase()) < 0) throw new Error('安装包不在官方域名：' + u.hostname);
      if (!/\.exe$/i.test(u.pathname)) throw new Error('官方地址不是 .exe 安装包');
      if (/['"`\s\x00-\x1f]/.test(String(raw))) throw new Error('官方安装地址包含不安全字符');
      return u.toString();
    }

    function accelVersionLine(a) {
      if (a.latest) return '官网最新 v' + a.latest;
      if (a.updated) return '官网更新于 ' + U.fmtDate(a.updated);
      if (a.resolved) return '官网在线安装器';
      return '官网版本暂不可用';
    }

    async function runAcceleratorOfficial(a) {
      if (busy) return BC.toast('已有安装/更新任务在运行');
      busy = true;
      stopBtn.disabled = true;
      setState('RESOLVING');
      setStatus('RESOLVING · ' + a.name, 'warn');
      resetConsole('> 解析 ' + a.name + ' 官网最新安装包…\n');
      let code = null;
      try {
        const r = await A.appsAcceleratorResolve(a.id);
        if (!r.ok) throw new Error(r.message || '官网安装包解析失败');
        const dl = officialAccelUrl(a.id, r.download);
        const host = new URL(dl).hostname.toLowerCase();
        resetConsole('> 官方通道：' + host + '\n');
        log('目标：' + a.name + (r.latest ? ' · 官网版本 v' + r.latest : ' · 官网当前最新版'));
        if (r.size) log('安装包大小：' + U.fmtBytes(r.size));
        if (r.updated) log('官网文件时间：' + U.fmtDate(r.updated));
        log('安装程序将校验 Authenticode 签名与发行者，然后启动官方安装向导。\n');
        setState('DOWNLOADING');
        setStatus('DOWNLOADING · ' + a.name, 'warn');
        stopBtn.disabled = false;
        const signer = ACCEL_SIGNERS[a.id];
        const reg = ACCEL_REG[a.id];
        const ps = [
          "$ErrorActionPreference='Stop';",
          "$ProgressPreference='SilentlyContinue';",
          "[Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12;",
          "$u='" + dl + "';",
          "$dlHost=([Uri]$u).Host.ToLower();",
          "if($dlHost -ne '" + host + "'){throw 'Installer host changed'};",
          "$o=Join-Path $env:TEMP ('batcave_acc_'+[Guid]::NewGuid().ToString('N')+'.exe');",
          "Write-Output ('Official installer host: '+$dlHost);",
          "Write-Output 'Downloading latest official installer...';",
          "Add-Type -AssemblyName System.Net.Http;",
          "$client=[Net.Http.HttpClient]::new();",
          "$resp=$client.GetAsync($u,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult();",
          "$resp.EnsureSuccessStatusCode() | Out-Null;",
          "$total=$resp.Content.Headers.ContentLength;",
          "$fs=[IO.File]::Create($o);",
          "$src=$resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult();",
          "$buf=New-Object byte[] 1048576; $read=0; $last=0;",
          "while(($n=$src.Read($buf,0,$buf.Length)) -gt 0){$fs.Write($buf,0,$n); $read+=$n; if($read-$last -ge 16777216){$last=$read; if($total){Write-Output ('Progress: '+[math]::Round($read/1MB,1)+' / '+[math]::Round($total/1MB,1)+' MB')}else{Write-Output ('Progress: '+[math]::Round($read/1MB,1)+' MB')}}};",
          "$src.Close(); $fs.Close(); $client.Dispose();",
          "$len=(Get-Item $o).Length;",
          "if($len -lt 1048576){Remove-Item $o -Force -EA SilentlyContinue; throw 'Downloaded installer is too small'};",
          "Write-Output ('Downloaded '+[math]::Round($len/1MB,1)+' MB');",
          "$sig=Get-AuthenticodeSignature -FilePath $o;",
          "if($sig.Status -ne 'Valid'){Remove-Item $o -Force -EA SilentlyContinue; throw ('Authenticode status: '+$sig.Status)};",
          "$subj=$sig.SignerCertificate.Subject;",
          "if($subj -notmatch '" + signer + "'){Remove-Item $o -Force -EA SilentlyContinue; throw ('Unexpected publisher: '+$subj)};",
          "Write-Output ('Signature OK: '+$subj);",
          "$ver=(Get-Item $o).VersionInfo;",
          "Write-Output ('Installer file version: '+$ver.FileVersion+' / '+$ver.ProductVersion);",
          "Write-Output 'Starting official installer. Confirm UAC and complete the installer window if shown.';",
          "$p=Start-Process -FilePath $o -PassThru;",
          "try{Wait-Process -Id $p.Id -Timeout 240 -ErrorAction Stop}catch{Write-Output 'Installer is still running after 240 seconds. Finish it manually; the installer window stays open.'; exit 3};",
          "Write-Output ('Installer exit code: '+$p.ExitCode);",
          "$keys=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');",
          "$hit=@(); for($i=0;$i -lt 12;$i++){ $hit=@(Get-ItemProperty $keys -EA SilentlyContinue | Where-Object { $_.DisplayName -match '" + reg + "' } | Sort-Object DisplayVersion -Descending | Select-Object -First 1); if($hit.Count -gt 0){break}; Start-Sleep -Seconds 5 };",
          "Remove-Item $o -Force -EA SilentlyContinue;",
          "if($hit.Count -gt 0){Write-Output ('Installed: '+$hit[0].DisplayName+' '+$hit[0].DisplayVersion); exit 0};",
          "Write-Output 'Installer finished, but no matching uninstall registry entry was found. Refresh the list before retrying.'; exit 2"
        ].join(' ');
        await new Promise((resolve) => {
          A.execStream({ mode: 'powershell', cmd: ps }, {
            onController: (c) => { ctrl = c; },
            onData: (d) => log(d.replace(/\x1b\[[0-9;]*m/g, '')),
            onEnd: (ev) => { code = ev && typeof ev.code === 'number' ? ev.code : null; resolve(); }
          }).catch((e) => {
            log(e.aborted ? '[已停止]' : '官方安装失败：' + e.message);
            resolve();
          });
        });
      } catch (e) {
        if (!code) log('官方安装失败：' + e.message);
        setState('FAILED');
        setStatus('OFFICIAL INSTALL FAILED', 'err');
      } finally {
        busy = false;
        stopBtn.disabled = true;
        ctrl = null;
        installedCache = null;
        launcherData = null;
        if (code === 0) {
          setState('DONE');
          setStatus('INSTALL FINISHED · ' + a.name, 'ok');
          BC.toast(a.name + ' 已通过官网安装完成', { kind: 'ok' });
        } else if (code === 3) {
          setState('INSTALLER RUNNING');
          setStatus('INSTALLER STILL RUNNING', 'warn');
          BC.toast(a.name + ' 安装程序仍在运行；完成后再刷新', { kind: 'warn' });
        } else if (!code) {
          setState('FAILED');
          setStatus('OFFICIAL INSTALL FAILED', 'err');
          BC.toast(a.name + ' 官方安装未完成（查看右侧输出）', { kind: 'err' });
        } else {
          setState('EXIT ' + code);
          setStatus('INSTALL EXIT ' + code, 'err');
          BC.toast(a.name + ' 官方安装未完成（查看右侧输出）', { kind: 'err' });
        }
        if (tab === 'accelerators') await loadAccelerators(true);
      }
    }

    function renderAccelerators(data) {
      if (!data || !data.ok) {
        results.innerHTML = '<div class="store-empty">' + U.esc((data && data.message) || '无法读取游戏加速器状态') + '</div>';
        setStatus('UNAVAILABLE', 'err');
        return;
      }
      const list = data.accelerators || [];
      const installedCount = list.filter(a => a.installed).length;
      countEl.textContent = installedCount + '/' + list.length + ' 已安装';
      results.innerHTML =
        '<div class="game-platforms-head">' +
          '<div><b>三大游戏加速器</b><span>网易UU · 雷神 · 迅游 · 官网实时下载</span></div>' +
          '<button class="btn small" id="accRefresh">刷新官网版本</button>' +
        '</div>' +
        '<div class="game-platforms">' +
          list.map(a => {
            const meta = ACCEL_META[a.id] || { key: 'ACCEL', tip: '' };
            const canLaunch = a.installed && (a.appId || a.exe);
            const primary = !a.installed
              ? '<button class="btn small primary" data-acc-install="' + U.esc(a.id) + '"' + (busy ? ' disabled' : '') + '>安装</button>'
              : '<button class="btn small primary" data-acc-install="' + U.esc(a.id) + '"' + (busy ? ' disabled' : '') + '>' +
                  (a.updateAvailable ? '更新到 v' + U.esc(a.latest) : (a.latest ? '重装 / 修复' : '更新（官网最新）')) + '</button>';
            return '<div class="gp-card' + (a.installed ? ' ready' : '') + '">' +
              '<div class="gp-head"><span class="gp-badge">' + meta.key + '</span><span class="gp-status">' + (a.installed ? '已安装' : '未安装') + '</span></div>' +
              '<b>' + U.esc(a.name) + '</b>' +
              '<span class="gp-version">' +
                (a.installed ? (a.version ? '已安装 v' + U.esc(a.version) : '已安装') + ' · ' : '') +
                '<span class="' + (a.error ? 'note' : '') + '">' + U.esc(accelVersionLine(a)) + '</span>' +
              '</span>' +
              '<p>' + U.esc(meta.tip) + '</p>' +
              '<div class="gp-actions">' +
                (canLaunch ? '<button class="btn small primary" data-acc-launch="' + U.esc(a.id) + '">启动</button>' : '') +
                primary +
                '<button class="btn small" data-acc-site="' + U.esc(a.id) + '">官网</button>' +
                (a.installed && a.displayName ? '<button class="btn small danger" data-acc-remove="' + U.esc(a.displayName) + '">卸载</button>' : '') +
              '</div>' +
              (a.error ? '<div class="gp-note" style="margin-top:8px"><b>官网信息：</b>' + U.esc(a.error) + '<br>仍可点击「官网」手动下载；安装通道不可用时会明确报错，不会伪造成功。</div>' : '') +
            '</div>';
          }).join('') +
        '</div>' +
        '<div class="gp-note"><b>官方更新口径：</b>每次安装或更新都会重新解析厂商官网当前安装包，只允许 HTTPS 官方域名，下载后必须通过 Windows Authenticode 签名校验且发行者匹配，随后才启动官方安装程序。' +
        '<br>UU 与雷神会显示官网解析到的版本号；迅游官网只提供在线安装器、不公开版本号，因此显示官网文件更新时间，安装时会输出安装包的真实文件版本。系统不会用第三方下载站的版本冒充官网版本。' +
        '<br>安装/更新会打开厂商官方安装向导，UAC 与向导步骤需本人确认；加速器属于第三方付费服务，账号、订阅与节点质量由厂商负责。' +
        '<br>安装完成后若检测不到注册表项，会明确返回失败而不是标记成功；可稍后点「刷新官网版本」重新检测。</div>';

      const refresh = body.querySelector('#accRefresh');
      if (refresh) refresh.addEventListener('click', () => loadAccelerators(true));
      results.querySelectorAll('[data-acc-install]').forEach(b => b.addEventListener('click', async () => {
        const a = list.find(x => x.id === b.dataset.accInstall);
        if (a) await runAcceleratorOfficial(a);
      }));
      results.querySelectorAll('[data-acc-launch]').forEach(b => b.addEventListener('click', async () => {
        const a = list.find(x => x.id === b.dataset.accLaunch);
        if (!a) return;
        const res = a.appId ? await A.appsLaunch('appid', a.appId) : await A.appsLaunch('exe', a.exe);
        BC.toast(res.message || (res.ok ? '已请求启动' : '启动失败'), { kind: res.ok ? 'ok' : 'err' });
      }));
      results.querySelectorAll('[data-acc-site]').forEach(b => b.addEventListener('click', () => {
        const a = list.find(x => x.id === b.dataset.accSite);
        if (a && a.official) BC.openApp('browser', { url: a.official });
      }));
      results.querySelectorAll('[data-acc-remove]').forEach(b => b.addEventListener('click', async () => {
        await uninstallRegistry(b.dataset.accRemove);
        if (tab === 'accelerators') await loadAccelerators(true);
      }));
      setStatus('ACCELERATORS · ' + installedCount + '/' + list.length, 'ok');
    }

    async function loadAccelerators(force) {
      setStatus('RESOLVING OFFICIAL SOURCES…', 'warn');
      results.innerHTML = '<div class="store-loading"><span class="term-spinner"></span> 正在读取官网版本并检测本机安装状态…</div>';
      countEl.textContent = '';
      try {
        renderAccelerators(await A.appsAccelerators(!!force));
      } catch (e) {
        results.innerHTML = '<div class="store-empty error">检测失败：' + U.esc(e.message) + '</div>';
        setStatus('PROBE FAILED', 'err');
      }
    }

    async function loadInstalled() {
      setStatus('READING REGISTRY…', 'warn');
      results.innerHTML = '<div class="store-loading"><span class="term-spinner"></span> 正在读取注册表与开始菜单…</div>';
      try {
        const r = await A.appsInstalled(true);
        installedCache = r;
        const apps = r.apps || [];
        const packages = r.packages || [];
        const start = r.start || [];
        countEl.textContent = apps.length + ' 个程序 · ' + packages.length + ' 个 winget 包 · ' + start.length + ' 个开始菜单项';
        const startByName = new Map();
        start.forEach(s => { if (!startByName.has(s.name.toLowerCase())) startByName.set(s.name.toLowerCase(), s); });
        const rows = apps.map((a) => {
          const s = startByName.get(a.name.toLowerCase());
          return '<div class="store-item">' +
            '<div class="store-item-main"><b>' + U.esc(a.name) + '</b><span class="store-pid">' + U.esc(a.publisher || '') + (a.version ? ' · v' + U.esc(a.version) : '') + '</span></div>' +
            '<div class="store-item-meta">' + (s ? '<span class="store-src">START</span>' : '') + '</div>' +
            '<div class="store-item-actions">' +
              (s ? '<button class="btn small primary" data-launch-appid="' + U.esc(s.appId) + '">启动</button>' : '') +
              (a.location ? '<button class="btn small" data-launch-dir="' + U.esc(a.location) + '">目录</button>' : '') +
              (a.canUninstall ? '<button class="btn small danger" data-uninstall-app="' + U.esc(a.name) + '">卸载</button>' : '') +
            '</div></div>';
        }).join('');
        const startOnly = start.filter(s => !apps.some(a => a.name.toLowerCase() === s.name.toLowerCase()));
        const pkgRows = packages.map(p =>
          '<div class="store-item"><div class="store-item-main"><b>' + U.esc(p.name) + '</b><span class="store-pid">' + U.esc(p.id) + '</span></div>' +
          '<div class="store-item-meta"><span>' + U.esc(p.version || '—') + '</span><span class="store-src">WINGET</span></div>' +
          '<button class="btn small danger" data-uninstall-winget="' + U.esc(p.id) + '" data-winget-name="' + U.esc(p.name) + '">卸载</button></div>'
        ).join('');
        const startRows = startOnly.slice(0, 80).map(s =>
          '<div class="store-item"><div class="store-item-main"><b>' + U.esc(s.name) + '</b><span class="store-pid">START MENU</span></div>' +
          '<div class="store-item-meta"></div><button class="btn small primary" data-launch-appid="' + U.esc(s.appId) + '">启动</button></div>'
        ).join('');
        results.innerHTML = '<div class="store-section">已安装程序 <span>' + apps.length + '</span></div>' + (rows || '<div class="store-empty">未读取到注册表程序</div>') +
          '<div class="store-section">winget 软件包（便携或未注册） <span>' + packages.length + '</span></div>' + (pkgRows || '<div class="store-empty">未读取到额外的 winget 包</div>') +
          '<div class="store-section">开始菜单 <span>' + start.length + '</span></div>' + (startRows || '<div class="store-empty">未读取到开始菜单项</div>');
        results.querySelectorAll('[data-launch-appid]').forEach(b => b.addEventListener('click', async () => {
          const res = await A.appsLaunch('appid', b.dataset.launchAppid);
          BC.toast(res.message || (res.ok ? '已请求启动' : '启动失败'), { kind: res.ok ? 'ok' : 'err' });
        }));
        results.querySelectorAll('[data-launch-dir]').forEach(b => b.addEventListener('click', async () => {
          const res = await A.appsLaunch('dir', b.dataset.launchDir);
          BC.toast(res.message || (res.ok ? '已打开目录' : '打开失败'), { kind: res.ok ? 'ok' : 'err' });
        }));
        results.querySelectorAll('[data-uninstall-app]').forEach(b => b.addEventListener('click', async () => {
          const ok = await uninstallRegistry(b.dataset.uninstallApp);
          if (ok) { installedCache = null; }
        }));
        results.querySelectorAll('[data-uninstall-winget]').forEach(b => b.addEventListener('click', async () => {
          await runWingetUninstall(b.dataset.uninstallWinget, b.dataset.wingetName);
        }));
        setStatus('INSTALLED · ' + apps.length, 'ok');
      } catch (e) {
        results.innerHTML = '<div class="store-empty error">读取失败：' + U.esc(e.message) + '</div>';
        setStatus('READ FAILED', 'err');
      }
    }

    body.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.st)));
    body.querySelector('#storeGo').addEventListener('click', () => doSearch(qInput.value));
    qInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(qInput.value); } });
    body.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => { qInput.value = b.dataset.q; doSearch(b.dataset.q); }));

    win.setTitle('软件中心', 'WINGET DEPOT');
    return () => { if (ctrl) { try { ctrl.abort(); } catch { } } };
  }

  BC.registerApp({
    id: 'store', name: '软件中心', en: 'APP DEPOT', icon: 'store', color: '#ffc64d',
    width: 1100, height: 720, minWidth: 700, minHeight: 460, singleton: true,
    desc: 'winget 真实安装 · 五大游戏平台预置',
    mount(body, win) { return createStore(body, win); }
  });
})();