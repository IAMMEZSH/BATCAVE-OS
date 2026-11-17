/* BATCAVE OS // 定位工作站：嵌入用户的 geo-windows 11 面板内核 */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;

  function tzLabel(tz) {
    return String(tz || '').split('/').pop().replace(/_/g, ' ');
  }

  function createGeo(body, win) {
    body.innerHTML =
      '<div class="app geo-app">' +
        '<div class="geo-bar">' +
          '<div class="geo-brand"><svg class="ic"><use href="#i-map"></use></svg><div><b>定位工作站</b><span>GEO STATION · 11 个本地计算面板</span></div></div>' +
          '<div class="geo-tz" id="geoTz">时区：本机</div>' +
          '<div class="geo-actions">' +
            '<button class="btn small" data-gz="locate" title="浏览器定位后按经纬度查询 IANA 时区并同步系统时钟">按定位校准时区</button>' +
            '<button class="btn small" data-gz="reset" title="恢复使用主机本地时间">本机时间</button>' +
            '<button class="btn small" data-gz="reload" title="重新载入工作站">重载</button>' +
            '<button class="btn small" data-gz="popout" title="在新标签页打开">新窗口</button>' +
          '</div>' +
        '</div>' +
        '<iframe class="geo-frame" src="/geo/index.html" title="定位工作站" allow="geolocation; clipboard-write" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"></iframe>' +
        '<div class="app-status"><span id="geoStatus" class="ok">READY</span><span>GEO-WINDOWS KERNELS · LOCAL ONLY</span><span class="spacer" style="flex:1"></span><span id="geoInfo">全部计算在本机</span></div>' +
      '</div>';

    const frame = body.querySelector('.geo-frame');
    const statusEl = body.querySelector('#geoStatus');
    const tzEl = body.querySelector('#geoTz');
    const infoEl = body.querySelector('#geoInfo');

    function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = cls || ''; }
    function showTz() {
      const s = BC.settings();
      tzEl.textContent = '时区：' + (s.timeZone ? (s.timeZoneLabel || tzLabel(s.timeZone)) : '本机');
      tzEl.title = s.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    }
    showTz();

    function syncTimezoneByLocation() {
      if (!navigator.geolocation) { BC.toast('当前浏览器不支持定位'); return; }
      setStatus('LOCATING…', 'warn');
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        try {
          const r = await A.geoTimezone(lat, lon);
          if (!r.ok) throw new Error(r.message || '时区查询失败');
          BC.updateSettings({ timeZone: r.timezone, timeZoneLabel: tzLabel(r.timezone) });
          showTz();
          setStatus('TIMEZONE SYNCED', 'ok');
          infoEl.textContent = '定位 ' + lat.toFixed(4) + ', ' + lon.toFixed(4) + ' · ' + r.timezone + ' · 精度约 ' + Math.round(pos.coords.accuracy) + ' m';
          BC.toast('系统时区已切换为 ' + r.timezone);
        } catch (e) {
          setStatus('TIMEZONE FAILED', 'err');
          BC.toast('时区同步失败：' + e.message);
        }
      }, (err) => {
        setStatus('LOCATION DENIED', 'err');
        BC.toast('定位失败：' + (err.message || '权限被拒绝'));
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    }

    body.querySelector('[data-gz="locate"]').addEventListener('click', syncTimezoneByLocation);
    body.querySelector('[data-gz="reset"]').addEventListener('click', () => {
      BC.updateSettings({ timeZone: '', timeZoneLabel: '' });
      showTz();
      setStatus('LOCAL TIME', 'ok');
      BC.toast('时钟已恢复为主机本地时间');
    });
    body.querySelector('[data-gz="reload"]').addEventListener('click', () => {
      frame.src = '/geo/index.html?r=' + Date.now();
      setStatus('RELOADING', 'warn');
    });
    body.querySelector('[data-gz="popout"]').addEventListener('click', () => {
      window.open('/geo/index.html', '_blank', 'noopener');
    });
    frame.addEventListener('load', () => setStatus('READY', 'ok'));
    frame.addEventListener('error', () => setStatus('FRAME ERROR', 'err'));

    win.setTitle('定位工作站', 'GEO STATION');
    document.addEventListener('bc-settings-changed', showTz);
    return () => { frame.src = 'about:blank'; };
  }

  BC.registerApp({
    id: 'geo', name: '定位工作站', en: 'GEO STATION', icon: 'map', color: '#4dffb8',
    width: 1180, height: 760, minWidth: 720, minHeight: 480, singleton: true,
    desc: '坐标/基站/三角/信号/GNSS/天象/路由 · 11 面板',
    mount(body, win) { return createGeo(body, win); }
  });
})();