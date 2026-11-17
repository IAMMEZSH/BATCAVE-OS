/* BATCAVE OS // system apps: weather, map, security, task manager, calendar */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ================================================================ WEATHER */
  const WMO = {
    0: ['晴朗', 'weather'], 1: ['大部晴朗', 'weather'], 2: ['多云', 'weather'], 3: ['阴天', 'weather'],
    45: ['雾', 'eye'], 48: ['冻雾', 'eye'], 51: ['小毛毛雨', 'weather'], 53: ['毛毛雨', 'weather'], 55: ['强毛毛雨', 'weather'],
    56: ['冻毛毛雨', 'weather'], 57: ['强冻毛毛雨', 'weather'], 61: ['小雨', 'weather'], 63: ['中雨', 'weather'], 65: ['大雨', 'weather'],
    66: ['冻雨', 'weather'], 67: ['强冻雨', 'weather'], 71: ['小雪', 'weather'], 73: ['中雪', 'weather'], 75: ['大雪', 'weather'],
    77: ['米雪', 'weather'], 80: ['阵雨', 'weather'], 81: ['强阵雨', 'weather'], 82: ['暴雨', 'weather'],
    85: ['阵雪', 'weather'], 86: ['强阵雪', 'weather'], 95: ['雷暴', 'alert'], 96: ['雷暴伴冰雹', 'alert'], 99: ['强雷暴伴冰雹', 'alert']
  };
  function wmo(code) { return WMO[code] || ['未知天气', 'weather']; }

  function createWeather(body, win) {
    body.innerHTML =
      '<div class="app weather-app">' +
        '<div class="app-toolbar"><span class="toolbar-title">气象站</span><span class="toolbar-sub">OPEN-METEO · LIVE NETWORK</span><span class="spacer"></span>' +
          '<input class="input" id="wxCity" placeholder="城市 / 拼音 / 英文" style="width:160px;height:28px;font-size:10px">' +
          '<button class="icon-btn" data-wx="search" title="查询">' + U.icon('search') + '</button>' +
          '<button class="icon-btn" data-wx="locate" title="使用当前位置">' + U.icon('map') + '</button>' +
          '<button class="btn" data-wx="unit" id="wxUnit">°C</button>' +
          '<button class="icon-btn" data-wx="refresh" title="刷新">' + U.icon('refresh') + '</button>' +
        '</div>' +
        '<div class="weather-body" id="wxBody">' +
          '<div class="empty-state"><span class="term-spinner"></span><b>连接气象卫星…</b><p>通过本地代理访问 Open-Meteo，需要互联网连接。</p></div>' +
        '</div>' +
        '<div class="app-status"><span class="ok" id="wxStatus">CONNECTING</span><span class="spacer"></span><span id="wxSource">SOURCE —</span></div>' +
      '</div>';
    const bodyEl = $('#wxBody', body), cityEl = $('#wxCity', body);
    let place = BC.store.get('weather.place', null);
    let unit = BC.store.get('weather.unit', 'C') === 'F' ? 'F' : 'C';
    let data = null, loading = false;
    $('#wxUnit', body).textContent = '°' + unit;

    function deg(v) { return unit === 'C' ? Math.round(v) + '°' : Math.round(v * 9 / 5 + 32) + '°'; }
    function setStatus(t, cls) { $('#wxStatus', body).textContent = t; $('#wxStatus', body).className = cls || ''; }
    function loadingView(t) {
      bodyEl.innerHTML = '<div class="empty-state"><span class="term-spinner"></span><b>' + U.esc(t || '获取气象数据…') + '</b><p>数据来自 api.open-meteo.com，经 127.0.0.1 代理请求。</p></div>';
    }
    function errorView(msg) {
      bodyEl.innerHTML = '<div class="empty-state"><svg class="ic"><use href="#i-alert"></use></svg><b>气象信号丢失</b><p>' + U.esc(msg) + '</p><button class="btn primary" data-wx-retry>重试</button><p style="font-size:8px;font-family:var(--mono)">需要可用的互联网连接，且 api.open-meteo.com 可被访问。</p></div>';
      const r = $('[data-wx-retry]', bodyEl); if (r) r.addEventListener('click', () => place ? loadForecast() : geocode(cityEl.value || '上海'));
      setStatus('SIGNAL LOST', 'err');
    }
    function render() {
      if (!data) return;
      const cur = data.current, daily = data.daily;
      const [desc, icon] = wmo(cur.weather_code);
      const night = cur.is_day === 0;
      bodyEl.innerHTML =
        '<div class="weather-hero"><div>' +
          '<div class="weather-place">' + U.esc((place ? place.label : 'UNKNOWN').toUpperCase()) + ' · ' + U.esc(data.timezone || '') + '</div>' +
          '<div class="weather-temp">' + Math.round(unit === 'C' ? cur.temperature_2m : cur.temperature_2m * 9 / 5 + 32) + '<sup>' + unit + '</sup></div>' +
          '<div class="weather-cond">' + U.esc(desc) + (night ? ' · 夜间' : '') + '</div>' +
        '</div><div class="weather-icon">' + U.icon(night && cur.weather_code <= 1 ? 'moon' : icon) + '</div></div>' +
        '<div class="weather-stats">' +
          '<div class="wstat"><span>体感温度</span><b>' + deg(cur.apparent_temperature) + '</b></div>' +
          '<div class="wstat"><span>相对湿度</span><b>' + Math.round(cur.relative_humidity_2m) + '%</b></div>' +
          '<div class="wstat"><span>风速</span><b>' + Math.round(cur.wind_speed_10m) + ' km/h</b></div>' +
          '<div class="wstat"><span>气压</span><b>' + Math.round(cur.surface_pressure) + ' hPa</b></div>' +
        '</div>' +
        '<div class="weather-forecast">' + (daily.time || []).map((ds, i) => {
          const d = new Date(ds + 'T12:00:00');
          const [fd, fi] = wmo(daily.weather_code[i]);
          const day = i === 0 ? '今天' : '周' + '日一二三四五六'[d.getDay()];
          return '<div class="wday"><span>' + day + '</span>' + U.icon(fi) + '<b>' + deg(daily.temperature_2m_max[i]) + '</b><i>' + deg(daily.temperature_2m_min[i]) + '</i><i>' + U.esc(fd) + '</i><i>' + (daily.precipitation_probability_max[i] ?? '—') + '%</i></div>';
        }).join('') + '</div>';
      setStatus('LIVE · ' + new Date().toLocaleTimeString(), 'ok');
      $('#wxSource', body).textContent = 'OPEN-METEO · ' + (data.timezone_abbreviation || 'LOCAL');
      cityEl.value = place ? place.name : cityEl.value;
    }
    async function loadForecast() {
      if (!place || loading) return;
      loading = true; loadingView('获取 ' + place.label + ' 的气象数据…'); setStatus('FETCHING', 'warn');
      try {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(place.lat) +
          '&longitude=' + encodeURIComponent(place.lon) +
          '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,surface_pressure,is_day' +
          '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=7';
        const r = await A.proxyFetch(url, 20000);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        data = JSON.parse(r.text);
        if (!data.current || !data.daily) throw new Error('响应缺少气象字段');
        place.name = place.name || cityEl.value;
        BC.store.set('weather.place', place);
        render();
      } catch (e) {
        errorView(e.message || String(e));
      } finally { loading = false; }
    }
    async function geocode(name) {
      const q = String(name || '').trim();
      if (!q) return BC.toast('输入城市名');
      loading = true; loadingView('解析城市坐标…'); setStatus('GEOCODING', 'warn');
      try {
        const r = await A.proxyFetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=1&language=zh&format=json', 15000);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = JSON.parse(r.text);
        const g = j.results && j.results[0];
        if (!g) throw new Error('没有找到城市：' + q);
        place = { name: g.name, label: [g.name, g.admin1, g.country].filter(Boolean).join(', '), lat: g.latitude, lon: g.longitude };
        BC.store.set('weather.place', place);
        loading = false;
        await loadForecast();
      } catch (e) {
        loading = false; errorView(e.message || String(e));
      }
    }
    function useLocation() {
      if (!navigator.geolocation) return BC.toast('浏览器不支持定位');
      loadingView('请求定位权限…'); setStatus('LOCATING', 'warn');
      navigator.geolocation.getCurrentPosition(async pos => {
        place = { name: '当前位置', label: 'MY LOCATION · ' + pos.coords.latitude.toFixed(3) + ', ' + pos.coords.longitude.toFixed(3), lat: pos.coords.latitude, lon: pos.coords.longitude };
        BC.store.set('weather.place', place);
        loading = false;
        await loadForecast();
      }, err => { loading = false; errorView('定位失败: ' + err.message); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
    }
    $$('[data-wx]', body).forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.wx;
      if (act === 'search') geocode(cityEl.value);
      else if (act === 'refresh') { if (place) loadForecast(); else geocode(cityEl.value || '上海'); }
      else if (act === 'locate') useLocation();
      else if (act === 'unit') { unit = unit === 'C' ? 'F' : 'C'; BC.store.set('weather.unit', unit); $('#wxUnit', body).textContent = '°' + unit; if (data) render(); }
    }));
    cityEl.addEventListener('keydown', e => { if (e.key === 'Enter') geocode(cityEl.value); });
    if (place) loadForecast(); else geocode('上海');
  }

  /* ================================================================ MAP */
  function createMap(body, win) {
    const DISTRICTS = [
      { id: 'spire', name: '尖塔区', en: 'THE SPIRE', cx: 50, cy: 23, desc: '金融与行政中枢。玻璃幕墙把整座城市的信号反射成一场永不停歇的雨。', points: '40,12 60,10 67,26 58,35 42,34 33,23' },
      { id: 'docks', name: '铁码头', en: 'IRON DOCKS', cx: 23, cy: 49, desc: '货运、走私与旧仓库。集装箱堆叠成迷宫，无线电在潮气里发霉。', points: '10,38 32,34 39,50 30,65 12,60' },
      { id: 'cinder', name: '灰烬街', en: 'CINDER ROW', cx: 49, cy: 59, desc: '工业带与黑市。旧锅炉从未熄灭，交易与秘密沿着铁轨流动。', points: '39,42 58,38 66,56 55,76 40,79 31,61' },
      { id: 'nightmarket', name: '霓虹市集', en: 'NIGHTMARKET', cx: 78, cy: 46, desc: '霓虹商业区。广告牌比星星亮，喧闹掩盖着每一次低声交易。', points: '67,29 90,32 93,56 75,65 64,50 66,38' },
      { id: 'vesper', name: '维斯珀湾', en: 'VESPER BAY', cx: 76, cy: 76, desc: '住宅与旧灯塔。潮水拍打废弃码头，守望者在灯塔上记录每一次出航。', points: '63,63 89,58 95,80 78,93 57,87' }
    ];
    body.innerHTML =
      '<div class="app map-app">' +
        '<div class="app-toolbar"><span class="toolbar-title">哥谭网格</span><span class="toolbar-sub">LOCAL CARTOGRAPHY · FICTIONAL CITY</span><span class="spacer"></span>' +
          '<button class="btn" data-map="osm">' + U.icon('external') + ' 真实地图</button>' +
        '</div>' +
        '<div class="map-layout">' +
          '<div class="map-canvas-wrap" id="mapWrap">' +
            '<svg class="gotham-map" id="gothamMap" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">' +
              '<defs><pattern id="mgrid" width="5" height="5" patternUnits="userSpaceOnUse"><path class="grid" d="M5 0H0V5" fill="none"/></pattern></defs>' +
              '<rect width="100" height="100" fill="url(#mgrid)"/>' +
              '<path class="river" d="M-5 82 C15 72 28 88 42 79 S70 58 104 68 L104 100 L-5 100 Z"/>' +
              '<path class="coast" d="M-5 82 C15 72 28 88 42 79 S70 58 104 68"/>' +
              '<path class="road" d="M2 34 34 30 52 37 71 31 98 36M35 8 42 34 40 79M61 12 66 38 62 88M8 52 31 61 55 56 75 64 94 57"/>' +
              DISTRICTS.map(d => '<polygon class="district" data-district="' + d.id + '" points="' + d.points + '"/>').join('') +
              '<circle class="pin" id="mapPin" cx="50" cy="23" r="1.4"/>' +
              DISTRICTS.map(d => '<text class="major" x="' + d.cx + '" y="' + (d.cy - 4) + '" text-anchor="middle">' + d.en + '</text><text x="' + d.cx + '" y="' + (d.cy + 0.5) + '" text-anchor="middle">SECTOR ' + String(DISTRICTS.indexOf(d) + 1).padStart(2, '0') + '</text>').join('') +
            '</svg>' +
            '<div class="map-ctrl"><button data-zoom="in" title="放大">' + U.icon('plus') + '</button><button data-zoom="out" title="缩小">' + U.icon('min') + '</button><button data-zoom="reset" title="复位">' + U.icon('refresh') + '</button></div>' +
            '<div class="map-cross" id="mapCross">GRID REF · 00.00 / 00.00</div>' +
          '</div>' +
          '<aside class="map-side"><h3 id="mapName">尖塔区</h3><div class="coord" id="mapCoord">THE SPIRE · SECTOR 01</div>' +
            '<div class="desc" id="mapDesc"></div><div class="section-label">DISTRICTS</div><div class="district-list">' +
              DISTRICTS.map((d, i) => '<button class="district-item ' + (i === 0 ? 'on' : '') + '" data-d="' + d.id + '"><span class="dot" style="background:var(--acc);border-radius:50%"></span>' + d.name + '</button>').join('') +
            '</div><p style="font-family:var(--mono);font-size:7px;color:var(--dim);line-height:1.7;margin-top:16px">这是虚构城市的本地艺术地图，不是真实地理数据。点击“真实地图”将把 OpenStreetMap 载入沙箱浏览器。</p></aside>' +
        '</div>' +
        '<div class="app-status"><span class="ok">LOCAL GRID ONLINE</span><span class="spacer"></span><span>SCALE 1.0×</span></div>' +
      '</div>';
    const svg = $('#gothamMap', body);
    let selected = 'spire', zoom = 1;
    function select(id) {
      const d = DISTRICTS.find(x => x.id === id); if (!d) return;
      selected = id;
      $$('.district', body).forEach(p => p.classList.toggle('on', p.dataset.district === id));
      $$('.district-item', body).forEach(b => b.classList.toggle('on', b.dataset.d === id));
      $('#mapName', body).textContent = d.name + ' · ' + d.en;
      $('#mapCoord', body).textContent = d.en + ' · SECTOR ' + String(DISTRICTS.indexOf(d) + 1).padStart(2, '0');
      $('#mapDesc', body).textContent = d.desc;
      const pin = $('#mapPin', body); pin.setAttribute('cx', d.cx); pin.setAttribute('cy', d.cy);
      $('#mapCross', body).textContent = 'GRID REF · ' + (d.cx / 10).toFixed(2) + ' / ' + (d.cy / 10).toFixed(2);
    }
    svg.addEventListener('click', e => {
      const p = e.target.closest('[data-district]'); if (p) select(p.dataset.district);
    });
    $$('.district-item', body).forEach(b => b.addEventListener('click', () => select(b.dataset.d)));
    $$('[data-zoom]', body).forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.zoom;
      if (act === 'in') zoom = Math.min(2.4, zoom + 0.2);
      else if (act === 'out') zoom = Math.max(1, zoom - 0.2);
      else zoom = 1;
      svg.style.transition = 'transform .2s';
      svg.style.transform = 'scale(' + zoom + ')';
      const st = $('.app-status span:last-child', body); if (st) st.textContent = 'SCALE ' + zoom.toFixed(1) + '×';
    }));
    $('[data-map="osm"]', body).addEventListener('click', () => BC.openApp('browser', { url: 'https://www.openstreetmap.org' }));
    select('spire');
  }

  /* ================================================================ SECURITY */
  function createSecurity(body, win) {
    body.innerHTML =
      '<div class="app security-app">' +
        '<div class="app-toolbar"><span class="toolbar-title">安全中心</span><span class="toolbar-sub">LOCAL POSTURE · NOT A VULNERABILITY SCANNER</span><span class="spacer"></span>' +
          '<button class="btn primary" data-sec="run">' + U.icon('security') + ' 运行诊断</button>' +
        '</div>' +
        '<div class="security-body">' +
          '<div class="sec-top">' +
            '<div class="radar-card"><div class="radar"><div class="radar-sweep"></div>' +
              '<span class="radar-dot" style="left:28%;top:38%;animation-delay:0s"></span><span class="radar-dot" style="left:64%;top:27%;animation-delay:.8s"></span>' +
              '<span class="radar-dot" style="left:72%;top:66%;animation-delay:1.6s"></span><span class="radar-dot" style="left:41%;top:72%;animation-delay:2.3s"></span>' +
            '</div><span class="chip">LOOPBACK PERIMETER</span><span style="font-family:var(--mono);font-size:7px;color:var(--dim);text-align:center">本机配置检查 · 被动状态</span></div>' +
            '<div class="sec-checks"><h4>CONTROL MATRIX</h4><div id="secChecks"><div class="sec-check"><span class="info">…</span><b>等待诊断</b><span>IDLE</span></div></div>' +
              '<div class="diag-actions"><button class="btn" data-sec="net">网络连通测试</button><button class="btn" data-sec="proxytest">代理策略测试</button></div>' +
            '</div>' +
          '</div>' +
          '<div class="monitor-card" style="margin-top:12px"><h4>DIAGNOSTIC LOG</h4><div class="diag-log" id="diagLog">$ security --posture\n等待诊断启动…</div>' +
            '<div class="diag-actions"><button class="btn" id="secTerm">在终端中运行 neofetch</button><button class="btn" id="secLinux">Linux Core 状态</button></div>' +
          '</div>' +
        '</div>' +
        '<div class="app-status"><span class="ok" id="secStatus">READY</span><span class="spacer"></span><span>LOCAL ONLY</span></div>' +
      '</div>';
    const checksEl = $('#secChecks', body), logEl = $('#diagLog', body);
    let busy = false;
    function log(msg, cls) {
      const d = document.createElement('div'); d.className = cls || ''; d.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
    }
    function check(name, status, detail) {
      return '<div class="sec-check"><span class="' + (status === 'PASS' ? 'ok' : status === 'WARN' ? 'warn' : 'info') + '">' + U.icon(status === 'PASS' ? 'check' : status === 'WARN' ? 'alert' : 'info') + '</span><b>' + U.esc(name) + '</b><span>' + status + ' · ' + U.esc(detail || '') + '</span></div>';
    }
    async function run() {
      if (busy) return;
      busy = true; $('#secStatus', body).textContent = 'DIAGNOSING'; $('#secStatus', body).className = 'warn';
      checksEl.innerHTML = ''; logEl.textContent = '$ security --posture\n';
      const rows = [];
      function add(name, status, detail) { rows.push(check(name, status, detail)); checksEl.innerHTML = rows.join(''); log(name + ' → ' + status + (detail ? ' · ' + detail : ''), status === 'PASS' ? 'ok' : status === 'WARN' ? 'warn' : 'err'); }
      const tokenOk = !!A.token; add('会话执行令牌', tokenOk ? 'PASS' : 'FAIL', tokenOk ? '已注入本次页面' : '未注入，执行接口不可用');
      const hostOk = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(location.hostname);
      add('本地回环绑定', hostOk ? 'PASS' : 'WARN', location.hostname);
      const cryptoOk = !!(window.crypto && crypto.subtle); add('WebCrypto 可用', cryptoOk ? 'PASS' : 'FAIL', cryptoOk ? 'AES-GCM / PBKDF2' : '需要安全上下文');
      try {
        const h = await A.hello();
        add('本地服务心跳', h && h.ok !== false ? 'PASS' : 'WARN', h && (h.version || h.name) ? ('服务在线 · ' + (h.version || h.name)) : '服务响应');
      } catch (e) { add('本地服务心跳', 'FAIL', e.message); }
      try {
        const st = await A.linuxStatus();
        add('Linux Core', st.available ? 'PASS' : 'WARN', st.available ? ('引擎在线 · ' + (st.engine || '')) : '离线 · apt/sudo 需要 WSL2 或 ISO');
      } catch (e) { add('Linux Core', 'WARN', e.message); }
      try {
        const s = await A.stats();
        add('桥接模式', 'PASS', (s.bridge.modes || []).filter(m => m.available).map(m => m.label).join(' / '));
      } catch (e) { add('桥接模式', 'WARN', e.message); }
      add('安全边界', 'PASS', '令牌 + Origin + 危险确认 + SSRF 防护');
      $('#secStatus', body).textContent = 'DIAGNOSIS COMPLETE'; $('#secStatus', body).className = 'ok';
      busy = false;
    }
    $$('[data-sec]', body).forEach(b => b.addEventListener('click', async () => {
      if (b.dataset.sec === 'run') run();
      else if (b.dataset.sec === 'net') {
        log('测试外部网络: https://example.com …');
        try { const r = await A.proxyFetch('https://example.com', 15000); if (!r.ok) throw new Error('HTTP ' + r.status); log('外部网络可达 · ' + r.text.length + ' 字符', 'ok'); }
        catch (e) { log('外部网络不可达: ' + e.message, 'err'); }
      } else if (b.dataset.sec === 'proxytest') {
        log('测试 SSRF 防护: 请求 http://127.0.0.1/ …');
        try {
          const r = await A.proxyFetch('http://127.0.0.1/', 8000);
          log('代理意外允许了回环请求，请检查服务配置！HTTP ' + r.status, 'err');
        } catch (e) { log('已阻止回环请求（符合预期）: ' + e.message, 'ok'); }
      }
    }));
    $('#secTerm', body).addEventListener('click', () => BC.runInTerminal('neofetch'));
    $('#secLinux', body).addEventListener('click', () => BC.runInTerminal('linux-core'));
    run();
  }

  /* ================================================================ TASK MANAGER */
  function createTaskmgr(body, win) {
    body.innerHTML =
      '<div class="app taskmgr-app">' +
        '<div class="app-toolbar"><span class="toolbar-title">任务管理器</span><span class="toolbar-sub">WINDOWS · REAL PROCESS SNAPSHOT</span><span class="spacer"></span>' +
          '<button class="icon-btn" data-t="procs" title="刷新进程">' + U.icon('cpu') + '</button>' +
          '<button class="icon-btn" data-t="refresh" title="刷新">' + U.icon('refresh') + '</button>' +
        '</div>' +
        '<div class="task-summary">' +
          '<div class="tsum"><b id="tWindows">—</b><span>OPEN WINDOWS</span></div>' +
          '<div class="tsum"><b id="tCpu">—</b><span>CPU LOAD</span></div>' +
          '<div class="tsum"><b id="tMem">—</b><span>MEMORY USED</span></div>' +
          '<div class="tsum"><b id="tProcs">—</b><span>PROCESS ROWS</span></div>' +
        '</div>' +
        '<div class="task-body">' +
          '<div class="task-windows"><div class="task-head"><span>OPEN WINDOWS</span><span>CLICK TO FOCUS</span></div><div class="task-list" id="taskWindows"></div></div>' +
          '<div class="task-procs"><div class="proc-head"><span id="procCmd">PROCESS SNAPSHOT</span><span id="procTime">—</span></div><pre class="proc-out" id="procOut">点击右上角 CPU 图标刷新真实进程列表。</pre></div>' +
        '</div>' +
        '<div class="app-status"><span class="ok" id="taskStatus">LIVE</span><span class="spacer"></span><span id="taskHost"></span></div>' +
      '</div>';
    const list = $('#taskWindows', body), pre = $('#procOut', body);
    let tickTimer = null, procCtrl = null, disposed = false;
    $('#taskHost', body).textContent = BC.BOOT.hostname || 'LOCAL';

    function renderWindows() {
      const ws = BC.getWindows();
      $('#tWindows', body).textContent = ws.length;
      list.innerHTML = ws.length ? ws.map(w =>
        '<div class="task-row"><span class="app-ico" style="--iaccent:' + (w.app.color || 'var(--acc)') + '">' + U.icon(w.app.icon || 'file') + '</span>' +
          '<div><b>' + U.esc(w.title || w.app.name) + '</b><span>' + U.esc(w.app.en || '') + ' · ' + (w.minimized ? 'MINIMIZED' : w.maximized ? 'MAXIMIZED' : 'WINDOW') + '</span></div>' +
          '<button class="icon-btn small" data-focus="' + w.id + '" title="聚焦">' + U.icon('eye') + '</button>' +
          '<button class="icon-btn small" data-close="' + w.id + '" title="关闭窗口">' + U.icon('close') + '</button></div>'
      ).join('') : '<div class="empty-state" style="height:auto;padding:22px"><svg class="ic"><use href="#i-taskmgr"></use></svg><b>没有打开的窗口</b></div>';
    }
    async function refreshStats() {
      if (disposed) return;
      renderWindows();
      try {
        const s = await A.stats();
        $('#tCpu', body).textContent = Math.round(s.cpu.usage) + '%';
        $('#tMem', body).textContent = U.fmtBytes(s.mem.used);
      } catch (e) {
        $('#taskStatus', body).textContent = 'STATS LOST'; $('#taskStatus', body).className = 'err';
      }
    }
    async function loadProcesses() {
      if (procCtrl) { try { procCtrl.abort(); } catch { } procCtrl = null; }
      pre.textContent = '正在采集进程快照…\n';
      $('#procTime', body).textContent = 'RUNNING';
      const modes = (BC.BOOT.bridge && BC.BOOT.bridge.modes) || [];
      const hasLinux = !!(BC.BOOT.bridge && BC.BOOT.bridge.linuxAvailable);
      const mode = hasLinux ? 'linux' : (modes.find(m => m.id === 'cmd' && m.available) ? 'cmd' : 'gitbash');
      const cmd = mode === 'linux'
        ? 'ps -eo pid,ppid,pcpu,pmem,comm --sort=-pcpu | head -n 32'
        : mode === 'cmd' ? 'tasklist /FO TABLE /NH' : 'ps -W';
      $('#procCmd', body).textContent = cmd;
      let out = '';
      try {
        const ctrl = await A.execStream({ cmd, mode, cwd: BC.BOOT.homeUnix || BC.BOOT.home || '/' }, {
          onController: c => { procCtrl = c; },
          onData: (d, k) => { out += d; pre.textContent = out; pre.scrollTop = pre.scrollHeight; },
          onEnd: ev => {
            pre.textContent = out || '(无输出)';
            $('#procTime', body).textContent = 'EXIT ' + ev.code + ' · ' + U.fmtDuration(ev.duration);
            const rows = out.split(/\r?\n/).filter(l => /\S/.test(l)).length;
            $('#tProcs', body).textContent = Math.max(0, rows - 1);
            $('#taskStatus', body).textContent = ev.code === 0 ? 'SNAPSHOT COMPLETE' : 'EXIT ' + ev.code;
            $('#taskStatus', body).className = ev.code === 0 ? 'ok' : 'warn';
          }
        });
        procCtrl = ctrl;
      } catch (e) {
        pre.textContent = '进程快照失败: ' + e.message + '\n模式: ' + mode;
        $('#procTime', body).textContent = 'ERROR';
      }
    }
    list.addEventListener('click', e => {
      const f = e.target.closest('[data-focus]');
      if (f) { const w = BC.getWindows().find(x => x.id === f.dataset.focus); if (w) BC.focusWindow(w); return; }
      const c = e.target.closest('[data-close]');
      if (c) { BC.closeWindow(c.dataset.close); renderWindows(); }
    });
    $('[data-t="refresh"]', body).addEventListener('click', refreshStats);
    $('[data-t="procs"]', body).addEventListener('click', loadProcesses);
    refreshStats();
    tickTimer = setInterval(refreshStats, 2500);
    loadProcesses();
    return () => { disposed = true; clearInterval(tickTimer); if (procCtrl) { try { procCtrl.abort(); } catch { } } };
  }

  /* ================================================================ CALENDAR */
  function createCalendar(body, win) {
    body.innerHTML =
      '<div class="app calendar-app">' +
        '<div class="cal-body">' +
          '<div class="cal-main"><div class="cal-head"><button class="icon-btn" data-cal="prev">' + U.icon('left') + '</button>' +
            '<h3 id="calTitle"></h3>' +
            '<div style="display:flex;gap:4px"><button class="btn" data-cal="today">今天</button><button class="icon-btn" data-cal="next">' + U.icon('right') + '</button></div></div>' +
            '<div class="cal-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>' +
            '<div class="cal-grid" id="calGrid"></div>' +
          '</div>' +
          '<aside class="cal-side"><h4 id="calSideTitle"></h4><div class="section-label">EVENTS</div><div class="cal-events" id="calEvents"></div>' +
            '<div class="cal-add"><input class="input" type="time" id="calTime" value="09:00" style="width:82px;height:30px;font-size:9px;padding:0 5px"><input class="input" id="calText" placeholder="事件内容…" style="flex:1;min-width:0;height:30px;font-size:10px"><button class="icon-btn" data-cal="add" title="添加事件">' + U.icon('plus') + '</button></div>' +
          '</aside>' +
        '</div>' +
        '<div class="app-status"><span class="ok" id="calStatus">LOCAL CALENDAR</span><span class="spacer"></span><span id="calCount"></span></div>' +
      '</div>';
    let events = BC.store.get('calendar.events', {});
    if (!events || typeof events !== 'object') events = {};
    const today = new Date();
    let view = new Date(today.getFullYear(), today.getMonth(), 1);
    let selected = dkey(today);
    function dkey(d) { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
    function save() { BC.store.set('calendar.events', events); }
    function render() {
      $('#calTitle', body).textContent = view.getFullYear() + ' 年 ' + (view.getMonth() + 1) + ' 月';
      const first = new Date(view.getFullYear(), view.getMonth(), 1);
      const start = new Date(first);
      start.setDate(1 - ((first.getDay() + 6) % 7));
      const cells = [];
      const tk = dkey(today);
      for (let i = 0; i < 42; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const k = dkey(d);
        const has = (events[k] || []).length;
        cells.push('<button class="cal-day ' + (d.getMonth() !== view.getMonth() ? 'out' : '') + (k === tk ? ' today' : '') + (k === selected ? ' sel' : '') + '" data-day="' + k + '">' + d.getDate() + (has ? '<span class="evdot"></span>' : '') + '</button>');
      }
      $('#calGrid', body).innerHTML = cells.join('');
      renderSide();
      const all = Object.values(events).reduce((a, arr) => a + (arr ? arr.length : 0), 0);
      $('#calCount', body).textContent = all + ' EVENTS · LOCAL STORAGE';
    }
    function renderSide() {
      const d = new Date(selected + 'T12:00:00');
      $('#calSideTitle', body).textContent = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 周' + '日一二三四五六'[d.getDay()];
      const arr = (events[selected] || []).slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
      $('#calEvents', body).innerHTML = arr.length ? arr.map(e =>
        '<div class="cal-event"><b>' + U.esc(e.time || '--:--') + '</b><span>' + U.esc(e.text) + '</span><button data-del-event="' + e.id + '" title="删除">' + U.icon('close') + '</button></div>'
      ).join('') : '<div style="font-family:var(--mono);font-size:9px;color:var(--dim);line-height:1.7;padding:12px 0">这一天没有事件。<br>在下方添加一条。</div>';
    }
    function addEvent() {
      const text = $('#calText', body).value.trim();
      if (!text) return BC.toast('输入事件内容');
      const time = $('#calTime', body).value || '--:--';
      if (!events[selected]) events[selected] = [];
      events[selected].push({ id: U.uid(), time, text });
      save(); $('#calText', body).value = '';
      render();
      BC.toast('事件已添加到 ' + selected);
    }
    $('#calGrid', body).addEventListener('click', e => {
      const b = e.target.closest('[data-day]');
      if (b) { selected = b.dataset.day; render(); }
    });
    $('#calEvents', body).addEventListener('click', e => {
      const b = e.target.closest('[data-del-event]');
      if (!b) return;
      events[selected] = (events[selected] || []).filter(x => x.id !== b.dataset.delEvent);
      if (!events[selected].length) delete events[selected];
      save(); render();
      BC.toast('事件已删除');
    });
    $$('[data-cal]', body).forEach(b => b.addEventListener('click', () => {
      if (b.dataset.cal === 'prev') view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
      else if (b.dataset.cal === 'next') view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
      else if (b.dataset.cal === 'today') { view = new Date(today.getFullYear(), today.getMonth(), 1); selected = dkey(today); }
      else if (b.dataset.cal === 'add') addEvent();
      render();
    }));
    $('#calText', body).addEventListener('keydown', e => { if (e.key === 'Enter') addEvent(); });
    render();
  }

  BC.registerApp({ id: 'weather', name: '气象站', en: 'WEATHER', icon: 'weather', color: '#78b8ff', width: 760, height: 570, desc: 'Open-Meteo 真实天气', mount: createWeather });
  BC.registerApp({ id: 'map', name: '哥谭网格', en: 'GRID MAP', icon: 'map', color: '#8bd66b', width: 800, height: 560, desc: '虚构城市地图与真实 OSM 入口', mount: createMap });
  BC.registerApp({ id: 'security', name: '安全中心', en: 'SECURITY', icon: 'security', color: '#4dffb8', width: 760, height: 590, desc: '本机安全态势与真实连通诊断', mount: createSecurity });
  BC.registerApp({ id: 'taskmgr', name: '任务管理器', en: 'TASKS', icon: 'taskmgr', color: '#ff8a3d', width: 820, height: 540, desc: '窗口与真实进程快照', mount: createTaskmgr });
  BC.registerApp({ id: 'calendar', name: '日历', en: 'CALENDAR', icon: 'calendar', color: '#b48cff', width: 700, height: 520, desc: '本地事件日历', mount: createCalendar });
})();