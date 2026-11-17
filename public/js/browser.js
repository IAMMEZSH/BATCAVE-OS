/* BATCAVE OS // sandboxed browser */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const LINKS = [
    { name: 'Wikipedia', sub: 'ENCYCLOPEDIA', url: 'https://www.wikipedia.org', icon: 'reader', color: '#d9dfe6' },
    { name: 'Hacker News', sub: 'SIGNAL FEED', url: 'https://news.ycombinator.com', icon: 'browser', color: '#ff8a3d' },
    { name: 'GitHub', sub: 'CODE VAULT', url: 'https://github.com', icon: 'forge', color: '#e6edf3' },
    { name: 'OpenStreetMap', sub: 'GOTHAM GRID', url: 'https://www.openstreetmap.org', icon: 'map', color: '#8bd66b' },
    { name: 'Example', sub: 'SANDBOX TEST', url: 'https://example.com', icon: 'browser', color: '#9aa8b5' },
    { name: 'Internet Archive', sub: 'ARCHIVE', url: 'https://archive.org', icon: 'files', color: '#9b8cff' },
    { name: 'MDN', sub: 'DEV DOCS', url: 'https://developer.mozilla.org', icon: 'notes', color: '#8fb4c2' },
    { name: 'DuckDuckGo', sub: 'SEARCH', url: 'https://duckduckgo.com', icon: 'search', color: '#ffb020' }
  ];

  function normalizeUrl(input) {
    let s = String(input || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(s)) return 'https://' + s;
    return 'https://www.bing.com/search?q=' + encodeURIComponent(s);
  }

  function createBrowser(body, win, params) {
    let stack = [], index = -1, reader = false, current = '', currentGrant = '';
    let incognito = false;
    let frameLoadTimer = null;
    const grants = new Map();
    let pendingGate = null;

    const REASON_TITLES = {
      'private-net': '私有/内网地址',
      'localhost': '本机回环地址',
      'dns-private': 'DNS 指向内网',
      'dns-fail': '无法验证目标地址',
      'protocol': '协议不受支持',
      'http-plain': '未加密连接（HTTP）',
      'ip-literal': '直接使用 IP 访问',
      'punycode': '域名可能同形仿冒',
      'credentials': 'URL 内嵌凭据',
      'long-url': 'URL 长度异常'
    };

    body.innerHTML =
      '<div class="app browser-app">' +
        '<div class="browser-bar">' +
          '<button class="icon-btn" data-b="back" title="后退" disabled>' + U.icon('left') + '</button>' +
          '<button class="icon-btn" data-b="fwd" title="前进" disabled>' + U.icon('right') + '</button>' +
          '<button class="icon-btn" data-b="home" title="主页">' + U.icon('home') + '</button>' +
          '<button class="icon-btn" data-b="reload" title="刷新">' + U.icon('refresh') + '</button>' +
          '<div class="browser-url"><svg class="ic"><use href="#i-wifi"></use></svg><input placeholder="输入网址或搜索…" spellcheck="false" aria-label="地址栏"></div>' +
          '<button class="icon-btn" data-b="go" title="前往">' + U.icon('right') + '</button>' +
          '<button class="icon-btn optional" data-b="reader" title="阅读模式">' + U.icon('reader') + '</button>' +
          '<button class="icon-btn optional" data-b="incognito" title="无痕浏览：不保留授权与站点会话，发送 DNT/GPC">' + U.icon('eye') + '</button>' +
          '<button class="icon-btn optional" data-b="external" title="在真实浏览器中打开">' + U.icon('external') + '</button>' +
        '</div>' +
        '<div class="browser-view">' +
          '<div class="browser-home">' +
            '<div class="browser-hero">' +
              '<div class="globe"><span class="orbit"></span><svg class="ic"><use href="#i-browser"></use></svg></div>' +
              '<span class="eyebrow">GOTHAM NET // SANDBOXED UPLINK</span>' +
              '<h2>接入 <em>外部信号</em></h2>' +
              '<p>所有网页经本地服务器代理，并在沙箱 iframe 中渲染。</p>' +
              '<div class="browser-search"><svg class="ic"><use href="#i-search"></use></svg><input placeholder="搜索网络或输入网址…" spellcheck="false"><button class="btn primary" data-home-go>访问</button></div>' +
              '<div class="quick-links">' +
                LINKS.map((l, i) => '<button class="ql" data-link="' + i + '"><span class="app-ico" style="--iaccent:' + l.color + '">' + U.icon(l.icon) + '</span><div><b>' + U.esc(l.name) + '</b><span>' + U.esc(l.sub) + '</span></div></button>').join('') +
              '</div>' +
              '<p class="browser-note">任何网络可达的站点都可访问。明文 HTTP、本机/私有网段、仿冒风险域名会先被阻止并列出原因，只有你明确授权后才进入。<br>远程页面无法访问本机 API；网站内容不由本系统背书。</p>' +
            '</div>' +
          '</div>' +
          '<div class="loading-screen hidden" style="position:absolute;inset:0;display:grid;place-items:center;background:#040a0e;z-index:4;color:var(--dim);font-family:var(--mono);font-size:10px"><span><span class="term-spinner"></span>CONNECTING TO REMOTE SIGNAL…</span></div>' +
          '<div class="browser-guard hidden" role="dialog" aria-modal="true" aria-labelledby="guardTitle">' +
            '<div class="guard-card">' +
              '<span class="guard-badge">SECURITY GATE</span>' +
              '<h2 id="guardTitle">检测到安全风险</h2>' +
              '<p class="guard-sub" id="guardSub"></p>' +
              '<div class="guard-target" id="guardTarget"></div>' +
              '<div class="guard-reasons" id="guardReasons"></div>' +
              '<div class="guard-actions"><button class="btn" data-g="cancel">返回</button><button class="btn danger" data-g="allow">我已了解风险，授权进入</button></div>' +
              '<p class="guard-note">授权仅对当前会话中的该站点有效，10 分钟后自动失效。系统级 SSRF 防护不会关闭。</p>' +
            '</div>' +
          '</div>' +
          '<iframe class="browser-frame hidden" sandbox="allow-scripts allow-forms allow-popups allow-downloads allow-modals" referrerpolicy="no-referrer" title="沙箱浏览器"></iframe>' +
        '</div>' +
        '<div class="app-status"><span id="browserStatus" class="ok">READY</span><span id="browserMode">IFRAME · SANDBOX</span><span class="spacer" style="flex:1"></span><span id="browserUrl">HOME</span></div>' +
      '</div>';

    const app = $('.browser-app', body);
    const home = $('.browser-home', body);
    const frame = $('.browser-frame', body);
    const loading = $('.loading-screen', body);
    const urlInput = $('.browser-url input', body);
    const homeInput = $('.browser-search input', body);
    const statusEl = $('#browserStatus', body);
    const modeEl = $('#browserMode', body);
    const urlEl = $('#browserUrl', body);
    const readerBtn = $('[data-b="reader"]', body);
    const incogBtn = $('[data-b="incognito"]', body);
    const externalBtn = $('[data-b="external"]', body);
    const guard = $('.browser-guard', body);
    const guardTitle = $('#guardTitle', body);
    const guardSub = $('#guardSub', body);
    const guardTarget = $('#guardTarget', body);
    const guardReasons = $('#guardReasons', body);
    const guardAllow = $('[data-g="allow"]', body);

    function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = cls || ''; }
    function modeLabel() { return (incognito ? 'INCOGNITO · ' : '') + (reader ? 'READER · SANITIZED' : 'IFRAME · SANDBOX'); }
    function applyIncognito() {
      incogBtn.classList.toggle('active', incognito);
      app.classList.toggle('incognito', incognito);
      modeEl.textContent = modeLabel();
      if (incognito) {
        grants.clear();
        currentGrant = '';
        if (!current) setStatus('READY · 无痕', 'ok');
      }
    }
    function updateNav() {
      $('[data-b="back"]', body).disabled = index <= 0;
      $('[data-b="fwd"]', body).disabled = index >= stack.length - 1;
    }
    function showHome(push) {
      current = '';
      currentGrant = '';
      pendingGate = null;
      guard.classList.add('hidden');
      if (push !== false) { stack = []; index = -1; }
      frame.classList.add('hidden');
      home.classList.remove('hidden');
      loading.classList.add('hidden');
      urlInput.value = '';
      setStatus('READY', 'ok');
      modeEl.textContent = modeLabel();
      urlEl.textContent = 'HOME';
      win.setTitle('浏览器', 'HOME');
      readerBtn.classList.remove('active');
      externalBtn.disabled = true;
      updateNav();
    }
    function hideGuard() { guard.classList.add('hidden'); }

    function showGuard(verdict, pending) {
      pendingGate = pending;
      const blocked = verdict.level === 'block';
      guardTitle.textContent = blocked ? '访问已被阻止' : '检测到安全风险';
      guardSub.textContent = blocked
        ? '该地址指向本机或私有网络，或无法验证真实目标。它可能触达内网设备、云元数据服务或本桌面 API。'
        : '该页面存在下列技术风险。确认你信任该站点后，才可继续加载。';
      guardTarget.textContent = verdict.url || pending.url;
      const reasons = verdict.reasons || [];
      guardReasons.innerHTML = reasons.length
        ? reasons.map(r => '<div class="guard-reason ' + (r.severity === 'block' ? 'block' : 'warn') + '">' +
            '<span class="gr-sev">' + (r.severity === 'block' ? 'BLOCK' : 'WARN') + '</span>' +
            '<div><b>' + U.esc(REASON_TITLES[r.code] || r.code) + '</b><p>' + U.esc(r.message) + '</p></div></div>').join('')
        : '<div class="guard-reason warn"><span class="gr-sev">WARN</span><div><b>需要明确授权</b><p>该地址被安全策略标记，继续前请确认来源可信。</p></div></div>';
      guard.classList.remove('hidden');
      loading.classList.add('hidden');
      setStatus('BLOCKED · 待授权', 'err');
      modeEl.textContent = 'SECURITY GATE';
      guardAllow.focus();
    }

    async function loadUrl(url, push, opts = {}) {
      if (!url) return showHome();
      const target = normalizeUrl(url);
      if (!/^https?:\/\//i.test(target)) { BC.toast('只支持 http/https 地址'); return; }
      let origin = '';
      try { origin = new URL(target).origin; } catch { BC.toast('无效地址'); return; }
      let grant = opts.grant || '';
      if (!opts.skipGate) {
        setStatus('CHECKING · 安全检查', 'warn');
        let verdict = null;
        try { verdict = await A.urlCheck(target); }
        catch (e) { BC.toast('安全检查服务不可用: ' + e.message); }
        if (verdict && verdict.level !== 'safe') {
          const cached = incognito ? null : grants.get(origin);
          if (!(cached && cached.expiresAt > Date.now() + 3000)) {
            showGuard(verdict, { url: target, push, reader });
            return;
          }
          grant = cached.grant;
        }
      }
      if (!grant && !incognito) {
        const cached = grants.get(origin);
        if (cached && cached.expiresAt > Date.now()) grant = cached.grant;
      }
      serve(target, push, grant);
    }

    function serve(target, push, grant) {
      guard.classList.add('hidden');
      pendingGate = null;
      if (push !== false) {
        stack = stack.slice(0, index + 1);
        if (stack[stack.length - 1] !== target) stack.push(target);
        index = stack.length - 1;
      }
      current = target;
      currentGrant = grant || '';
      home.classList.add('hidden');
      frame.classList.remove('hidden');
      loading.classList.remove('hidden');
      urlInput.value = target;
      setStatus('CONNECTING', 'warn');
      modeEl.textContent = modeLabel();
      readerBtn.classList.toggle('active', reader);
      externalBtn.disabled = false;
      urlEl.textContent = target;
      win.setTitle('浏览器 · ' + (() => { try { return new URL(target).hostname; } catch { return 'WEB'; } })(), reader ? 'READER MODE' : 'SANDBOXED');
      clearTimeout(frameLoadTimer);
      frameLoadTimer = setTimeout(() => {
        if (!loading.classList.contains('hidden')) { setStatus('TIMEOUT · 页面可能仍在加载', 'warn'); loading.classList.add('hidden'); }
      }, 26000);
      frame.src = A.proxyUrl(target, reader, currentGrant, incognito) + '&_r=' + Date.now();
      updateNav();
      soundTap();
    }
    function soundTap() { BC.sound.tap(560); }
    function navigate(input) { loadUrl(input, true); }
    function back() { if (index > 0) { index--; loadUrl(stack[index], false); } }
    function forward() { if (index < stack.length - 1) { index++; loadUrl(stack[index], false); } }
    function reload() {
      if (!current) return;
      loading.classList.remove('hidden');
      setStatus('RECONNECTING', 'warn');
      frame.src = A.proxyUrl(current, reader, currentGrant, incognito) + '&_r=' + Date.now();
    }

    async function authorizePending() {
      if (!pendingGate) return;
      const p = pendingGate;
      guardAllow.disabled = true;
      guardAllow.textContent = '授权中…';
      try {
        const r = await A.urlGrant(p.url);
        if (r.grant && !incognito) {
          let origin = r.origin;
          if (!origin) { try { origin = new URL(p.url).origin; } catch { origin = ''; } }
          if (origin) grants.set(origin, { grant: r.grant, expiresAt: r.expiresAt });
        }
        pendingGate = null;
        hideGuard();
        await loadUrl(p.url, p.push, { skipGate: true, grant: r.grant || '' });
      } catch (e) {
        BC.toast('授权失败: ' + e.message);
      } finally {
        guardAllow.disabled = false;
        guardAllow.textContent = '我已了解风险，授权进入';
      }
    }

    function cancelGate() {
      pendingGate = null;
      hideGuard();
      if (current) {
        urlInput.value = current;
        urlEl.textContent = current;
        frame.classList.remove('hidden');
        setStatus('CONNECTED', 'ok');
        modeEl.textContent = modeLabel();
      } else {
        showHome(false);
      }
    }

    $('[data-g="allow"]', body).addEventListener('click', authorizePending);
    $('[data-g="cancel"]', body).addEventListener('click', cancelGate);

    urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); navigate(urlInput.value); urlInput.blur(); } });
    homeInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); navigate(homeInput.value); } });
    $('[data-home-go]', body).addEventListener('click', () => navigate(homeInput.value));
    $$('.ql', body).forEach(b => b.addEventListener('click', () => navigate(LINKS[Number(b.dataset.link)].url, true)));
    $$('[data-b]', body).forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.b;
      if (act === 'back') back();
      else if (act === 'fwd') forward();
      else if (act === 'home') showHome(true);
      else if (act === 'reload') reload();
      else if (act === 'go') { if (current && urlInput.value.trim() === current && !reader) reload(); else navigate(urlInput.value); }
      else if (act === 'reader') { reader = !reader; readerBtn.classList.toggle('active', reader); if (current) loadUrl(current, false, { skipGate: true, grant: currentGrant }); else BC.toast('打开一个网页后启用阅读模式'); }
      else if (act === 'incognito') {
        incognito = !incognito;
        applyIncognito();
        BC.toast(incognito ? '无痕浏览已开启：不保留站点授权，关闭窗口后不留下会话' : '无痕浏览已关闭');
        if (current) reload();
      }
      else if (act === 'external') { if (current) window.open(current, '_blank', 'noopener,noreferrer'); }
    }));
    frame.addEventListener('load', () => {
      clearTimeout(frameLoadTimer);
      loading.classList.add('hidden');
      if (!guard.classList.contains('hidden')) return;
      setStatus('CONNECTED', 'ok');
    });
    frame.addEventListener('error', () => { loading.classList.add('hidden'); setStatus('FRAME ERROR', 'err'); });
    window.addEventListener('message', function onMessage(e) {
      if (e.source !== frame.contentWindow) return;
      const d = e.data;
      if (d && d.__batcave === 'nav' && typeof d.url === 'string' && /^https?:\/\//i.test(d.url)) {
        loadUrl(d.url, true);
      } else if (d && d.__batcave === 'err') {
        loading.classList.add('hidden');
        setStatus('SIGNAL LOST · 代理连接失败', 'err');
      } else if (d && d.__batcave === 'blocked') {
        loading.classList.add('hidden');
        setStatus('BLOCKED · 代理已拦截', 'err');
      }
    });
    win.onParams = (w, p) => {
      if (p && p.url) navigate(p.url);
      else if (p && p.home) showHome(true);
    };
    showHome(false);
    if (params && params.url) navigate(params.url);
    return () => {
      clearTimeout(frameLoadTimer);
      frame.src = 'about:blank';
    };
  }

  BC.registerApp({
    id: 'browser', name: '浏览器', en: 'GOTHAM NET', icon: 'browser', color: '#78b8ff',
    width: 980, height: 640, minWidth: 420, minHeight: 300, singleton: true,
    desc: '沙箱代理上网 · 阅读模式',
    mount(body, win, params) { return createBrowser(body, win, params); }
  });
})();