/* BATCAVE OS // core applications: monitor, settings, notes, calculator, vault, music, gallery */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ================================================================ MONITOR */
  function createMonitor(body, win) {
    body.innerHTML =
      '<div class="app monitor-app">' +
        '<div class="app-toolbar">' +
          '<span class="toolbar-title">系统监视器</span><span class="toolbar-sub">SENTINEL TELEMETRY</span>' +
          '<span class="spacer"></span><span class="chip" id="monPulse"><span class="term-spinner"></span>LIVE · 2s</span>' +
          '<button class="icon-btn" data-m="pause" title="暂停采样">' + U.icon('pause') + '</button>' +
          '<button class="icon-btn" data-m="refresh" title="立即刷新">' + U.icon('refresh') + '</button>' +
        '</div>' +
        '<div class="gauge-row">' +
          '<div class="gauge"><div class="ring" id="ringCpu" style="--p:0"><b>0<small>CPU</small></b></div><div class="gauge-info"><b>处理器负载</b><span id="gCpu">等待采样…</span></div></div>' +
          '<div class="gauge"><div class="ring" id="ringMem" style="--p:0"><b>0<small>MEM</small></b></div><div class="gauge-info"><b>内存压力</b><span id="gMem">等待采样…</span></div></div>' +
          '<div class="gauge"><div class="ring" id="ringDisk" style="--p:0"><b>0<small>DISK</small></b></div><div class="gauge-info"><b>磁盘占用</b><span id="gDisk">等待采样…</span></div></div>' +
        '</div>' +
        '<div class="monitor-body">' +
          '<div class="monitor-card"><h4>CPU LOAD · 60 SAMPLES</h4><canvas class="spark" id="cpuSpark"></canvas></div>' +
          '<div class="monitor-card"><h4>MEMORY PRESSURE</h4><canvas class="spark" id="memSpark"></canvas></div>' +
          '<div class="monitor-card"><h4>NETWORK INTERFACES</h4><div class="iface-list" id="monIfaces"><span style="font-family:var(--mono);font-size:9px;color:var(--dim)">检测中…</span></div></div>' +
          '<div class="monitor-card"><h4>COMMAND BRIDGE</h4><div class="mode-list" id="monModes"></div></div>' +
          '<div class="monitor-card"><h4>RUNTIME</h4><div id="monRuntime"></div></div>' +
        '</div>' +
        '<div class="app-status"><span class="ok" id="monStatus">INITIALIZING</span><span id="monNode">NODE</span><span class="spacer"></span><span id="monTime">—</span></div>' +
      '</div>';

    const histCpu = Array(60).fill(0), histMem = Array(60).fill(0);
    let timer = null, paused = false, last = null, disposed = false;

    function ring(el, pct) {
      const v = Math.round(U.clamp(pct || 0, 0, 100));
      el.style.setProperty('--p', v);
      el.querySelector('b').innerHTML = v + '<small>' + el.id.replace('ring', '').toUpperCase() + '</small>';
    }
    function drawSpark(cv, data) {
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(60, cv.clientWidth || 240), h = Math.max(40, cv.clientHeight || 88);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const css = getComputedStyle(document.documentElement);
      const acc = (css.getPropertyValue('--acc') || '#5ffbf1').trim();
      ctx.strokeStyle = 'rgba(120,160,170,.13)'; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) { const y = h * i / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      const step = w / Math.max(1, data.length - 1);
      ctx.beginPath();
      data.forEach((v, i) => { const x = i * step, y = h - (U.clamp(v, 0, 100) / 100) * (h - 5) - 2; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = acc; ctx.lineWidth = 1.5; ctx.shadowColor = acc; ctx.shadowBlur = 7; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(95,251,241,.16)'); grad.addColorStop(1, 'rgba(95,251,241,0)');
      ctx.fillStyle = grad; ctx.fill();
    }
    function drawAll() { if (last) { drawSpark($('#cpuSpark', body), histCpu); drawSpark($('#memSpark', body), histMem); } }
    function render(s) {
      last = s;
      const cpu = Number(s.cpu.usage) || 0;
      const mem = s.mem.total ? (s.mem.used / s.mem.total) * 100 : 0;
      const disk = s.disk && s.disk.total ? (s.disk.used / s.disk.total) * 100 : 0;
      histCpu.push(cpu); histCpu.shift(); histMem.push(mem); histMem.shift();
      ring($('#ringCpu', body), cpu); ring($('#ringMem', body), mem); ring($('#ringDisk', body), disk);
      $('#gCpu', body).textContent = s.cpu.count + ' threads · ' + s.cpu.model;
      $('#gMem', body).textContent = U.fmtBytes(s.mem.used) + ' / ' + U.fmtBytes(s.mem.total);
      $('#gDisk', body).textContent = s.disk ? U.fmtBytes(s.disk.used) + ' / ' + U.fmtBytes(s.disk.total) : '磁盘信息不可用';
      const ifaces = $('#monIfaces', body);
      ifaces.innerHTML = s.ifaces.length
        ? s.ifaces.map(i => '<div class="iface"><span>' + U.esc(i.name) + '</span><b>' + U.esc(i.address) + '</b></div>').join('')
        : '<span style="font-family:var(--mono);font-size:9px;color:var(--dim)">无外部网络接口</span>';
      $('#monModes', body).innerHTML = (s.bridge.modes || []).map(m =>
        '<div class="mode-row"><span class="dot" style="color:' + (m.available ? 'var(--ok)' : 'var(--dim)') + '">●</span><b>' + U.esc(m.label || m.id) + '</b><span>' + (m.available ? 'READY' : 'OFFLINE') + '</span></div>'
      ).join('');
      $('#monRuntime', body).innerHTML =
        '<div class="kv"><span>HOST</span><b>' + U.esc(s.hostname) + '</b></div>' +
        '<div class="kv"><span>PLATFORM</span><b>' + U.esc(s.platform + ' ' + s.release) + '</b></div>' +
        '<div class="kv"><span>ARCH</span><b>' + U.esc(s.arch) + '</b></div>' +
        '<div class="kv"><span>UPTIME</span><b>' + U.fmtDuration(s.uptime * 1000) + '</b></div>' +
        '<div class="kv"><span>SERVER</span><b>v' + U.esc(s.server.version) + ' · pid ' + s.server.pid + '</b></div>';
      $('#monNode', body).textContent = 'NODE ' + s.server.node + ' · PORT ' + s.server.port;
      $('#monTime', body).textContent = new Date(s.time).toLocaleTimeString();
      $('#monStatus', body).textContent = 'TELEMETRY ONLINE'; $('#monStatus', body).className = 'ok';
      drawAll();
    }
    async function tick() {
      if (paused || disposed) return;
      try { render(await A.stats()); }
      catch (e) {
        $('#monStatus', body).textContent = 'SIGNAL LOST · ' + e.message;
        $('#monStatus', body).className = 'err';
      }
    }
    $('[data-m="pause"]', body).addEventListener('click', e => {
      paused = !paused;
      const b = $('[data-m="pause"]', body);
      b.innerHTML = U.icon(paused ? 'play' : 'pause');
      b.title = paused ? '继续采样' : '暂停采样';
      $('#monPulse', body).innerHTML = paused ? 'PAUSED' : '<span class="term-spinner"></span>LIVE · 2s';
      $('#monStatus', body).textContent = paused ? 'SAMPLING PAUSED' : 'TELEMETRY ONLINE';
      $('#monStatus', body).className = paused ? 'warn' : 'ok';
      if (!paused) tick();
    });
    $('[data-m="refresh"]', body).addEventListener('click', tick);
    tick();
    timer = setInterval(tick, 2000);
    const onResize = U.debounce(drawAll, 120);
    window.addEventListener('resize', onResize);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('resize', onResize); };
  }

  /* ================================================================ SETTINGS */
  function createSettings(body, win) {
    body.innerHTML =
      '<div class="app settings-app">' +
        '<div class="settings-layout">' +
          '<nav class="settings-nav">' +
            '<button data-sec="appearance" class="on">' + U.icon('settings') + '<span>外观</span></button>' +
            '<button data-sec="account">' + U.icon('user') + '<span>账户</span></button>' +
            '<button data-sec="network">' + U.icon('wifi') + '<span>网络</span></button>' +
            '<button data-sec="system">' + U.icon('cpu') + '<span>系统</span></button>' +
            '<button data-sec="about">' + U.icon('info') + '<span>关于</span></button>' +
          '</nav>' +
          '<div class="settings-panel"></div>' +
        '</div>' +
        '<div class="app-status"><span class="ok">CONFIG SYNCED</span><span id="setHost"></span><span class="spacer"></span><span>LOCAL ONLY</span></div>' +
      '</div>';
    const panel = $('.settings-panel', body);
    let section = 'appearance';
    $('#setHost', body).textContent = BC.BOOT.hostname || 'LOCAL';

    function toggleRow(name, label, desc, on) {
      return '<div class="setting-row"><div><b>' + label + '</b><p>' + desc + '</p></div><button class="toggle ' + (on ? 'on' : '') + '" data-toggle="' + name + '" aria-label="' + label + '"></button></div>';
    }

    function netBars(signal) {
      const on = signal > 75 ? 4 : signal > 50 ? 3 : signal > 25 ? 2 : signal > 0 ? 1 : 0;
      return '<span class="wifi-bars">' + [1, 2, 3, 4].map(i => '<i class="' + (i <= on ? 'on' : '') + '"></i>').join('') + '</span>';
    }

    function bindNetworkPanel(panel) {
      const note = (text, kind) => {
        const el = $('#netWifiMsg', panel);
        if (!el) return;
        el.textContent = text || '';
        el.style.color = kind === 'err' ? 'var(--danger)' : kind === 'ok' ? 'var(--ok)' : kind === 'warn' ? 'var(--warn)' : '';
      };
      let busy = false;
      let networks = [];

      const renderSummary = (st) => {
        const w = st.wifi || {};
        const el = $('#netWifi', panel);
        if (!el) return;
        if (st.supported === false || !w.available) {
          el.innerHTML = '<span class="dot off"></span><div><div class="net-ssid">未检测到无线网卡</div>' +
            '<div class="net-meta">' + U.esc(st.note || '此设备没有可用的 Wi-Fi 适配器。') + '</div></div>' +
            '<span class="spacer" style="flex:1"></span><span class="net-pill">NO RADIO</span>';
          return;
        }
        const a = w.adapter || {};
        el.innerHTML = '<span class="dot ' + (w.connected ? 'live' : 'off') + '"></span>' +
          '<div><div class="net-ssid">' + U.esc(w.connected ? (w.ssid || '已连接（SSID 未知）') : '未连接') + '</div>' +
          '<div class="net-meta">' + U.esc(a.name || '') + (a.status ? ' · ' + U.esc(a.status) : '') + (a.speed ? ' · ' + U.esc(a.speed) : '') +
          (w.signal != null ? ' · 信号 ' + w.signal + '%' : '') + (w.profiles && w.profiles.length ? ' · 已保存 ' + w.profiles.length + ' 个配置' : '') + '</div></div>' +
          '<span class="spacer" style="flex:1"></span><span class="net-pill ' + (w.connected ? 'on' : '') + '">' + (w.connected ? 'CONNECTED' : 'DISCONNECTED') + '</span>';
        if (w.requiresLocation || w.requiresElevation) {
          note('Windows 限制：' + (w.requiresLocation ? '需要开启系统位置服务' : '') +
            (w.requiresLocation && w.requiresElevation ? '；' : '') +
            (w.requiresElevation ? '查询 WLAN 详情需要管理员权限' : '') + '。可点击“位置权限”或“管理员扫描”。', 'warn');
        } else if (w.note) note(w.note, 'warn');
      };

      const renderEthernet = (st) => {
        const el = $('#netEth', panel);
        if (!el) return;
        const list = st.ethernet || [];
        if (!list.length) {
          el.innerHTML = '<span class="sub">未检测到有线网卡（虚拟网卡已隐藏）。</span>';
          return;
        }
        el.innerHTML = list.map(e => {
          const up = /^up$/i.test(e.status || '');
          return '<div class="eth-item"><div class="eth-head">' +
            '<span class="dot ' + (up ? 'live' : 'off') + '"></span><b>' + U.esc(e.name) + '</b>' +
            '<span class="net-pill ' + (up ? 'on' : '') + '">' + U.esc(e.status || '—') + '</span></div>' +
            '<div class="eth-meta">' + U.esc(e.description || '') + (e.speed ? ' · ' + U.esc(e.speed) : '') +
            '<br>IPv4 ' + U.esc(e.ipv4 || '—') + ' · 网关 ' + U.esc(e.gateway || '—') + (e.dns ? ' · DNS ' + U.esc(e.dns) : '') +
            (e.mac ? '<br>MAC ' + U.esc(e.mac) : '') + '</div>' +
            '<div class="eth-actions">' +
              '<button class="btn" data-eth-act="renew" data-eth-name="' + U.esc(e.name) + '">重新获取 IP</button>' +
              (up ? '<button class="btn" data-eth-act="disable" data-eth-name="' + U.esc(e.name) + '">禁用网卡</button>'
                  : '<button class="btn" data-eth-act="enable" data-eth-name="' + U.esc(e.name) + '">启用网卡</button>') +
            '</div></div>';
        }).join('');
      };

      const load = async () => {
        try {
          const st = await A.networkStatus();
          renderSummary(st);
          renderEthernet(st);
        } catch (e) {
          note('读取网络状态失败: ' + e.message, 'err');
        }
      };

      const renderNetworks = () => {
        const el = $('#netWifiList', panel);
        if (!el) return;
        el.innerHTML = networks.map((n, i) => {
          const connected = false;
          return '<div class="wifi-item" data-wifi="' + i + '">' +
            '<div class="wifi-row">' + netBars(n.signal) +
              '<span class="wifi-name">' + U.esc(n.ssid) + '</span>' +
              '<span class="wifi-sec">' + U.esc(n.open ? 'OPEN' : (n.auth || 'SECURED')) + '</span>' +
              '<button class="btn" data-wifi-join="' + i + '">连接</button>' +
            '</div>' +
            '<div class="wifi-join hidden"><input class="input" type="password" placeholder="Wi-Fi 密码" aria-label="Wi-Fi 密码" autocomplete="off">' +
              '<button class="btn primary" data-wifi-do="' + i + '">连接</button>' +
              '<button class="btn" data-wifi-cancel="' + i + '">取消</button></div>' +
          '</div>';
        }).join('');
      };

      const connect = async (net, password, elevated) => {
        if (busy) return;
        busy = true;
        note('正在连接 ' + net.ssid + (elevated ? '（管理员）' : '') + '…');
        try {
          const r = await A.wifiConnect(net.ssid, password, net.open, elevated);
          if (r.ok) {
            note('已连接: ' + net.ssid + (r.output ? ' · ' + r.output : ''), 'ok');
            setTimeout(load, 2200);
          } else {
            note(r.message || '连接失败', 'err');
            if (r.needsElevation && !elevated) {
              const go = await BC.ui.confirm('需要管理员权限', (r.message || '连接 Wi-Fi 需要提升权限') + '\n\n是否通过 UAC 以管理员身份重试？');
              if (go) { busy = false; return connect(net, password, true); }
            } else if (r.needsLocation) {
              note('系统位置服务未开启，Windows 不允许访问 WLAN。请点击“位置权限”打开设置后重试。', 'warn');
            }
          }
        } catch (e) {
          note('连接失败: ' + e.message, 'err');
        } finally {
          busy = false;
        }
      };

      const doScan = async (elevated) => {
        if (busy) return;
        busy = true;
        note(elevated ? '正在请求管理员权限并扫描…（会出现 UAC 提示）' : '扫描中…');
        try {
          const res = await A.wifiScan(elevated);
          if (res.ok) {
            networks = res.networks || [];
            renderNetworks();
            note(networks.length ? ('发现 ' + networks.length + ' 个网络 · 点击“连接”输入密码') : (res.message || '未发现网络'), networks.length ? 'ok' : 'warn');
          } else {
            networks = [];
            renderNetworks();
            note(res.message || '扫描失败', res.cancelled ? 'warn' : 'err');
            if (res.needsElevation && !elevated) note((res.message || '扫描需要管理员权限') + ' 请点击“管理员扫描”。', 'warn');
            if (res.needsLocation) note('Windows 要求开启位置服务才能访问 WLAN 信息。请点击“位置权限”。', 'warn');
          }
        } catch (e) {
          note('扫描失败: ' + e.message, 'err');
        } finally {
          busy = false;
        }
      };

      $('#netWifiScan', panel).addEventListener('click', () => doScan(false));
      $('#netWifiScanElev', panel).addEventListener('click', () => doScan(true));
      $('#netWifiLoc', panel).addEventListener('click', () => {
        A.openNetworkSettings('location').catch(e => note('无法打开设置: ' + e.message, 'err'));
      });
      $('#netWifiDisc', panel).addEventListener('click', async () => {
        try {
          const r = await A.wifiDisconnect();
          note(r.message || (r.ok ? '已断开' : '断开失败'), r.ok ? 'ok' : 'err');
          load();
        } catch (e) { note('断开失败: ' + e.message, 'err'); }
      });
      $('#netEthRefresh', panel).addEventListener('click', load);
      $('#netEthSettings', panel).addEventListener('click', () => {
        A.openNetworkSettings('adapters').catch(e => note('无法打开设置: ' + e.message, 'err'));
      });

      $('#netWifiList', panel).addEventListener('click', async (e) => {
        const join = e.target.closest('[data-wifi-join]');
        if (join) {
          const net = networks[Number(join.dataset.wifiJoin)];
          if (!net) return;
          const row = join.closest('.wifi-item');
          if (net.open) return connect(net, '', false);
          const box = $('.wifi-join', row);
          box.classList.remove('hidden');
          $('input', box).focus();
          return;
        }
        const cancel = e.target.closest('[data-wifi-cancel]');
        if (cancel) { $('.wifi-join', cancel.closest('.wifi-item')).classList.add('hidden'); return; }
        const go = e.target.closest('[data-wifi-do]');
        if (go) {
          const i = Number(go.dataset.wifiDo);
          const net = networks[i];
          if (!net) return;
          const input = $('input', go.closest('.wifi-join'));
          const pass = input.value;
          if (!net.open && pass.length < 8) { note('WPA/WPA2 密码至少 8 位。', 'err'); input.focus(); return; }
          input.value = '';
          return connect(net, pass, false);
        }
      });

      $('#netEth', panel).addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-eth-act]');
        if (!btn) return;
        const name = btn.dataset.ethName;
        const act = btn.dataset.ethAct;
        const label = act === 'enable' ? '启用' : act === 'disable' ? '禁用' : '重新获取 IP';
        const ok = await BC.ui.confirm('网络适配器操作', '将对“' + name + '”执行：' + label + '。\n此操作需要管理员授权，会弹出 UAC 提示。');
        if (!ok) return;
        try {
          const r = await A.ethernetAction(name, act);
          note(r.message || (r.ok ? '完成' : '操作失败'), r.ok ? 'ok' : 'err');
          setTimeout(load, 1800);
        } catch (err) { note('操作失败: ' + err.message, 'err'); }
      });

      load();
    }
    function render() {
      const s = BC.settings();
      $$('.settings-nav button', body).forEach(b => b.classList.toggle('on', b.dataset.sec === section));
      if (section === 'appearance') {
        panel.innerHTML =
          '<h3>外观与界面</h3><p class="sub">所有更改即时生效，并保存在本机浏览器配置中。</p>' +
          '<div class="setting-group"><div class="setting-label">ACCENT COLOR</div><div class="swatches">' +
            BC.accents.map(a => '<button class="swatch ' + (s.accent === a.id ? 'on' : '') + '" style="--sw:' + a.color + '" data-accent="' + a.id + '" title="' + a.name + '"></button>').join('') +
          '</div></div>' +
          '<div class="setting-group"><div class="setting-label">WALLPAPER</div><div class="setting-cards">' +
            BC.wallpapers.map(w => '<button class="setting-wall ' + (s.wallpaper === w.id ? 'on' : '') + '" data-wall="' + w.id + '" style="background-image:url(&quot;' + w.url + '&quot;)"><span>' + U.esc(w.name) + '</span></button>').join('') +
          '</div></div>' +
          '<div class="setting-group"><div class="setting-label">SYSTEM EFFECTS</div>' +
            toggleRow('scanlines', '扫描线', 'CRT 风格的横向扫描线与暗角叠加。', s.scanlines) +
            toggleRow('motion', '动态效果', '窗口动画、旋转与过渡；关闭可减少运动。', s.motion) +
            toggleRow('matrix', '数字雨', '桌面背景的矩阵字符雨。', s.matrix) +
            toggleRow('sound', '系统音效', '窗口、按钮与确认音的 WebAudio 合成音。', s.sound) +
            toggleRow('clock12', '12 小时制', '任务栏时钟使用 AM / PM。', s.clock12) +
          '</div>';
      } else if (section === 'account') {
        panel.innerHTML =
          '<h3>操作员账户</h3><p class="sub">这是本机的显示身份，不是远程账户。Batcave 没有云登录或密码找回。</p>' +
          '<div class="account-row"><span class="app-ico mini-avatar" style="--iaccent:var(--acc2)">' + U.icon('user') + '</span>' +
            '<div style="flex:1"><input class="input" id="setName" value="' + U.esc(s.account) + '" maxlength="24" aria-label="呼号"></div>' +
            '<button class="btn primary" id="setNameSave">保存呼号</button></div>' +
          '<div class="setting-group" style="margin-top:22px"><div class="setting-label">SESSION</div>' +
            '<div class="setting-row"><div><b>锁定工作站</b><p>保留正在运行的程序，显示锁屏。Ctrl+Alt+L。</p></div><button class="btn" id="setLock">' + '锁定</button></div>' +
            '<div class="setting-row"><div><b>切换用户 / 注销</b><p>关闭所有窗口并回到登录屏幕。</p></div><button class="btn" id="setLogout">注销</button></div>' +
          '</div>' +
          '<p class="sub" style="margin-top:6px">提示：文档、笔记与下载保存在真实主目录 ' + U.esc(BC.BOOT.home || '—') + '。</p>';
        $('#setNameSave', panel).addEventListener('click', () => {
          const v = ($('#setName', panel).value.trim() || 'BRUCE').toUpperCase();
          BC.updateSettings({ account: v }); BC.toast('呼号已更新: ' + v); render();
        });
        $('#setName', panel).addEventListener('keydown', e => { if (e.key === 'Enter') $('#setNameSave', panel).click(); });
        $('#setLock', panel).addEventListener('click', () => BC.lock());
        $('#setLogout', panel).addEventListener('click', () => BC.logout());
      } else if (section === 'network') {
        panel.innerHTML =
          '<h3>网络与连接</h3><p class="sub">显示本机真实网卡与连接状态。Wi-Fi 密码只通过一次性会话令牌发送给本机服务，用于建立连接，不写入磁盘或日志。</p>' +
          '<div class="setting-group"><div class="setting-label">WIRELESS · Wi-Fi</div>' +
            '<div id="netWifi" class="net-summary"><span class="net-meta">读取中…</span></div>' +
            '<div class="diag-actions"><button class="btn" id="netWifiScan">扫描 Wi-Fi</button><button class="btn" id="netWifiScanElev">管理员扫描</button><button class="btn" id="netWifiDisc">断开</button><button class="btn" id="netWifiLoc">位置权限</button></div>' +
            '<div id="netWifiMsg" class="sub" style="margin:9px 0 0"></div>' +
            '<div id="netWifiList" class="wifi-list"></div>' +
          '</div>' +
          '<div class="setting-group"><div class="setting-label">WIRED · 以太网</div>' +
            '<div id="netEth" class="eth-list"><span class="sub">读取中…</span></div>' +
            '<div class="diag-actions"><button class="btn" id="netEthRefresh">刷新状态</button><button class="btn" id="netEthSettings">打开网络适配器</button></div>' +
          '</div>' +
          '<p class="sub">网线插入后通常由系统自动 DHCP 上网；此处可查看 IP/网关、重新获取 IP，或启用/禁用网卡（需要 UAC）。Windows 的 Wi-Fi 扫描还可能要求开启位置服务，失败时会显示系统原文。</p>';
        bindNetworkPanel(panel);
      } else if (section === 'system') {
        panel.innerHTML =
          '<h3>系统与命令环境</h3><p class="sub">数据来自正在运行的本机服务。Linux 命令需要 WSL2 Linux Core 或 Batcave ISO。</p>' +
          '<div class="setting-group"><div class="setting-label">RUNTIME</div>' +
            '<div class="kv"><span>VERSION</span><b>BATCAVE ' + U.esc(BC.BOOT.version || '3.1.3') + ' · ' + U.esc(BC.BOOT.codename || 'SENTINEL') + '</b></div>' +
            '<div class="kv"><span>HOST / USER</span><b>' + U.esc(BC.BOOT.hostname || '') + ' · ' + U.esc(BC.BOOT.user || '') + '</b></div>' +
            '<div class="kv"><span>PLATFORM</span><b>' + U.esc(BC.BOOT.platform || '') + '</b></div>' +
            '<div class="kv"><span>HOME</span><b>' + U.esc(BC.BOOT.home || '') + '</b></div>' +
            '<div class="kv"><span>SHELL MODES</span><b>' + U.esc((BC.BOOT.bridge && BC.BOOT.bridge.modes || []).map(m => m.label).join(' · ')) + '</b></div>' +
          '</div>' +
          '<div class="setting-group"><div class="setting-label">LINUX CORE</div><div id="setLinux" class="sub">探测中…</div>' +
            '<div class="diag-actions"><button class="btn" id="setLinuxHelp">打开 Linux Core 帮助</button><button class="btn" id="setBrewHelp">Homebrew 安装说明</button><button class="btn" id="setNeofetch">运行 neofetch</button></div></div>' +
          '<div class="setting-group"><div class="setting-label">SECURITY BOUNDARIES</div>' +
            '<div class="setting-row"><div><b>本地 API</b><p>执行接口需要一次性会话令牌，并通过 Origin 校验。</p></div><span class="chip">TOKEN</span></div>' +
            '<div class="setting-row"><div><b>危险命令确认</b><p>删除、格式化、关机等命令必须二次确认才会执行。</p></div><span class="chip">GUARD</span></div>' +
            '<div class="setting-row"><div><b>网络代理</b><p>阻止访问回环、私有网段与云元数据地址。</p></div><span class="chip">SSRF</span></div>' +
          '</div>';
        const el = $('#setLinux', panel);
        A.linuxStatus().then(st => {
          el.innerHTML = (st.available ? '<span style="color:var(--ok)">● ONLINE</span>' : '<span style="color:var(--warn)">● OFFLINE</span>') +
            '<br>' + U.esc(st.available ? ('引擎: ' + st.engine + (st.distro ? ' · ' + st.distro : '')) : (st.note || 'Linux Core 不可用。'));
        }).catch(e => { el.textContent = '探测失败: ' + e.message; });
        $('#setLinuxHelp', panel).addEventListener('click', () => BC.runInTerminal('linux-core'));
        $('#setBrewHelp', panel).addEventListener('click', () => BC.runInTerminal('brew-setup'));
        $('#setNeofetch', panel).addEventListener('click', () => BC.runInTerminal('neofetch'));
      } else {
        panel.innerHTML =
          '<h3>关于 BATCAVE</h3><p class="sub">一个以真实命令桥为核心的本地桌面环境。</p>' +
          '<div class="about-card"><span class="logo-mark">' + U.icon('bat') + '</span><div><div class="ver">' + U.esc(BC.BOOT.codename || 'SENTINEL') + ' v' + U.esc(BC.BOOT.version || '3.1.3') + '</div><h4>BATCAVE OS</h4><p>零依赖 Node.js 服务 + 浏览器桌面。窗口、文件、终端与网页代理运行在本地；终端命令真实执行，不伪造输出。</p></div></div>' +
          '<div class="setting-group" style="margin-top:20px"><div class="setting-label">STACK</div>' +
            '<div class="kv"><span>UI</span><b>HTML · CSS · vanilla JS</b></div>' +
            '<div class="kv"><span>SERVER</span><b>Node.js · 无第三方依赖</b></div>' +
            '<div class="kv"><span>CRYPTO</span><b>WebCrypto AES-GCM / PBKDF2</b></div>' +
            '<div class="kv"><span>AUDIO</span><b>WebAudio 实时合成</b></div>' +
            '<div class="kv"><span>LICENSE</span><b>随附项目附带的许可证</b></div>' +
          '</div>' +
          '<div class="danger-zone"><h4>重置本地界面配置</h4><p>清除呼号、主题、壁纸与桌面偏好，并重新载入。不会删除主目录中的文件。</p><button class="btn danger" id="setReset">清除配置并重新载入</button></div>';
        $('#setReset', panel).addEventListener('click', async () => {
          const ok = await BC.ui.confirm('清除界面配置', '将删除本机浏览器中的 Batcave 设置（不含文档和笔记），然后重新载入页面。');
          if (!ok) return;
          try { localStorage.removeItem('bc.settings'); } catch { }
          location.reload();
        });
      }
    }
    $$('.settings-nav button', body).forEach(b => b.addEventListener('click', () => { section = b.dataset.sec; render(); }));
    panel.addEventListener('click', e => {
      const ac = e.target.closest('[data-accent]');
      if (ac) { BC.setAccent(ac.dataset.accent); render(); return; }
      const wl = e.target.closest('[data-wall]');
      if (wl) { BC.setWallpaper(wl.dataset.wall); render(); return; }
      const tg = e.target.closest('[data-toggle]');
      if (tg) {
        const key = tg.dataset.toggle;
        const s = BC.settings();
        BC.updateSettings({ [key]: !s[key] });
        if (key === 'matrix') BC.toast('数字雨: ' + (BC.settings().matrix ? 'ON' : 'OFF'));
        render();
      }
    });
    render();
  }

  /* ================================================================ NOTES */
  function createNotes(body, win) {
    body.innerHTML =
      '<div class="app notes-app">' +
        '<div class="app-toolbar"><button class="icon-btn" data-n="new" title="新建笔记">' + U.icon('plus') + '</button>' +
          '<button class="icon-btn" data-n="refresh" title="刷新列表">' + U.icon('refresh') + '</button>' +
          '<span class="toolbar-title" style="margin-left:2px">代号笔记</span><span class="toolbar-sub">ENCRYPT WITH YOUR OWN TOOLS</span><span class="spacer"></span>' +
          '<input class="input" id="noteSearch" placeholder="搜索笔记…" style="width:150px;height:28px;font-size:10px">' +
        '</div>' +
        '<div class="notes-layout">' +
          '<aside class="notes-side"><div class="notes-list" id="noteList"><div style="padding:16px 8px;font-family:var(--mono);font-size:9px;color:var(--dim)">读取中…</div></div></aside>' +
          '<section class="notes-editor">' +
            '<input class="note-title" id="noteTitle" placeholder="笔记标题" spellcheck="false">' +
            '<textarea class="note-text" id="noteText" placeholder="在这里写下你的想法…" spellcheck="false"></textarea>' +
            '<div class="note-foot"><span id="noteMeta">无文件</span><span id="noteDirty">已保存</span></div>' +
          '</section>' +
        '</div>' +
        '<div class="app-status"><span id="noteStatus" class="ok">READY</span><button class="icon-btn small" data-n="save" title="保存 (Ctrl+S)">' + U.icon('save') + '</button><button class="icon-btn small" data-n="delete" title="删除笔记">' + U.icon('trash') + '</button><span class="spacer"></span><span id="noteCount"></span></div>' +
      '</div>';

    const listEl = $('#noteList', body), titleEl = $('#noteTitle', body), textEl = $('#noteText', body);
    let items = [], current = null, loadedName = '', dirty = false, saveTimer = null, loading = false, disposed = false;
    const noteDir = '/Notes';

    function setStatus(txt, cls) { const el = $('#noteStatus', body); el.textContent = txt; el.className = cls || ''; }
    function setDirty(v) {
      dirty = v;
      $('#noteDirty', body).textContent = v ? '● 未保存' : '已保存';
      $('#noteDirty', body).style.color = v ? 'var(--warn)' : 'var(--dim)';
      if (v) setStatus('UNSAVED CHANGES', 'warn');
    }
    function noteNameFromTitle(t) {
      return String(t || '').trim().replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 64) || 'UNTITLED';
    }
    function uniqueName(base) {
      let n = base, i = 2;
      const names = new Set(items.map(x => x.name.replace(/\.md$/i, '').toLowerCase()));
      while (names.has(n.toLowerCase())) n = base + ' ' + i++;
      return n + '.md';
    }
    async function refreshList(selectPath) {
      try {
        const data = await A.fsList(noteDir);
        items = (data.entries || []).filter(e => !e.dir && /\.(md|txt)$/i.test(e.name)).sort((a, b) => b.mtime - a.mtime);
      } catch (e) {
        items = [];
        try { await A.fsMkdir(noteDir); } catch { }
      }
      renderList();
      $('#noteCount', body).textContent = items.length + ' NOTES · ' + noteDir;
      if (selectPath) await openNote(selectPath);
    }
    function renderList() {
      const q = $('#noteSearch', body).value.trim().toLowerCase();
      const shown = items.filter(n => n.name.toLowerCase().includes(q));
      if (!shown.length) {
        listEl.innerHTML = '<div style="padding:18px 10px;font-family:var(--mono);font-size:9px;line-height:1.7;color:var(--dim)">' + (q ? '没有匹配的笔记。' : '空。点击 + 建立第一份笔记。') + '</div>';
        return;
      }
      listEl.innerHTML = shown.map(n => {
        const name = n.name.replace(/\.(md|txt)$/i, '');
        return '<button class="note-item ' + (current === noteDir + '/' + n.name ? 'on' : '') + '" data-note="' + U.esc(n.name) + '"><b>' + U.esc(name) + '</b><span>' + U.fmtDate(n.mtime) + '</span></button>';
      }).join('');
    }
    async function saveNow(silent) {
      if (!dirty || loading) return;
      clearTimeout(saveTimer);
      const title = titleEl.value.trim() || 'UNTITLED';
      const base = noteNameFromTitle(title);
      let target = uniqueName(base);
      try {
        if (current) {
          if (U.baseName(current).replace(/\.(md|txt)$/i, '') !== base) {
            const dir = U.dirName(current);
            target = dir + '/' + target;
            if (target !== current) await A.fsRename(current, target);
            else target = current;
          } else target = current;
        } else {
          target = noteDir + '/' + target;
        }
        await A.fsWrite(target, textEl.value);
        current = target; loadedName = U.baseName(current);
        setDirty(false); setStatus('SAVED', 'ok');
        $('#noteMeta', body).textContent = current;
        await refreshList();
        if (!silent) BC.toast('笔记已保存');
      } catch (e) {
        setStatus('SAVE FAILED', 'err');
        BC.toast('保存失败: ' + e.message);
      }
    }
    function scheduleSave() { setDirty(true); clearTimeout(saveTimer); saveTimer = setTimeout(() => saveNow(true), 1000); }
    async function openNote(path) {
      if (dirty) await saveNow(true);
      loading = true;
      try {
        const data = await A.fsRead(noteDir + '/' + path);
        current = noteDir + '/' + path; loadedName = path;
        titleEl.value = U.baseName(path).replace(/\.(md|txt)$/i, '');
        textEl.value = data.content || '';
        $('#noteMeta', body).textContent = current + ' · ' + U.fmtBytes(data.size);
        setDirty(false); setStatus('LOADED', 'ok');
        renderList();
      } catch (e) {
        BC.toast('无法读取笔记: ' + e.message);
      } finally { loading = false; }
    }
    async function createNote() {
      if (dirty) await saveNow(true);
      const name = uniqueName('UNTITLED');
      const path = noteDir + '/' + name;
      try {
        await A.fsWrite(path, '');
        await refreshList();
        await openNote(name);
        titleEl.focus(); titleEl.select();
      } catch (e) { BC.toast('建立失败: ' + e.message); }
    }
    async function deleteNote() {
      if (!current) return BC.toast('没有打开的笔记');
      const ok = await BC.ui.confirm('删除笔记', '将永久删除 <code>' + U.esc(current) + '</code>。此操作无法撤销。');
      if (!ok) return;
      try {
        await A.fsRemove(current);
        current = null; loadedName = '';
        titleEl.value = ''; textEl.value = ''; setDirty(false); $('#noteMeta', body).textContent = '无文件';
        await refreshList(); BC.toast('笔记已删除');
      } catch (e) { BC.toast('删除失败: ' + e.message); }
    }

    listEl.addEventListener('click', e => {
      const b = e.target.closest('[data-note]');
      if (b) openNote(b.dataset.note);
    });
    $('#noteSearch', body).addEventListener('input', renderList);
    titleEl.addEventListener('input', scheduleSave);
    textEl.addEventListener('input', scheduleSave);
    $$('[data-n="new"]', body).forEach(b => b.addEventListener('click', createNote));
    $('[data-n="refresh"]', body).addEventListener('click', () => refreshList());
    $('[data-n="save"]', body).addEventListener('click', () => saveNow());
    $('[data-n="delete"]', body).addEventListener('click', deleteNote);
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); }
    }
    body.addEventListener('keydown', onKey);
    refreshList().then(() => { if (items.length) openNote(items[0].name); else { titleEl.value = ''; textEl.value = ''; } });
    return async () => { clearTimeout(saveTimer); if (dirty) { try { await saveNow(true); } catch { } } };
  }

  /* ================================================================ CALCULATOR */
  function createCalculator(body, win) {
    body.innerHTML =
      '<div class="app calc-app">' +
        '<div class="calc-body">' +
          '<div class="calc-screen"><div class="calc-expr" id="calcExpr">&nbsp;</div><div class="calc-result" id="calcResult">0</div></div>' +
          '<div class="calc-grid">' +
            '<button class="calc-key fn" data-k="C">C</button><button class="calc-key fn" data-k="back">⌫</button><button class="calc-key fn" data-k="(">(</button><button class="calc-key fn" data-k=")">)</button>' +
            '<button class="calc-key fn" data-k="sqrt">√</button><button class="calc-key op" data-k="^">x^y</button><button class="calc-key op" data-k="%">%</button><button class="calc-key op" data-k="/">÷</button>' +
            '<button class="calc-key" data-k="7">7</button><button class="calc-key" data-k="8">8</button><button class="calc-key" data-k="9">9</button><button class="calc-key op" data-k="*">×</button>' +
            '<button class="calc-key" data-k="4">4</button><button class="calc-key" data-k="5">5</button><button class="calc-key" data-k="6">6</button><button class="calc-key op" data-k="-">−</button>' +
            '<button class="calc-key" data-k="1">1</button><button class="calc-key" data-k="2">2</button><button class="calc-key" data-k="3">3</button><button class="calc-key op" data-k="+">+</button>' +
            '<button class="calc-key fn" data-k="neg">±</button><button class="calc-key" data-k="0">0</button><button class="calc-key" data-k=".">.</button><button class="calc-key eq" data-k="=">=</button>' +
          '</div>' +
        '</div>' +
        '<div class="app-status"><span>键盘可直接输入 · Enter 计算 · Esc 清除</span><span class="spacer"></span><span>IEEE 754</span></div>' +
      '</div>';
    const exprEl = $('#calcExpr', body), resEl = $('#calcResult', body);
    let expr = '', justResult = false, lastExpr = '';

    function fmt(n) {
      if (!isFinite(n)) return n > 0 ? '∞' : (n < 0 ? '−∞' : '未定义');
      const r = Number(n.toPrecision(13));
      if (Math.abs(r) >= 1e13 || (r !== 0 && Math.abs(r) < 1e-9)) return r.toExponential(8).replace(/e\+?/, 'e');
      return String(r);
    }
    function tokenize(src) {
      const out = [];
      let i = 0;
      const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'PI');
      while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if (/[0-9.]/.test(c)) {
          let j = i;
          while (j < s.length && /[0-9.]/.test(s[j])) j++;
          const t = s.slice(i, j);
          if ((t.match(/\./g) || []).length > 1) throw new Error('bad number');
          out.push({ t: 'num', v: Number(t) });
          i = j; continue;
        }
        if (/[a-z]/i.test(c)) {
          let j = i; while (j < s.length && /[a-z]/i.test(s[j])) j++;
          out.push({ t: 'id', v: s.slice(i, j).toLowerCase() }); i = j; continue;
        }
        if ('+-*/^%()'.includes(c)) { out.push({ t: c }); i++; continue; }
        throw new Error('unexpected ' + c);
      }
      return out;
    }
    function evaluate(src) {
      const tk = tokenize(src);
      let p = 0;
      const peek = () => tk[p] && tk[p].t;
      const eat = t => { if (peek() !== t) throw new Error('expected ' + t); p++; };
      function primary() {
        if (peek() === 'num') { let v = tk[p++].v; while (peek() === '%') { p++; v /= 100; } return v; }
        if (peek() === '(') { p++; const v = expression(); eat(')'); return v; }
        if (peek() === 'id') {
          const name = tk[p++].v;
          const fns = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, abs: Math.abs, exp: Math.exp, pi: Math.PI, e: Math.E };
          if (!(name in fns)) throw new Error('unknown fn');
          if (name === 'pi' || name === 'e') return fns[name];
          eat('('); const v = expression(); eat(')'); return fns[name](v);
        }
        throw new Error('expected value');
      }
      function power() { const base = primary(); if (peek() === '^') { p++; return Math.pow(base, unary()); } return base; }
      function unary() { if (peek() === '-') { p++; return -unary(); } if (peek() === '+') { p++; return unary(); } return power(); }
      function term() {
        let v = unary();
        while (peek() === '*' || peek() === '/') { const op = tk[p++].t; const r = unary(); v = op === '*' ? v * r : v / r; }
        return v;
      }
      function expression() {
        let v = term();
        while (peek() === '+' || peek() === '-') { const op = tk[p++].t; const r = term(); v = op === '+' ? v + r : v - r; }
        return v;
      }
      const v = expression();
      if (p !== tk.length) throw new Error('trailing input');
      return v;
    }
    function render() {
      exprEl.textContent = justResult && lastExpr ? lastExpr + ' =' : (expr || '\u00a0');
      if (!expr.trim()) { resEl.textContent = '0'; return; }
      try {
        const v = evaluate(expr);
        resEl.textContent = fmt(v);
        resEl.style.color = '';
      } catch {
        resEl.textContent = '…';
        resEl.style.color = 'var(--dim)';
      }
    }
    function insert(s) {
      if (justResult) {
        if (/^[0-9.]$/.test(s)) expr = '';
        else if (['+', '-', '*', '/', '^', '%'].includes(s)) expr = resEl.textContent.replace(/−/g, '-');
        justResult = false; lastExpr = '';
      }
      expr += s; render();
    }
    function action(k) {
      if (k === 'C') { expr = ''; lastExpr = ''; justResult = false; render(); return; }
      if (k === 'back') { expr = expr.slice(0, -1); justResult = false; render(); return; }
      if (k === 'sqrt') { insert('sqrt('); return; }
      if (k === 'neg') { expr = expr.startsWith('-') ? expr.slice(1) : '-' + expr; justResult = false; render(); return; }
      if (k === '=') {
        if (!expr.trim()) return;
        try {
          const v = evaluate(expr);
          lastExpr = expr; expr = fmt(v); justResult = true;
          exprEl.textContent = lastExpr + ' =';
          resEl.textContent = expr;
          resEl.style.color = '';
        } catch {
          resEl.textContent = '表达式错误'; resEl.style.color = 'var(--danger)';
        }
        return;
      }
      insert(k);
    }
    $$('[data-k]', body).forEach(b => b.addEventListener('click', () => action(b.dataset.k)));
    function onKey(e) {
      const active = BC.getActiveWindow();
      if (!active || active.appId !== 'calc') return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const map = { Enter: '=', Escape: 'C', Backspace: 'back', x: '*', X: '*', '*': '*', '/': '/', '+': '+', '-': '-', '^': '^', '%': '%', '(': '(', ')': ')', '.': '.' };
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); insert(e.key); }
      else if (map[e.key]) { e.preventDefault(); action(map[e.key]); }
    }
    document.addEventListener('keydown', onKey);
    render();
    return () => document.removeEventListener('keydown', onKey);
  }

  /* ================================================================ VAULT */
  function createVault(body, win) {
    body.innerHTML =
      '<div class="app vault-app">' +
        '<div class="app-toolbar"><span class="toolbar-title">暗影保险库</span><span class="toolbar-sub">AES-256-GCM · LOCAL CIPHERTEXT</span><span class="spacer"></span>' +
          '<input class="input" id="vaultSearch" placeholder="搜索条目…" style="width:150px;height:28px;font-size:10px;display:none">' +
          '<button class="icon-btn" data-v="add" title="新增条目" style="display:none">' + U.icon('plus') + '</button>' +
          '<button class="icon-btn" data-v="lock" title="锁定保险库" style="display:none">' + U.icon('lock') + '</button>' +
        '</div>' +
        '<div id="vaultRoot" style="flex:1;display:flex;min-height:0"></div>' +
        '<div class="app-status"><span class="ok" id="vaultStatus">LOCKED</span><span class="spacer"></span><span>PBKDF2 · 150,000 ITER</span></div>' +
      '</div>';
    const root = $('#vaultRoot', body);
    const enc = new TextEncoder(), dec = new TextDecoder();
    let key = null, salt = null, entries = [], unlocked = false, lastActive = Date.now(), disposed = false;

    function b64(buf) { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
    function unb64(s) { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
    function blob() { try { return JSON.parse(localStorage.getItem('bc.vault.blob') || 'null'); } catch { return null; } }
    async function derive(pass, saltB64) {
      const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: unb64(saltB64), iterations: 150000, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    async function persist() {
      if (!key || !salt) throw new Error('vault locked');
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(entries)));
      localStorage.setItem('bc.vault.blob', JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter: 150000, salt, iv: b64(iv), data: b64(data) }));
      $('#vaultStatus', body).textContent = 'ENCRYPTED · ' + new Date().toLocaleTimeString();
    }
    function lockState(msg) {
      unlocked = false; entries = []; key = null;
      $('#vaultSearch', body).style.display = 'none';
      $('[data-v="add"]', body).style.display = 'none';
      $('[data-v="lock"]', body).style.display = 'none';
      $('#vaultStatus', body).textContent = 'LOCKED';
      const exists = !!blob();
      root.innerHTML =
        '<div class="vault-lock"><span class="app-ico" style="--iaccent:var(--acc2)">' + U.icon('vault') + '</span>' +
          '<h3>' + (exists ? '保险库已锁定' : '建立加密保险库') + '</h3>' +
          '<p>' + (exists
            ? '输入主口令解锁。密文存于本机，口令不会离开浏览器；遗失口令无法恢复。'
            : '所有条目将使用 WebCrypto AES-256-GCM 加密后保存在本机。请设置至少 8 个字符的主口令；遗失后无法恢复。') + '</p>' +
          (msg ? '<p style="color:var(--danger)">' + U.esc(msg) + '</p>' : '') +
          '<div class="vault-form">' +
            '<input class="input" id="vaultPass" type="password" placeholder="主口令" autocomplete="new-password">' +
            (exists ? '' : '<input class="input" id="vaultPass2" type="password" placeholder="再次输入主口令" autocomplete="new-password">') +
            '<button class="btn primary" id="vaultGo">' + (exists ? '解锁' : '创建保险库') + '</button>' +
            (exists ? '<button class="btn" id="vaultForget" style="font-size:9px">忘记口令？清除保险库</button>' : '') +
          '</div>' +
        '</div>';
      $('#vaultGo', root).addEventListener('click', () => exists ? unlock() : create());
      const pass = $('#vaultPass', root);
      pass.focus();
      pass.addEventListener('keydown', e => { if (e.key === 'Enter') $('#vaultGo', root).click(); });
      if (exists) $('#vaultForget', root).addEventListener('click', async () => {
        const ok = await BC.ui.confirm('清除保险库', '保险库密文将被永久删除，且无法恢复。确定继续？');
        if (!ok) return;
        localStorage.removeItem('bc.vault.blob');
        lockState('保险库已清除。');
      });
    }
    async function create() {
      const p = $('#vaultPass', root).value, p2 = $('#vaultPass2', root).value;
      if (p.length < 8) return lockState('主口令至少需要 8 个字符。');
      if (p !== p2) return lockState('两次输入的口令不一致。');
      try {
        salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        key = await derive(p, salt);
        entries = []; unlocked = true;
        await persist();
        BC.toast('保险库已建立');
        showList();
      } catch (e) { lockState('创建失败: ' + e.message); }
    }
    async function unlock() {
      const p = $('#vaultPass', root).value;
      const b = blob();
      if (!b) return lockState('保险库不存在。');
      try {
        key = await derive(p, b.salt);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(b.iv) }, key, unb64(b.data));
        entries = JSON.parse(dec.decode(plain));
        if (!Array.isArray(entries)) throw new Error('bad payload');
        salt = b.salt; unlocked = true; lastActive = Date.now();
        showList();
      } catch (e) {
        key = null;
        lockState('解锁失败：口令错误或密文损坏。');
      }
    }
    function lockNow() {
      if (!unlocked) return;
      entries = []; key = null; salt = null; unlocked = false;
      lockState();
      BC.toast('保险库已锁定');
    }
    function showList() {
      $('#vaultSearch', body).style.display = '';
      $('[data-v="add"]', body).style.display = '';
      $('[data-v="lock"]', body).style.display = '';
      root.innerHTML = '<div class="vault-list"><div class="vault-items" id="vaultItems"></div><div class="vault-note">密文保存在本机浏览器存储。口令与明文只存在于当前页面内存；关闭窗口或锁定后清除。请定期备份 — 清除浏览器站点数据会删除保险库。</div></div>';
      $('#vaultStatus', body).textContent = 'UNLOCKED · ' + entries.length + ' ENTRIES';
      renderItems();
    }
    function renderItems() {
      const wrap = $('#vaultItems', root);
      if (!wrap) return;
      const q = $('#vaultSearch', body).value.trim().toLowerCase();
      const shown = entries.filter(e => !q || (e.title + ' ' + e.user + ' ' + e.url).toLowerCase().includes(q));
      wrap.innerHTML = shown.length ? shown.map(e =>
        '<div class="vault-item" data-id="' + e.id + '">' +
          '<span class="app-ico" style="--iaccent:var(--acc2)">' + U.icon('key') + '</span>' +
          '<div><b>' + U.esc(e.title) + '</b><span>' + U.esc((e.user || '—') + (e.url ? ' · ' + e.url : '')) + '</span></div>' +
          '<button class="vault-pass" data-reveal="' + e.id + '" title="显示/隐藏并复制">••••••••</button>' +
          '<button class="icon-btn small" data-copy="' + e.id + '" title="复制密码">' + U.icon('copy') + '</button>' +
          '<button class="icon-btn small" data-edit="' + e.id + '" title="编辑">' + U.icon('editor') + '</button>' +
          '<button class="icon-btn small" data-del="' + e.id + '" title="删除">' + U.icon('trash') + '</button>' +
        '</div>').join('') : '<div class="empty-state"><svg class="ic"><use href="#i-key"></use></svg><b>' + (q ? '没有匹配条目' : '保险库为空') + '</b><p>点击工具栏的 + 添加第一条凭据。</p></div>';
      $('#vaultStatus', body).textContent = 'UNLOCKED · ' + entries.length + ' ENTRIES';
    }
    function form(entry) {
      const wrap = $('#vaultItems', root);
      if (!wrap) return;
      wrap.innerHTML =
        '<div class="vault-form" style="width:100%;max-width:520px;margin:8px auto;gap:7px">' +
          '<input class="input" id="vTitle" placeholder="名称（例如：GOTHAM MAINFRAME）" value="' + U.esc(entry ? entry.title : '') + '">' +
          '<input class="input" id="vUser" placeholder="用户名 / 账号" value="' + U.esc(entry ? entry.user : '') + '">' +
          '<input class="input" id="vPass" placeholder="密码（明文仅存于加密载荷）" value="' + U.esc(entry ? entry.pass : '') + '">' +
          '<input class="input" id="vUrl" placeholder="地址 / 备注链接" value="' + U.esc(entry ? entry.url : '') + '">' +
          '<input class="input" id="vNote" placeholder="备注" value="' + U.esc(entry ? entry.note : '') + '">' +
          '<div style="display:flex;gap:7px;justify-content:flex-end"><button class="btn" id="vCancel">取消</button><button class="btn primary" id="vSave">保存条目</button></div>' +
          '<p style="font-family:var(--mono);font-size:8px;color:var(--dim);line-height:1.6;margin:2px 0 0">警告：页面运行期间明文在内存中；本系统未实现剪贴板自动清除。</p>' +
        '</div>';
      $('#vCancel', wrap).addEventListener('click', renderItems);
      $('#vSave', wrap).addEventListener('click', async () => {
        const title = $('#vTitle', wrap).value.trim();
        if (!title) return BC.toast('名称不能为空');
        const obj = { title, user: $('#vUser', wrap).value.trim(), pass: $('#vPass', wrap).value, url: $('#vUrl', wrap).value.trim(), note: $('#vNote', wrap).value.trim() };
        if (entry) Object.assign(entry, obj);
        else entries.push(Object.assign({ id: U.uid() }, obj));
        try { await persist(); showList(); BC.toast(entry ? '条目已更新' : '条目已加密保存'); }
        catch (e) { BC.toast('保存失败: ' + e.message); }
      });
      $('#vTitle', wrap).focus();
    }
    $('#vaultSearch', body).addEventListener('input', renderItems);
    $('[data-v="add"]', body).addEventListener('click', () => form(null));
    $('[data-v="lock"]', body).addEventListener('click', lockNow);
    root.addEventListener('click', e => {
      const rv = e.target.closest('[data-reveal]');
      if (rv) {
        const ent = entries.find(x => x.id === rv.dataset.reveal);
        if (!ent) return;
        if (rv.textContent.includes('•')) { rv.textContent = ent.pass || '(空)'; U.copy(ent.pass || ''); }
        else rv.textContent = '••••••••';
        return;
      }
      const cp = e.target.closest('[data-copy]');
      if (cp) { const ent = entries.find(x => x.id === cp.dataset.copy); if (ent) { U.copy(ent.pass || ''); BC.toast('密码已复制到剪贴板'); } return; }
      const ed = e.target.closest('[data-edit]');
      if (ed) { const ent = entries.find(x => x.id === ed.dataset.edit); if (ent) form(ent); return; }
      const dl = e.target.closest('[data-del]');
      if (dl) {
        const ent = entries.find(x => x.id === dl.dataset.del);
        if (!ent) return;
        BC.ui.confirm('删除条目', '永久删除 <code>' + U.esc(ent.title) + '</code>？密文将被重写。').then(async ok => {
          if (!ok) return;
          entries = entries.filter(x => x.id !== ent.id);
          try { await persist(); renderItems(); BC.toast('条目已删除'); } catch (err) { BC.toast('保存失败: ' + err.message); }
        });
      }
    });
    root.addEventListener('pointerdown', () => { lastActive = Date.now(); });
    root.addEventListener('keydown', () => { lastActive = Date.now(); });
    const autoLock = setInterval(() => {
      if (disposed) return;
      if (unlocked && Date.now() - lastActive > 300000) { lockNow(); BC.toast('保险库因 5 分钟无操作自动锁定'); }
    }, 15000);
    lockState();
    return () => { disposed = true; clearInterval(autoLock); entries = []; key = null; salt = null; };
  }

  /* ================================================================ MUSIC */
  function createMusic(body, win) {
    const TRACKS = [
      { name: 'NIGHTWATCH', sub: 'DARK SYNTHWAVE', bpm: 92, root: 45, scale: [0, 3, 5, 7, 10], lead: [0, 2, 4, 3, 1, 4, 2, 0], bass: [0, 0, -5, -3] },
      { name: 'GOTHAM RAIN', sub: 'AMBIENT PULSE', bpm: 74, root: 41, scale: [0, 2, 5, 7, 9], lead: [0, 2, 4, 2, 3, 1, 2, 0], bass: [0, 0, -7, -5] },
      { name: 'CAVE ARRAY', sub: 'DEEP TECHNO', bpm: 118, root: 38, scale: [0, 3, 5, 6, 10], lead: [0, 1, 3, 4, 3, 1, 4, 2], bass: [0, 0, 0, -2] },
      { name: 'OMEGA PROTOCOL', sub: 'TENSION GRID', bpm: 104, root: 43, scale: [0, 1, 5, 7, 8], lead: [0, 4, 2, 3, 1, 4, 2, 3], bass: [0, -2, -5, -2] }
    ];
    body.innerHTML =
      '<div class="app music-app">' +
        '<div class="music-layout">' +
          '<div class="music-visual"><div class="disc" id="disc">' + U.icon('music') + '</div>' +
            '<canvas class="viz" id="viz"></canvas><h3 id="mtitle">' + U.esc(TRACKS[0].name) + '</h3><p id="msub">' + U.esc(TRACKS[0].sub) + ' · LOCAL SYNTH ENGINE</p>' +
          '</div>' +
          '<div class="music-list"><div class="music-tracks" id="tracks">' +
            TRACKS.map((t, i) => '<button class="mtrack ' + (i === 0 ? 'on' : '') + '" data-track="' + i + '"><span class="mt-num">' + String(i + 1).padStart(2, '0') + '</span><div><b>' + U.esc(t.name) + '</b><span>' + U.esc(t.sub) + ' · ' + t.bpm + ' BPM</span></div>' + U.icon('play') + '</button>').join('') +
          '</div><div class="music-controls">' +
            '<button class="icon-btn small" data-music="prev" title="上一首">' + U.icon('left') + '</button>' +
            '<button class="btn primary" data-music="toggle" id="mPlay" style="width:38px;height:34px;padding:0;display:grid;place-items:center">' + U.icon('play') + '</button>' +
            '<button class="icon-btn small" data-music="next" title="下一首">' + U.icon('right') + '</button>' +
            '<input type="range" class="range" id="mVol" min="0" max="100" value="35" aria-label="音量">' +
          '</div></div>' +
        '</div>' +
        '<div class="app-status"><span id="mStatus">SYNTH STANDBY</span><span class="spacer"></span><span>NO SAMPLES · GENERATIVE AUDIO</span></div>' +
      '</div>';

    let idx = 0, playing = false, ctx = null, master = null, analyser = null, data = null;
    let schedTimer = null, raf = null, step = 0, nextAt = 0;
    const disc = $('#disc', body), playBtn = $('#mPlay', body), viz = $('#viz', body);

    function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
    function setupAudio() {
      if (ctx) return;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.35;
      analyser = ctx.createAnalyser(); analyser.fftSize = 128; data = new Uint8Array(analyser.frequencyBinCount);
      master.connect(analyser); analyser.connect(ctx.destination);
    }
    function voice(freq, when, dur, type, vol) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, when);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(vol, when + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(g); g.connect(master);
      o.start(when); o.stop(when + dur + 0.03);
    }
    function scheduleStep(s, when) {
      const t = TRACKS[idx];
      const bar = Math.floor(s / 8) % 4;
      const lead = t.lead[s % t.lead.length];
      const octave = (s % 16 >= 8 && s % 16 < 12) ? 12 : 0;
      const midi = t.root + 12 + t.scale[lead % t.scale.length] + octave;
      voice(mtof(midi), when, 0.22, 'triangle', 0.05);
      if (s % 2 === 0) {
        const b = t.bass[bar];
        voice(mtof(t.root + b), when, 0.42, 'sawtooth', 0.028);
      }
      if (s % 8 === 0) {
        [0, 3, 5].forEach((iv, i) => voice(mtof(t.root + 12 + t.scale[iv % t.scale.length] + (i === 1 ? 3 : 0)), when, 1.4, 'sine', 0.014));
      }
      if (s % 4 === 2) voice(mtof(t.root + 24 + t.scale[(lead + 2) % t.scale.length]), when + 0.02, 0.12, 'square', 0.014);
    }
    function scheduler() {
      if (!playing || !ctx) return;
      const beat = 60 / TRACKS[idx].bpm / 2;
      while (nextAt < ctx.currentTime + 0.25) {
        scheduleStep(step, nextAt);
        step++; nextAt += beat;
      }
    }
    function drawViz() {
      if (!playing) { raf = null; const c = viz.getContext('2d'); c.clearRect(0, 0, viz.width, viz.height); return; }
      const dpr = window.devicePixelRatio || 1;
      const w = viz.clientWidth || 300, h = viz.clientHeight || 60;
      if (viz.width !== w * dpr) { viz.width = w * dpr; viz.height = h * dpr; }
      const c = viz.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
      if (analyser) analyser.getByteFrequencyData(data);
      const n = 32, bw = w / n;
      const acc = (getComputedStyle(document.documentElement).getPropertyValue('--acc') || '#5ffbf1').trim();
      for (let i = 0; i < n; i++) {
        const v = data ? data[i] / 255 : 0;
        const bh = Math.max(1, v * (h - 2));
        c.fillStyle = acc; c.globalAlpha = 0.25 + v * 0.75;
        c.fillRect(i * bw + 1, h - bh, bw - 2, bh);
      }
      c.globalAlpha = 1;
      raf = requestAnimationFrame(drawViz);
    }
    function renderTrack() {
      const t = TRACKS[idx];
      $('#mtitle', body).textContent = t.name; $('#msub', body).textContent = t.sub + ' · LOCAL SYNTH ENGINE';
      $$('.mtrack', body).forEach(b => { b.classList.toggle('on', Number(b.dataset.track) === idx); });
      disc.classList.toggle('playing', playing);
      playBtn.innerHTML = U.icon(playing ? 'pause' : 'play');
      $('#mStatus', body).textContent = playing ? 'SYNTH RUNNING · ' + t.bpm + ' BPM' : 'SYNTH STANDBY';
      win.setTitle('暗夜电台', playing ? t.name : 'SYNTH STANDBY');
    }
    async function play() {
      setupAudio();
      if (ctx.state === 'suspended') await ctx.resume();
      if (!playing) {
        playing = true; step = 0; nextAt = ctx.currentTime + 0.08;
        schedTimer = setInterval(scheduler, 60);
        if (!raf) raf = requestAnimationFrame(drawViz);
      }
      renderTrack();
    }
    function pause() {
      playing = false; clearInterval(schedTimer); schedTimer = null;
      if (master && ctx) master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03);
      setTimeout(() => { if (master && !playing) master.gain.value = Number($('#mVol', body).value) / 100; }, 180);
      renderTrack();
    }
    function toggle() { playing ? pause() : play(); }
    function select(i, autoplay) {
      const was = playing;
      if (was) pause();
      idx = (i + TRACKS.length) % TRACKS.length;
      if (autoplay !== false) play(); else renderTrack();
    }
    $('#tracks', body).addEventListener('click', e => {
      const b = e.target.closest('[data-track]');
      if (b) select(Number(b.dataset.track));
    });
    $$('[data-music]', body).forEach(b => b.addEventListener('click', () => {
      if (b.dataset.music === 'toggle') toggle();
      else if (b.dataset.music === 'next') select(idx + 1);
      else if (b.dataset.music === 'prev') select(idx - 1);
    }));
    $('#mVol', body).addEventListener('input', e => { if (master) master.gain.value = Number(e.target.value) / 100; });
    renderTrack();
    return () => {
      playing = false; clearInterval(schedTimer); cancelAnimationFrame(raf);
      if (ctx) { try { ctx.close(); } catch { } }
    };
  }

  /* ================================================================ GALLERY */
  function createGallery(body, win, params) {
    body.innerHTML =
      '<div class="app gallery-app">' +
        '<div class="app-toolbar"><span class="toolbar-title">图像库</span><span class="toolbar-sub">WALLPAPERS · UPLOADS</span><span class="spacer"></span>' +
          '<button class="btn" data-g="upload">' + U.icon('upload') + ' 上传图片</button>' +
          '<button class="icon-btn" data-g="refresh" title="刷新">' + U.icon('refresh') + '</button>' +
          '<input type="file" id="galleryFile" accept="image/*" multiple hidden>' +
        '</div>' +
        '<div class="gallery-grid" id="galleryGrid"></div>' +
        '<div class="app-status"><span class="ok" id="galleryStatus">READY</span><span class="spacer"></span><span id="galleryCount"></span></div>' +
      '</div>';
    const grid = $('#galleryGrid', body);
    let uploads = [], previewing = null, pending = 0;
    const builtins = BC.wallpapers.map(w => ({ kind: 'wall', id: w.id, name: w.name, url: w.url }));

    function cardSrc(x) { return x.kind === 'wall' ? x.url : A.rawUrl(x.path); }
    function render() {
      const all = builtins.concat(uploads);
      grid.innerHTML = all.map((x, i) =>
        '<div class="gallery-card" data-gi="' + i + '" style="background-image:url(&quot;' + cardSrc(x) + '&quot;)">' +
          '<div class="g-actions">' +
            (x.kind === 'wall' ? '<button class="icon-btn small" data-setwall="' + x.id + '" title="设为壁纸">' + U.icon('check') + '</button>' : '') +
            (x.kind === 'wall' ? '<button class="icon-btn small" data-dlwall="' + x.id + '" title="下载壁纸">' + U.icon('download') + '</button>' : '<button class="icon-btn small" data-delimg="' + U.esc(x.path) + '" title="删除">' + U.icon('trash') + '</button>') +
          '</div>' +
          '<div class="g-label">' + U.esc(x.name) + (x.kind === 'wall' ? ' · SYSTEM' : ' · UPLOAD') + '</div>' +
        '</div>').join('');
      $('#galleryCount', body).textContent = builtins.length + ' SYSTEM · ' + uploads.length + ' UPLOADS';
      $('#galleryStatus', body).textContent = 'READY';
    }
    async function load() {
      uploads = [];
      for (const dir of ['/Gallery', '/Uploads']) {
        try {
          const d = await A.fsList(dir);
          (d.entries || []).forEach(e => {
            if (!e.dir && U.isImageExt(e.name)) uploads.push({ kind: 'image', name: e.name, path: dir + '/' + e.name });
          });
        } catch { }
      }
      render();
      if (params && params.preview) showPreviewByPath(params.preview);
    }
    function showPreviewByPath(path) {
      const x = uploads.find(u => u.path === path);
      if (x) preview(x);
    }
    function preview(x) {
      previewing = x;
      grid.classList.add('hidden');
      grid.style.display = 'none';
      const old = $('.gallery-preview', body); if (old) old.remove();
      const wrap = document.createElement('div');
      wrap.className = 'gallery-preview';
      wrap.innerHTML =
        '<div class="gallery-bar"><button class="icon-btn" data-back>' + U.icon('left') + '</button><b style="font-size:11px;font-weight:400">' + U.esc(x.name) + '</b><span class="spacer"></span>' +
          (x.kind === 'wall' ? '<button class="btn" data-pwall="' + x.id + '">设为壁纸</button>' : '<button class="btn" data-pdel="' + U.esc(x.path) + '">删除</button>') +
          '<a class="btn" href="' + (x.kind === 'wall' ? x.url : A.rawUrl(x.path, true)) + '" download>' + U.icon('download') + ' 下载</a>' +
          '<button class="icon-btn" data-close>' + U.icon('close') + '</button></div>' +
        '<img src="' + cardSrc(x) + '" alt="' + U.esc(x.name) + '">';
      body.querySelector('.gallery-app').insertBefore(wrap, $('#galleryStatus', body).parentNode);
      $('[data-back]', wrap).addEventListener('click', closePreview);
      $('[data-close]', wrap).addEventListener('click', closePreview);
      const pw = $('[data-pwall]', wrap); if (pw) pw.addEventListener('click', () => { BC.setWallpaper(x.id); BC.toast('壁纸已更新: ' + x.name); });
      const pd = $('[data-pdel]', wrap); if (pd) pd.addEventListener('click', () => del(pd.dataset.pdel));
    }
    function closePreview() {
      previewing = null;
      const old = $('.gallery-preview', body); if (old) old.remove();
      grid.classList.remove('hidden'); grid.style.display = '';
    }
    async function del(path) {
      const ok = await BC.ui.confirm('删除图片', '永久删除 <code>' + U.esc(path) + '</code>？');
      if (!ok) return;
      try { await A.fsRemove(path); BC.toast('图片已删除'); closePreview(); await load(); }
      catch (e) { BC.toast('删除失败: ' + e.message); }
    }
    grid.addEventListener('click', e => {
      const sw = e.target.closest('[data-setwall]');
      if (sw) { BC.setWallpaper(sw.dataset.setwall); BC.toast('壁纸已更新'); return; }
      const dw = e.target.closest('[data-dlwall]');
      if (dw) { const w = builtins.find(b => b.id === dw.dataset.dlwall); if (w) { const a = document.createElement('a'); a.href = w.url; a.download = 'batcave-' + w.id + '.jpg'; a.click(); } return; }
      const di = e.target.closest('[data-delimg]');
      if (di) { del(di.dataset.delimg); return; }
      const card = e.target.closest('[data-gi]');
      if (card) { const all = builtins.concat(uploads); const x = all[Number(card.dataset.gi)]; if (x) preview(x); }
    });
    $('#galleryFile', body).addEventListener('change', async e => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      pending = files.length;
      $('#galleryStatus', body).textContent = 'UPLOADING ' + pending;
      for (const f of files) {
        if (!/^image\//.test(f.type)) { BC.toast('跳过非图像文件: ' + f.name); continue; }
        try {
          const safeName = String(f.name || 'image').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
          await A.upload('/Gallery/' + safeName, f, p => { $('#galleryStatus', body).textContent = 'UPLOADING ' + f.name + ' · ' + Math.round(p * 100) + '%'; });
        } catch (err) {
          try { await A.upload('/Uploads/' + String(f.name || 'image').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_'), f); }
          catch (e2) { BC.toast('上传失败: ' + e2.message); }
        }
      }
      e.target.value = '';
      await load();
      $('#galleryStatus', body).textContent = 'UPLOAD COMPLETE';
      BC.toast(files.length + ' 个文件已上传');
    });
    $('[data-g="upload"]', body).addEventListener('click', () => $('#galleryFile', body).click());
    $('[data-g="refresh"]', body).addEventListener('click', load);
    load();
  }

  /* ================================================================ REGISTER */
  BC.registerApp({ id: 'monitor', name: '系统监视器', en: 'TELEMETRY', icon: 'monitor', color: '#5ffbf1', width: 820, height: 580, desc: '真实 CPU / 内存 / 网络遥测', mount: createMonitor });
  BC.registerApp({ id: 'settings', name: '设置', en: 'CONFIG', icon: 'settings', color: '#9aa8b5', width: 720, height: 560, desc: '主题、账户与系统信息', mount: createSettings });
  BC.registerApp({ id: 'notes', name: '代号笔记', en: 'NOTES', icon: 'notes', color: '#8fb4c2', width: 760, height: 540, desc: '写入真实 /Notes 目录', mount: createNotes });
  BC.registerApp({ id: 'calc', name: '计算器', en: 'CALC', icon: 'calc', color: '#ffcf5c', width: 340, height: 510, minWidth: 280, minHeight: 420, desc: '安全表达式解析器', mount: createCalculator });
  BC.registerApp({ id: 'vault', name: '暗影保险库', en: 'VAULT', icon: 'vault', color: '#a99bff', width: 650, height: 500, desc: 'AES-256-GCM 加密凭据', mount: createVault });
  BC.registerApp({ id: 'music', name: '暗夜电台', en: 'SYNTH', icon: 'music', color: '#ff79b0', width: 760, height: 500, desc: 'WebAudio 生成式合成音乐', mount: createMusic });
  BC.registerApp({ id: 'gallery', name: '图像库', en: 'GALLERY', icon: 'gallery', color: '#f2b45c', width: 840, height: 560, desc: '壁纸与本地上传图像', mount: createGallery });
})();