/* BATCAVE OS // desktop kernel, window manager, shell */
(function () {
  'use strict';
  const U = BC.util, A = BC.api, BOOT = BC.BOOT || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const ACCENTS = [
    { id: 'cyan', name: 'CYAN', color: '#5ffbf1' },
    { id: 'crimson', name: 'CRIMSON', color: '#ff4f6d' },
    { id: 'emerald', name: 'EMERALD', color: '#4dffb8' },
    { id: 'amber', name: 'AMBER', color: '#ffc64d' },
    { id: 'violet', name: 'VIOLET', color: '#a99bff' }
  ];
  const WALL_NAMES = { skyline: 'SKYLINE 03', emblem: 'SIGNAL EMBLEM', cave: 'CAVE ARRAY' };
  const wallIds = (BOOT.paths && BOOT.paths.wallpapers) || ['skyline', 'emblem', 'cave'];
  const WALLS = wallIds.map(id => ({ id, name: WALL_NAMES[id] || String(id).toUpperCase(), url: '/assets/wallpapers/' + id + '.jpg' }));

  const DEFAULTS = {
    account: 'BRUCE', accent: 'cyan', wallpaper: wallIds[0] || 'skyline',
    scanlines: true, matrix: false, sound: true, motion: true, clock12: false, init: false
  };
  let settings = Object.assign({}, DEFAULTS, BC.store.get('settings', {}));
  const APPS = new Map();
  const PINS = ['terminal', 'files', 'browser', 'forge', 'monitor', 'settings'];
  const DESK = ['terminal', 'files', 'browser', 'forge', 'office', 'mail', 'monitor', 'settings', 'geo', 'store', 'tensaint', 'reading', 'codeforge', 'podcast', 'radio', 'player', 'photos', 'vault', 'alfred'];
  const wins = new Map();
  let appSeq = 0, zTop = 20, activeId = null, cascade = 0, sessionLive = false, locked = false;

  const els = {};
  const state = { bootFinished: false, oobeChoice: null };

  /* ---------------- settings / visuals ---------------- */
  function themeColor(id) {
    const a = ACCENTS.find(x => x.id === id);
    return a ? a.color : ACCENTS[0].color;
  }
  function wallpaperUrl(id) {
    const w = WALLS.find(x => x.id === id) || WALLS[0];
    return w.url;
  }
  function applySettings() {
    const root = document.documentElement;
    root.dataset.theme = settings.accent;
    root.dataset.scanlines = settings.scanlines ? 'on' : 'off';
    root.dataset.motion = settings.motion ? 'on' : 'off';
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = '#04070b';
    if (els.wallpaperLayer) els.wallpaperLayer.style.backgroundImage = 'url("' + wallpaperUrl(settings.wallpaper) + '")';
    if (els.loginBg) els.loginBg.style.backgroundImage = 'url("' + wallpaperUrl(settings.wallpaper) + '")';
    $$('#loginName, #launcherName').forEach(el => { el.textContent = settings.account || 'BRUCE'; });
    if (els.loginHost) els.loginHost.textContent = BOOT.hostname || 'LOCAL';
    if (els.launcherBuild) els.launcherBuild.textContent = (BOOT.codename || 'SENTINEL') + ' v' + (BOOT.version || '3.1');
    updateTrayLinux();
    if (settings.matrix) startMatrix(); else stopMatrix();
  }
  function updateSettings(patch, opts) {
    const prev = settings;
    settings = Object.assign({}, settings, patch || {});
    if (!ACCENTS.some(a => a.id === settings.accent)) settings.accent = 'cyan';
    if (!WALLS.some(w => w.id === settings.wallpaper)) settings.wallpaper = WALLS[0].id;
    BC.store.set('settings', settings);
    applySettings();
    if (!opts || !opts.silent) {
      document.dispatchEvent(new CustomEvent('bc-settings-changed', { detail: settings }));
      if (prev.accent !== settings.accent) sound.tap(520);
    }
    return settings;
  }
  function setAccent(id) { return updateSettings({ accent: id }); }
  function setWallpaper(id) { return updateSettings({ wallpaper: id }); }

  /* ---------------- icons / app helpers ---------------- */
  function appIcon(app, cls) {
    return '<span class="app-ico ' + (cls || '') + '" style="--iaccent:' + (app.color || 'var(--acc)') + '">' + U.icon(app.icon || 'file') + '</span>';
  }
  function registerApp(def) {
    if (!def || !def.id) return;
    APPS.set(def.id, Object.assign({
      name: def.id, en: String(def.id).toUpperCase(), icon: 'file', color: 'var(--acc)',
      width: 760, height: 520, minWidth: 340, minHeight: 240, singleton: true, pinned: false,
      category: 'MODULE', desc: ''
    }, def));
  }

  /* ---------------- boot ---------------- */
  function bootLog(lines) {
    const log = els.bootLog;
    if (!log) return;
    const div = document.createElement('div');
    div.className = lines[2] || '';
    div.textContent = lines[0];
    log.appendChild(div);
    while (log.children.length > 7) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function startBoot() {
    const reduce = !settings.motion || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const step = reduce ? 45 : 330;
    const lines = [
      ['BOOTSTRAP // BATCAVE OS ' + (BOOT.version || '3.1') + ' · ' + (BOOT.codename || 'SENTINEL'), 'ok'],
      ['LINK // ' + (BOOT.hostname || 'LOCAL') + ' · ' + String(BOOT.platform || 'unknown').toUpperCase() + ' · ' + (BOOT.user || 'operator'), ''],
      ['TOKEN GATE // ' + (A.token ? 'ARMED · LOCAL API' : 'OFFLINE · SERVE VIA NODE'), A.token ? 'ok' : 'warn'],
      ['HOME // ' + (BOOT.home || '—'), 'dim'],
      ['SHELLS // ' + ((BOOT.bridge && BOOT.bridge.modes || []).map(m => m.label).join(' · ') || 'detecting'), ''],
      ['LINUX CORE // ' + (BOOT.bridge && BOOT.bridge.linuxAvailable ? 'ONLINE · ' + (BOOT.bridge.wsl || 'native') : 'OFFLINE · WSL2 / ISO REQUIRED'), BOOT.bridge && BOOT.bridge.linuxAvailable ? 'ok' : 'warn'],
      ['PROXY // SANDBOXED · SSRF GUARD', 'ok'],
      ['OPERATOR // ' + (settings.account || 'BRUCE') + ' · OMEGA CLEARANCE', 'ok']
    ];
    let i = 0;
    let pct = 0;
    const timer = setInterval(() => {
      if (!state.bootFinished) {
        if (i < lines.length) {
          bootLog(lines[i]);
          pct = Math.round((i + 1) / lines.length * 100);
          els.bootBar.style.width = pct + '%';
          i++;
        } else {
          pct = 100;
          els.bootBar.style.width = '100%';
          clearInterval(timer);
          setTimeout(finishBoot, reduce ? 120 : 420);
        }
      }
    }, step);
    els.bootTimer = timer;
    const skip = (e) => {
      if (state.bootFinished) return;
      if (e && e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      finishBoot();
    };
    els.bootSkip.addEventListener('click', skip);
    els.boot.addEventListener('pointerdown', e => {
      if (e.target.closest('.boot-skip')) return;
      skip();
    });
    document.addEventListener('keydown', skip, { once: true });
    state.skipBoot = skip;
    if (!A.token) {
      setTimeout(() => toast('请通过 node server.js 启动，直接打开 HTML 无法连接真实命令桥', 7000), 1600);
    }
  }
  function finishBoot() {
    if (state.bootFinished) return;
    state.bootFinished = true;
    clearInterval(els.bootTimer);
    if (state.skipBoot) {
      document.removeEventListener('keydown', state.skipBoot);
    }
    els.bootBar.style.width = '100%';
    els.boot.classList.add('fade-out');
    setTimeout(() => {
      els.boot.classList.add('hidden');
      els.boot.classList.remove('fade-out');
      checkFirstRun();
    }, 360);
    sound.startup();
  }
  function checkFirstRun() {
    if (!settings.init) showOobe();
    else showLogin(false);
  }

  /* ---------------- OOBE ---------------- */
  function renderOobeChoices() {
    const accWrap = $('#oobeAccents'), wallWrap = $('#oobeWalls');
    if (!accWrap || !wallWrap) return;
    state.oobeChoice = { accent: settings.accent, wallpaper: settings.wallpaper };
    accWrap.innerHTML = ACCENTS.map(a => '<button class="swatch ' + (a.id === state.oobeChoice.accent ? 'on' : '') + '" data-accent="' + a.id + '" style="--sw:' + a.color + '" title="' + a.name + '"></button>').join('');
    wallWrap.innerHTML = WALLS.map(w => '<button class="wall-pick ' + (w.id === state.oobeChoice.wallpaper ? 'on' : '') + '" data-wall="' + w.id + '" style="background-image:url(' + w.url + ')"><span>' + U.esc(w.name) + '</span></button>').join('');
    accWrap.onclick = e => {
      const b = e.target.closest('[data-accent]'); if (!b) return;
      state.oobeChoice.accent = b.dataset.accent;
      $$('.swatch', accWrap).forEach(x => x.classList.toggle('on', x === b));
      sound.tap(520);
    };
    wallWrap.onclick = e => {
      const b = e.target.closest('[data-wall]'); if (!b) return;
      state.oobeChoice.wallpaper = b.dataset.wall;
      $$('.wall-pick', wallWrap).forEach(x => x.classList.toggle('on', x === b));
      sound.tap(420);
    };
  }
  function showOobe() {
    renderOobeChoices();
    els.oobe.classList.remove('hidden');
    els.login.classList.add('hidden');
    setTimeout(() => { const n = $('#oobeName'); if (n) { n.focus(); n.select(); } }, 160);
  }
  function completeOobe() {
    const input = $('#oobeName');
    let name = String(input && input.value || '').trim().slice(0, 18);
    if (!name) name = 'BRUCE';
    updateSettings({
      account: name,
      accent: state.oobeChoice ? state.oobeChoice.accent : settings.accent,
      wallpaper: state.oobeChoice ? state.oobeChoice.wallpaper : settings.wallpaper,
      init: true
    }, { silent: true });
    els.oobe.classList.add('hidden');
    showLogin(false);
    notify('操作员档案已建立', '欢迎，' + name + '。所有设置均可稍后在设置中更改。', { icon: 'user', kind: 'ok' });
    setTimeout(() => sound.confirm(), 200);
  }

  /* ---------------- login / lock ---------------- */
  function showLogin(isLock) {
    locked = !!isLock;
    els.login.classList.remove('hidden');
    els.oobe.classList.add('hidden');
    els.loginName.textContent = settings.account || 'BRUCE';
    els.loginAction.textContent = locked ? '解锁会话' : '进入系统';
    els.loginHint.textContent = locked ? '会话已锁定 · 本地进程继续运行' : '无需密码 · 本机会话仅限本地访问';
    els.loginHost.textContent = BOOT.hostname || 'LOCAL';
    updateLoginClock();
    const linux = BOOT.bridge && BOOT.bridge.linuxAvailable;
    els.loginLinux.textContent = 'LINUX CORE ' + (linux ? 'ONLINE' : 'OFFLINE');
    els.loginLinux.style.color = linux ? 'var(--ok)' : 'var(--warn)';
    setTimeout(() => els.loginEnter.focus(), 120);
    if (!locked) document.body.classList.add('at-login');
    else document.body.classList.add('locked');
  }
  function enterDesktop() {
    const initial = !sessionLive;
    els.login.classList.add('hidden');
    els.desktop.classList.remove('hidden');
    document.body.classList.remove('at-login', 'locked');
    locked = false;
    sessionLive = true;
    applySettings();
    updateClock();
    if (settings.matrix) startMatrix();
    if (initial) {
      sound.unlock();
      setTimeout(() => notify((BOOT.codename || 'SENTINEL') + ' 已上线', '本地命令桥与文件系统已连接。按 ALT+SPACE 打开开始菜单。', { icon: 'bat', kind: 'ok' }), 550);
      refreshLinuxTray();
      if (wins.size === 0) {
        setTimeout(() => openApp('terminal'), 620);
      }
    } else {
      toast('会话已解锁');
      const active = wins.get(activeId);
      if (active) focusWindow(active);
    }
  }
  function lock() {
    if (!sessionLive) return;
    closeLauncher();
    closeContext();
    showLogin(true);
    sound.lock();
  }
  function logout() {
    closeAllWindows();
    sessionLive = false;
    showLogin(false);
    toast('已注销本地界面会话');
  }
  function updateLoginClock() {
    const now = clockNow();
    const p = n => String(n).padStart(2, '0');
    if (els.loginClock) els.loginClock.textContent = p(now.getHours()) + ':' + p(now.getMinutes());
    if (els.loginDate) els.loginDate.textContent = dateLong(now);
  }

  /* ---------------- clock ---------------- */
  function clockNow() {
    const d = new Date();
    const tz = settings.timeZone;
    if (!tz) return d;
    try {
      const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      });
      const map = {};
      fmt.formatToParts(d).forEach(p => { map[p.type] = p.value; });
      return new Date(+map.year, +map.month - 1, +map.day, +map.hour % 24, +map.minute, +map.second);
    } catch { return d; }
  }
  function dateLong(d) {
    const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + wd;
  }
  function dateShort(d) {
    const p = n => String(n).padStart(2, '0');
    const wd = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getDay()];
    return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + wd;
  }
  function updateClock() {
    const now = clockNow();
    const p = n => String(n).padStart(2, '0');
    let h = now.getHours();
    let suffix = '';
    if (settings.clock12) {
      suffix = h >= 12 ? ' PM' : ' AM';
      h = h % 12 || 12;
    }
    if (els.clockTime) els.clockTime.textContent = (h < 10 && settings.clock12 ? ' ' : '') + h + ':' + p(now.getMinutes()) + suffix;
    if (els.clockDate) els.clockDate.textContent = dateShort(now) + (settings.timeZone ? ' ' + (settings.timeZoneLabel || settings.timeZone.split('/').pop().replace(/_/g, ' ').slice(0, 3).toUpperCase()) : '');
    updateLoginClock();
  }
  function startClock() {
    updateClock();
    setInterval(updateClock, 1000);
  }

  /* ---------------- window manager ---------------- */
  function buildWindowFrame(app, win) {
    const el = document.createElement('section');
    el.className = 'window';
    el.dataset.app = app.id;
    el.dataset.win = win.id;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', app.name);
    el.innerHTML =
      '<header class="win-titlebar">' +
        '<div class="drag">' + appIcon(app, 'win-app-ico') +
          '<div style="min-width:0">' +
            '<div class="win-title">' + U.esc(win.title || app.name) + '</div>' +
            '<div class="win-sub">' + U.esc(win.sub || app.en || '') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="win-controls">' +
          '<button class="win-btn" data-wact="min" title="最小化" aria-label="最小化">' + U.icon('min') + '</button>' +
          '<button class="win-btn" data-wact="max" title="最大化" aria-label="最大化">' + U.icon('max') + '</button>' +
          '<button class="win-btn close" data-wact="close" title="关闭" aria-label="关闭">' + U.icon('close') + '</button>' +
        '</div>' +
      '</header>' +
      '<div class="win-body"><div class="app" style="align-items:center;justify-content:center;color:var(--dim);font-family:var(--mono);font-size:10px;gap:9px"><span class="term-spinner"></span>MOUNTING MODULE…</div></div>' +
      '<div class="win-resize" title="调整大小"></div>';
    return el;
  }

  function openApp(id, params, opts) {
    const app = APPS.get(id);
    if (!app) { toast('未知模块: ' + id); return null; }
    closeLauncher();
    if (app.singleton && !(opts && opts.forceNew)) {
      const existing = Array.from(wins.values()).find(w => w.appId === id);
      if (existing) {
        restoreWindow(existing);
        focusWindow(existing);
        const onParams = existing.onParams || app.onParams;
        if (params && onParams) {
          try { onParams(existing, params); } catch (e) { }
        }
        return existing;
      }
    }
    const layer = els.windowsLayer;
    const lw = layer.clientWidth || window.innerWidth;
    const lh = layer.clientHeight || (window.innerHeight - 58);
    let width = Math.min(app.width || 760, Math.max(340, lw - 24));
    let height = Math.min(app.height || 520, Math.max(240, lh - 24));
    if (lw < 520) { width = lw; height = lh; }
    const off = cascade % 7;
    cascade++;
    let left = Math.round((lw - width) / 2 + off * 22);
    let top = Math.round((lh - height) / 2 + off * 14);
    left = U.clamp(left, 4, Math.max(4, lw - width - 4));
    top = U.clamp(top, 4, Math.max(4, lh - height - 4));

    const win = {
      id: 'win' + (++appSeq),
      appId: id, app, title: app.name, sub: app.en,
      el: null, params: params || {}, cleanup: null,
      minimized: false, maximized: false, prevRect: null,
      setTitle(title, sub) {
        this.title = title || app.name;
        const t = this.el.querySelector('.win-title');
        if (t) t.textContent = this.title;
        if (sub !== undefined) this.setSub(sub);
        renderTaskbar();
      },
      setSub(sub) {
        this.sub = sub || '';
        const s = this.el.querySelector('.win-sub');
        if (s) s.textContent = this.sub;
      },
      close() { closeWindow(this); },
      focus() { focusWindow(this); }
    };
    win.el = buildWindowFrame(app, win);
    win.el.style.cssText = 'left:' + left + 'px;top:' + top + 'px;width:' + width + 'px;height:' + height + 'px';
    els.windowsLayer.appendChild(win.el);
    wins.set(win.id, win);

    win.el.addEventListener('pointerdown', () => focusWindow(win), true);
    win.el.querySelector('.win-controls').addEventListener('click', e => {
      const b = e.target.closest('[data-wact]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.wact === 'close') closeWindow(win);
      else if (b.dataset.wact === 'min') minimizeWindow(win);
      else if (b.dataset.wact === 'max') toggleMax(win);
    });
    win.el.querySelector('.drag').addEventListener('pointerdown', e => beginDrag(e, win));
    win.el.querySelector('.drag').addEventListener('dblclick', () => toggleMax(win));
    win.el.querySelector('.win-resize').addEventListener('pointerdown', e => beginResize(e, win));
    win.el.querySelector('.win-titlebar').addEventListener('contextmenu', e => {
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [
        { label: win.minimized ? '恢复窗口' : '最小化', icon: 'min', action: () => win.minimized ? restoreWindow(win) : minimizeWindow(win) },
        { label: win.maximized ? '还原大小' : '最大化', icon: win.maximized ? 'restore' : 'max', action: () => toggleMax(win) },
        { sep: true },
        { label: '关闭窗口', icon: 'close', danger: true, action: () => closeWindow(win) }
      ]);
    });

    focusWindow(win);
    mountApp(win);
    renderTaskbar();
    sound.open();
    return win;
  }

  function mountApp(win) {
    const body = win.el.querySelector('.win-body');
    body.innerHTML = '';
    try {
      const ret = win.app.mount ? win.app.mount(body, win, win.params || {}) : null;
      if (typeof ret === 'function') win.cleanup = ret;
      else if (ret && typeof ret.then === 'function') {
        ret.then(fn => { if (typeof fn === 'function') win.cleanup = fn; }).catch(err => renderAppError(body, err));
      }
    } catch (err) {
      renderAppError(body, err);
    }
  }
  function renderAppError(body, err) {
    body.innerHTML = '<div class="empty-state"><svg class="ic"><use href="#i-alert"></use></svg><b>模块启动失败</b><p>' + U.esc(err && err.message || String(err)) + '</p></div>';
  }
  function focusWindow(win) {
    if (!win || !wins.has(win.id)) return;
    if (win.minimized) restoreWindow(win, true);
    if (activeId === win.id) { win.el.style.zIndex = String(++zTop); renderTaskbar(); return; }
    activeId = win.id;
    win.el.style.zIndex = String(++zTop);
    wins.forEach(w => w.el.classList.toggle('active', w.id === activeId));
    renderTaskbar();
  }
  function minimizeWindow(win) {
    if (!win) return;
    win.minimized = true;
    win.el.classList.add('minimized');
    win.el.classList.remove('active');
    if (activeId === win.id) {
      activeId = null;
      const next = Array.from(wins.values()).filter(w => !w.minimized).sort((a, b) => Number(b.el.style.zIndex || 0) - Number(a.el.style.zIndex || 0))[0];
      if (next) focusWindow(next);
    }
    renderTaskbar();
    sound.minimize();
  }
  function restoreWindow(win, silent) {
    if (!win) return;
    win.minimized = false;
    win.el.classList.remove('minimized');
    if (!silent) focusWindow(win);
  }
  function toggleMax(win) {
    const btn = win.el.querySelector('[data-wact="max"]');
    if (!win.maximized) {
      const r = win.el.getBoundingClientRect();
      win.prevRect = { left: r.left, top: r.top, width: r.width, height: r.height };
      win.el.classList.add('maximized');
      win.maximized = true;
      if (btn) { btn.innerHTML = U.icon('restore'); btn.title = '还原'; }
      win.el.style.removeProperty('width'); win.el.style.removeProperty('height');
    } else {
      win.el.classList.remove('maximized');
      win.maximized = false;
      if (win.prevRect) {
        win.el.style.left = win.prevRect.left + 'px';
        win.el.style.top = win.prevRect.top + 'px';
        win.el.style.width = win.prevRect.width + 'px';
        win.el.style.height = win.prevRect.height + 'px';
      }
      if (btn) { btn.innerHTML = U.icon('max'); btn.title = '最大化'; }
    }
    if (win.app.onResize) { try { win.app.onResize(win); } catch (e) { } }
    sound.tap(560);
  }
  function closeWindow(win) {
    if (!win) return;
    try { if (typeof win.cleanup === 'function') win.cleanup(); } catch (e) { }
    if (win.app.unmount) { try { win.app.unmount(win); } catch (e) { } }
    win.el.style.transition = 'opacity .12s,transform .12s';
    win.el.style.opacity = '0';
    win.el.style.transform = 'scale(.985)';
    setTimeout(() => win.el.remove(), 120);
    wins.delete(win.id);
    if (activeId === win.id) {
      activeId = null;
      const next = Array.from(wins.values()).filter(w => !w.minimized).sort((a, b) => Number(b.el.style.zIndex || 0) - Number(a.el.style.zIndex || 0))[0];
      if (next) focusWindow(next);
    }
    renderTaskbar();
    sound.close();
  }
  function closeAllWindows() {
    Array.from(wins.values()).forEach(w => closeWindow(w));
    activeId = null;
  }
  function beginDrag(e, win) {
    if (e.button !== 0 || win.maximized) return;
    if (e.target.closest('.win-controls')) return;
    const rect = win.el.getBoundingClientRect();
    const layer = els.windowsLayer.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, left: rect.left - layer.left, top: rect.top - layer.top };
    let moved = false;
    const onMove = ev => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) < 2) return;
      moved = true;
      win.el.classList.add('dragging');
      const maxLeft = layer.width - Math.min(110, rect.width * .4);
      const maxTop = layer.height - 40;
      win.el.style.left = U.clamp(start.left + dx, -rect.width + 110, maxLeft) + 'px';
      win.el.style.top = U.clamp(start.top + dy, 0, maxTop) + 'px';
    };
    const onUp = () => {
      win.el.classList.remove('dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (moved && win.app.onMove) { try { win.app.onMove(win); } catch (e) { } }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    e.preventDefault();
  }
  function beginResize(e, win) {
    if (e.button !== 0 || win.maximized) return;
    const rect = win.el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
    const minW = win.app.minWidth || 340, minH = win.app.minHeight || 240;
    const layer = els.windowsLayer.getBoundingClientRect();
    const onMove = ev => {
      const nw = U.clamp(start.width + ev.clientX - start.x, minW, layer.width - rect.left + layer.left);
      const nh = U.clamp(start.height + ev.clientY - start.y, minH, layer.height - rect.top + layer.top);
      win.el.style.width = nw + 'px';
      win.el.style.height = nh + 'px';
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (win.app.onResize) { try { win.app.onResize(win); } catch (err) { } }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    e.preventDefault();
    e.stopPropagation();
  }

  /* ---------------- taskbar ---------------- */
  function renderPinned() {
    const wrap = els.pinnedApps;
    wrap.innerHTML = '';
    PINS.forEach(id => {
      const app = APPS.get(id);
      if (!app) return;
      const b = document.createElement('button');
      b.className = 'tb-app pinned';
      b.dataset.app = id;
      b.title = app.name;
      b.innerHTML = appIcon(app) + '<span class="tb-label">' + U.esc(app.name) + '</span>';
      b.addEventListener('click', () => {
        const list = Array.from(wins.values()).filter(w => w.appId === id);
        if (list.length) {
          const w = list.find(x => !x.minimized && activeId === x.id) || list.find(x => !x.minimized) || list[0];
          if (!w.minimized && activeId === w.id) minimizeWindow(w);
          else { restoreWindow(w); focusWindow(w); }
        } else openApp(id);
        sound.tap(480);
      });
      wrap.appendChild(b);
    });
  }
  function renderTaskbar() {
    if (!els.pinnedApps) return;
    $$('.tb-app.pinned', els.pinnedApps).forEach(b => {
      const has = Array.from(wins.values()).some(w => w.appId === b.dataset.app);
      b.classList.toggle('running', has);
      const active = Array.from(wins.values()).some(w => w.appId === b.dataset.app && w.id === activeId);
      b.classList.toggle('active', active);
    });
    const run = $('#runningApps');
    if (!run) return;
    run.innerHTML = '';
    Array.from(wins.values()).forEach(w => {
      const isPinned = PINS.includes(w.appId);
      if (isPinned && Array.from(wins.values()).filter(x => x.appId === w.appId).length === 1) return;
      const b = document.createElement('button');
      b.className = 'tb-app running' + (w.id === activeId ? ' active' : '') + (w.minimized ? ' minimized' : '');
      b.title = w.title;
      b.innerHTML = appIcon(w.app) + '<span class="tb-label">' + U.esc(w.title) + '</span>';
      b.addEventListener('click', () => {
        if (w.minimized) { restoreWindow(w); focusWindow(w); }
        else if (activeId === w.id) minimizeWindow(w);
        else focusWindow(w);
      });
      b.addEventListener('contextmenu', e => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: '关闭窗口', icon: 'close', danger: true, action: () => closeWindow(w) }
        ]);
      });
      run.appendChild(b);
    });
  }

  /* ---------------- launcher ---------------- */
  let launcherOpen = false, launcherIndex = -1, fileSearchToken = 0;
  function buildLauncher() {
    const quick = $('#launcherPinned');
    if (quick) {
      quick.innerHTML = '';
      PINS.slice(0, 6).forEach(id => {
        const app = APPS.get(id); if (!app) return;
        const b = document.createElement('button');
        b.className = 'quick-app';
        b.innerHTML = appIcon(app) + '<b>' + U.esc(app.name) + '</b>';
        b.addEventListener('click', () => { closeLauncher(); openApp(id); });
        quick.appendChild(b);
      });
    }
    renderLauncher('');
    const input = $('#launcherSearch');
    input.addEventListener('input', U.debounce(() => { launcherIndex = -1; renderLauncher(input.value); }, 120));
    input.addEventListener('keydown', onLauncherKey);
    $('#launcher').addEventListener('pointerdown', e => e.stopPropagation());
    $$('#launcher [data-power]').forEach(b => b.addEventListener('click', () => {
      const p = b.dataset.power;
      closeLauncher();
      if (p === 'lock') lock();
      else if (p === 'restart') restartSystem();
      else if (p === 'shutdown') shutdownSystem();
    }));
  }
  function renderLauncher(query, extraFiles) {
    const grid = $('#launcherGrid');
    if (!grid) return;
    const q = String(query || '').trim().toLowerCase();
    let apps = Array.from(APPS.values()).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
    if (q) {
      apps = apps.filter(a => [a.name, a.en, a.desc, a.category, a.id].join(' ').toLowerCase().includes(q));
    }
    grid.innerHTML = '';
    apps.forEach(app => {
      const b = document.createElement('button');
      b.className = 'app-tile';
      b.dataset.app = app.id;
      b.innerHTML = appIcon(app) + '<div><b>' + U.esc(app.name) + '</b><span>' + U.esc(app.en || app.id) + '</span></div>';
      b.addEventListener('click', () => { closeLauncher(); openApp(app.id); });
      grid.appendChild(b);
    });
    if (extraFiles && extraFiles.length) {
      extraFiles.forEach(f => {
        const info = U.fileKind(f);
        const fakeApp = { color: info.color, icon: info.icon };
        const b = document.createElement('button');
        b.className = 'app-tile';
        b.innerHTML = appIcon(fakeApp) + '<div><b>' + U.esc(f.name) + '</b><span>FILE · ' + U.esc(f.path) + '</span></div>';
        b.addEventListener('click', () => { closeLauncher(); openFile(f.path); });
        grid.appendChild(b);
      });
    }
    if (!grid.children.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;height:auto;padding:28px"><svg class="ic"><use href="#i-search"></use></svg><b>没有匹配的模块</b><p>' + (q.startsWith('>') ? '按 ENTER 在终端执行该命令' : '尝试搜索 terminal、文件、或输入 > 命令') + '</p></div>';
    }
    launcherIndex = grid.children.length ? 0 : -1;
    markLauncherSel();
    if (q) searchFilesRoot(q);
  }
  let fileSearchTimer = null;
  function searchFilesRoot(q) {
    const token = ++fileSearchToken;
    clearTimeout(fileSearchTimer);
    fileSearchTimer = setTimeout(async () => {
      if (!A.online) return;
      try {
        const res = await A.fsList('/');
        if (token !== fileSearchToken) return;
        const files = (res.entries || []).filter(e => String(e.name || '').toLowerCase().includes(q) && e.type !== 'dir').slice(0, 8);
        const grid = $('#launcherGrid');
        if (!grid) return;
        // remove previous file results
        $$('.app-tile[data-file-result]', grid).forEach(x => x.remove());
        files.forEach(f => {
          const info = U.fileKind(f);
          const b = document.createElement('button');
          b.className = 'app-tile';
          b.dataset.fileResult = '1';
          b.innerHTML = appIcon({ color: info.color, icon: info.icon }) + '<div><b>' + U.esc(f.name) + '</b><span>FILE · ' + U.esc(f.path) + '</span></div>';
          b.addEventListener('click', () => { closeLauncher(); openFile(f.path); });
          grid.appendChild(b);
        });
      } catch (e) { }
    }, 260);
  }
  function markLauncherSel() {
    const tiles = $$('#launcherGrid .app-tile');
    tiles.forEach((t, i) => t.classList.toggle('sel', i === launcherIndex));
    if (tiles[launcherIndex]) tiles[launcherIndex].scrollIntoView({ block: 'nearest' });
  }
  function onLauncherKey(e) {
    const tiles = $$('#launcherGrid .app-tile');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!tiles.length) return;
      launcherIndex = (launcherIndex + 1) % tiles.length; markLauncherSel();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!tiles.length) return;
      launcherIndex = (launcherIndex - 1 + tiles.length) % tiles.length; markLauncherSel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const raw = e.target.value.trim();
      if (tiles[launcherIndex]) { tiles[launcherIndex].click(); return; }
      if (raw.startsWith('>')) {
        closeLauncher();
        runInTerminal(raw.slice(1).trim());
      }
    } else if (e.key === 'Escape') {
      e.preventDefault(); closeLauncher();
    }
  }
  function openLauncher() {
    if (!sessionLive) return;
    launcherOpen = true;
    els.launcher.classList.remove('hidden');
    els.startBtn.setAttribute('aria-expanded', 'true');
    const input = $('#launcherSearch');
    input.value = '';
    renderLauncher('');
    setTimeout(() => input.focus(), 60);
    sound.tap(620);
  }
  function closeLauncher() {
    if (!launcherOpen) return;
    launcherOpen = false;
    els.launcher.classList.add('hidden');
    els.startBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleLauncher() { launcherOpen ? closeLauncher() : openLauncher(); }

  /* ---------------- notifications / toasts ---------------- */
  function notify(title, message, opts) {
    opts = opts || {};
    if (!els.notificationStack) return;
    while (els.notificationStack.children.length >= 4) els.notificationStack.firstChild.remove();
    const item = document.createElement('div');
    item.className = 'notice ' + (opts.kind || '');
    const fakeApp = { icon: opts.icon || 'info', color: opts.kind === 'err' ? 'var(--danger)' : opts.kind === 'warn' ? 'var(--warn)' : opts.kind === 'ok' ? 'var(--ok)' : 'var(--acc)' };
    item.innerHTML = appIcon(fakeApp) + '<div><b>' + U.esc(title) + '</b><p>' + U.esc(message || '') + '</p></div><button class="close" aria-label="关闭">' + U.icon('close') + '</button>';
    const close = () => { item.classList.add('out'); setTimeout(() => item.remove(), 190); };
    item.querySelector('.close').addEventListener('click', close);
    els.notificationStack.appendChild(item);
    const ttl = opts.ttl || (opts.kind === 'err' ? 9000 : 5200);
    const timer = setTimeout(close, ttl);
    item.addEventListener('pointerenter', () => clearTimeout(timer), { once: true });
    if (opts.kind === 'ok') sound.confirm(0.5); else if (opts.kind === 'err') sound.error();
    return item;
  }
  function toast(text, ttl) {
    if (!els.toastRoot) return;
    let kind = '', ms = 2600;
    if (ttl && typeof ttl === 'object') { kind = ttl.kind || ''; ms = Number(ttl.ttl || ttl.duration) || 3600; }
    else if (typeof ttl === 'number') ms = ttl;
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = text;
    els.toastRoot.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .2s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 220); }, ms);
  }

  /* ---------------- dialogs ---------------- */
  function dialog(opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'modal-backdrop';
      const danger = !!opts.danger;
      back.innerHTML =
        '<div class="modal ' + (danger ? 'danger' : '') + '" role="dialog" aria-modal="true">' +
          '<div class="modal-head">' +
            '<span class="app-ico" style="--iaccent:' + (danger ? 'var(--danger)' : 'var(--acc)') + '">' + U.icon(opts.icon || (danger ? 'alert' : 'info')) + '</span>' +
            '<h3>' + U.esc(opts.title || '确认操作') + '</h3>' +
          '</div>' +
          '<div class="modal-body">' + (opts.body || '') +
            (opts.input ? '<input class="input" id="modalInput" value="' + U.esc(opts.value || '') + '" placeholder="' + U.esc(opts.placeholder || '') + '" ' + (opts.password ? 'type="password"' : '') + '>' : '') +
          '</div>' +
          '<div class="modal-actions">' +
            (opts.cancelText === null ? '' : '<button class="btn" data-m="cancel">' + U.esc(opts.cancelText || '取消') + '</button>') +
            '<button class="btn ' + (danger ? 'danger' : 'primary') + '" data-m="ok">' + U.esc(opts.okText || '确认') + '</button>' +
          '</div>' +
        '</div>';
      els.modalRoot.appendChild(back);
      const input = back.querySelector('#modalInput');
      const close = val => {
        back.remove();
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const submit = () => close(opts.input ? (input ? input.value : '') : true);
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); close(opts.input ? null : false); }
        else if (e.key === 'Enter' && !opts.multiline) { e.preventDefault(); submit(); }
      };
      document.addEventListener('keydown', onKey);
      back.querySelector('[data-m="ok"]').addEventListener('click', submit);
      const cancel = back.querySelector('[data-m="cancel"]');
      if (cancel) cancel.addEventListener('click', () => close(opts.input ? null : false));
      back.addEventListener('pointerdown', e => { if (e.target === back) close(opts.input ? null : false); });
      setTimeout(() => { (input || back.querySelector('[data-m="ok"]')).focus(); if (input) input.select(); }, 70);
      sound.tap(420);
    });
  }
  const confirmDialog = (title, body, opts) => dialog(Object.assign({ title, body, icon: 'alert', danger: true, okText: '继续' }, opts || {}));
  const promptDialog = (title, body, opts) => dialog(Object.assign({ title, body, input: true, okText: '确定' }, opts || {}));

  function contextMenu(x, y, items) {
    closeContext();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    items.forEach(it => {
      if (it.sep) {
        const sep = document.createElement('div'); sep.className = 'ctx-sep'; menu.appendChild(sep); return;
      }
      const b = document.createElement('button');
      b.className = it.danger ? 'danger' : '';
      b.innerHTML = (it.icon ? U.icon(it.icon) : '') + '<span>' + U.esc(it.label) + '</span>';
      if (it.disabled) { b.disabled = true; b.style.opacity = '.35'; }
      b.addEventListener('click', () => { closeContext(); if (it.action) it.action(); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
    els.ctx = menu;
    setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
    function onDoc(e) {
      if (!menu.contains(e.target)) closeContext();
    }
    menu.__onDoc = onDoc;
  }
  function closeContext() {
    if (els.ctx) {
      document.removeEventListener('pointerdown', els.ctx.__onDoc, true);
      els.ctx.remove(); els.ctx = null;
    }
  }

  /* ---------------- actions / file opening ---------------- */
  function openFile(path) {
    if (!path) return;
    if (U.isImageExt(path)) return openApp('photos', { path });
    if (U.isAudioExt(path) || U.isVideoExt(path)) return openApp('player', { path });
    if (U.isTextExt(path)) return openApp('editor', { path });
    return openApp('files', { path: U.dirName(path) });
  }
  function handleOpen(target) {
    const t = String(target || '').trim();
    if (!t) return;
    if (/^https?:\/\//i.test(t)) { openApp('browser', { url: t }); return; }
    if (APPS.has(t)) { openApp(t); return; }
    if (t === '.' || t === '~') { openApp('files', { path: '/' }); return; }
    if (t.startsWith('/')) { openFile(t); return; }
    const lower = t.toLowerCase();
    const alias = { apps: 'vault', vault: 'vault', terminal: 'terminal', files: 'files', browser: 'browser', settings: 'settings', monitor: 'monitor', forge: 'forge', breach: 'breach', alfred: 'alfred', 'chat-ai': 'alfred', chat: 'alfred', ai: 'alfred', music: 'music', notes: 'notes', weather: 'weather', gallery: 'gallery', photos: 'photos', photo: 'photos', viewer: 'photos', player: 'player', media: 'player', video: 'player', videos: 'player', map: 'map', security: 'security', editor: 'editor', calc: 'calc', calculator: 'calc', calendar: 'calendar', taskmgr: 'taskmgr', tasks: 'taskmgr' };
    if (alias[lower]) { openApp(alias[lower]); return; }
    if (/\.[a-z0-9]+$/i.test(t)) { openFile('/' + t.replace(/^\.?\//, '')); return; }
    toast('无法打开: ' + t);
  }
  function handleAction(action) {
    if (!action || !action.type) return;
    switch (action.type) {
      case 'theme': setAccent(action.value); toast('界面色相: ' + action.value); break;
      case 'wallpaper': setWallpaper(action.value); toast('壁纸: ' + action.value); break;
      case 'openApp': openApp(action.app); break;
      case 'open': handleOpen(action.target); break;
      case 'fx': updateSettings({ matrix: action.value !== 'off' }); toast('数字雨: ' + (settings.matrix ? 'ON' : 'OFF')); break;
      case 'lock': lock(); break;
      case 'reboot': restartSystem(); break;
      case 'poweroff': shutdownSystem(); break;
      case 'exit': logout(); break;
      default: break;
    }
  }
  function runInTerminal(cmd, mode) {
    openApp('terminal');
    setTimeout(() => {
      if (BC.runTerminalCommand) BC.runTerminalCommand(cmd, mode);
    }, 260);
  }

  /* ---------------- sound ---------------- */
  const sound = (function () {
    let ctx = null, last = 0;
    function ensure() {
      if (!settings.sound) return null;
      if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, dur, type, vol) {
      if (!settings.sound) return;
      const c = ensure(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      const t = c.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.018, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.05));
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + (dur || 0.05) + 0.02);
    }
    function seq(notes, gap) {
      if (!settings.sound) return;
      notes.forEach((n, i) => setTimeout(() => tone(n[0], n[1], 'triangle', n[2] || 0.02), i * (gap || 90)));
    }
    return {
      ensure,
      tap(f) { const now = Date.now(); if (now - last < 45) return; last = now; tone(f || 620, .03, 'triangle', .012); },
      open() { seq([[440, .05, .015], [620, .07, .018]], 55); },
      close() { seq([[440, .05, .012], [320, .05, .01]], 45); },
      minimize() { tone(300, .04, 'sine', .012); },
      startup() { seq([[110, .22, .025], [165, .18, .02], [220, .25, .018], [330, .35, .015]], 130); },
      unlock() { seq([[330, .08, .018], [440, .08, .018], [660, .16, .015]], 90); },
      lock() { seq([[440, .07, .015], [300, .12, .012]], 80); },
      confirm(v) { tone(760, .06, 'sine', .012 * (v || 1)); },
      error() { seq([[220, .1, .014], [160, .16, .012]], 100); }
    };
  })();

  /* ---------------- matrix ---------------- */
  let matrixTimer = null, matrixCtx = null, matrixCols = [], matrixFont = 16;
  function matrixColor() {
    const rgb = getComputedStyle(document.documentElement).getPropertyValue('--acc-rgb').trim();
    return rgb ? 'rgba(' + rgb + ',0.8)' : 'rgba(95,251,241,.8)';
  }
  function startMatrix() {
    const canvas = els.matrixCanvas;
    if (!canvas || matrixTimer) return;
    canvas.classList.add('on');
    matrixCtx = canvas.getContext('2d');
    resizeMatrix();
    matrixTimer = setInterval(drawMatrix, 66);
    window.addEventListener('resize', resizeMatrix);
  }
  function resizeMatrix() {
    const canvas = els.matrixCanvas;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    matrixCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    matrixFont = 15;
    const count = Math.ceil(innerWidth / matrixFont);
    matrixCols = Array.from({ length: count }, () => Math.random() * -60);
  }
  function drawMatrix() {
    const c = matrixCtx;
    if (!c) return;
    c.fillStyle = 'rgba(3,7,10,.12)';
    c.fillRect(0, 0, innerWidth, innerHeight);
    c.font = matrixFont + 'px "Cascadia Mono",Consolas,monospace';
    c.fillStyle = matrixColor();
    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロ0123456789';
    matrixCols.forEach((y, i) => {
      const ch = chars[Math.floor(Math.random() * chars.length)];
      c.fillText(ch, i * matrixFont, y * matrixFont);
      if (y * matrixFont > innerHeight && Math.random() > .976) matrixCols[i] = 0;
      else matrixCols[i] = y + 1;
    });
  }
  function stopMatrix() {
    if (matrixTimer) clearInterval(matrixTimer);
    matrixTimer = null;
    if (els.matrixCanvas) {
      els.matrixCanvas.classList.remove('on');
      try { matrixCtx.clearRect(0, 0, innerWidth, innerHeight); } catch (e) { }
    }
    window.removeEventListener('resize', resizeMatrix);
  }

  /* ---------------- power ---------------- */
  function restartSystem() {
    const screen = els.powerScreen;
    $('#powerTitle').textContent = 'SYSTEM REBOOT';
    $('#powerMsg').textContent = '正在重新初始化界面与本地连接…';
    $('#powerResume').classList.add('hidden');
    screen.classList.remove('hidden');
    sound.lock();
    setTimeout(() => location.reload(), 1200);
  }
  function shutdownSystem() {
    closeAllWindows();
    $('#powerTitle').textContent = 'SYSTEM OFFLINE';
    $('#powerMsg').textContent = '界面已关闭。本地服务仍在运行，关闭该浏览器标签页即可完全停止。';
    $('#powerResume').classList.remove('hidden');
    els.powerScreen.classList.remove('hidden');
    sound.lock();
  }

  /* ---------------- desktop ---------------- */
  function buildDesktopIcons() {
    const wrap = els.desktopIcons;
    if (!wrap) return;
    wrap.innerHTML = '';
    DESK.forEach(id => {
      const app = APPS.get(id); if (!app) return;
      const b = document.createElement('button');
      b.className = 'desk-icon';
      b.dataset.app = id;
      b.innerHTML = appIcon(app) + '<span>' + U.esc(app.name) + '</span>';
      b.addEventListener('click', () => {
        $$('.desk-icon').forEach(x => x.classList.toggle('selected', x === b));
        openApp(id);
      });
      b.addEventListener('contextmenu', e => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [{ label: '打开 ' + app.name, icon: 'right', action: () => openApp(id) }]);
      });
      wrap.appendChild(b);
    });
  }
  function desktopContext(e) {
    if (e.target.closest('.window, .taskbar, .launcher, #notificationStack')) return;
    e.preventDefault();
    contextMenu(e.clientX, e.clientY, [
      { label: '新建终端', icon: 'terminal', action: () => openApp('terminal') },
      { label: '打开文件', icon: 'files', action: () => openApp('files') },
      { label: '打开浏览器', icon: 'browser', action: () => openApp('browser') },
      { sep: true },
      { label: '切换壁纸', icon: 'gallery', action: () => cycleWallpaper() },
      { label: '显示设置', icon: 'settings', action: () => openApp('settings') },
      { sep: true },
      { label: '锁定会话', icon: 'lock', action: () => lock() }
    ]);
  }
  function cycleWallpaper() {
    const idx = WALLS.findIndex(w => w.id === settings.wallpaper);
    setWallpaper(WALLS[(idx + 1) % WALLS.length].id);
    toast('壁纸: ' + WALLS[(idx + 1) % WALLS.length].name);
  }

  /* ---------------- tray ---------------- */
  async function refreshLinuxTray() {
    try {
      const st = await A.linuxStatus();
      const el = els.trayLinux;
      if (!el) return;
      el.classList.toggle('ok', !!st.available);
      el.classList.toggle('off', !st.available);
      el.title = st.available ? 'Linux Core 在线 · ' + (st.distro || st.engine) : 'Linux Core 离线 · 需要 WSL2 或 ISO';
      el.querySelector('span').textContent = st.available ? 'LINUX' : 'NO LINUX';
    } catch (e) { }
  }
  function updateTrayLinux() {
    const el = els.trayLinux;
    if (!el) return;
    const online = !!(BOOT.bridge && BOOT.bridge.linuxAvailable);
    el.classList.toggle('ok', online);
    el.classList.toggle('off', !online);
  }
  async function showNetworkInfo() {
    try {
      const s = await A.stats();
      const ifs = (s.ifaces || []).map(i => i.name + ' · ' + i.address).join('\n') || '未检测到外部接口';
      notify('网络接口', ifs, { icon: 'wifi', ttl: 8000 });
    } catch (e) { notify('无法读取网络状态', e.message, { icon: 'alert', kind: 'err' }); }
  }

  /* ---------------- cursor ---------------- */
  function initCursor() {
    const aura = els.cursorAura;
    if (!aura) return;
    let raf = 0, px = 0, py = 0;
    document.addEventListener('pointermove', e => {
      px = e.clientX; py = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => { aura.style.transform = 'translate(' + (px - 110) + 'px,' + (py - 110) + 'px)'; raf = 0; });
    });
    document.addEventListener('pointerleave', () => { aura.style.opacity = '0'; });
    document.addEventListener('pointerenter', () => { aura.style.opacity = '.85'; });
  }

  /* ---------------- keyboard ---------------- */
  function bindKeys() {
    document.addEventListener('keydown', e => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName || '');
      if (e.key === 'Escape') {
        if (els.launcher && !els.launcher.classList.contains('hidden')) { closeLauncher(); }
        closeContext();
      }
      if (e.altKey && e.code === 'Space') { e.preventDefault(); if (sessionLive && !locked) toggleLauncher(); return; }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyE') { e.preventDefault(); if (sessionLive && !locked) toggleLauncher(); return; }
      if (e.ctrlKey && e.altKey && e.code === 'KeyT') { e.preventDefault(); if (sessionLive && !locked) openApp('terminal'); return; }
      if (e.ctrlKey && e.altKey && e.code === 'KeyF') { e.preventDefault(); if (sessionLive && !locked) openApp('files'); return; }
      if (e.ctrlKey && e.altKey && e.code === 'KeyB') { e.preventDefault(); if (sessionLive && !locked) openApp('browser'); return; }
      if (e.ctrlKey && e.altKey && e.code === 'KeyL') { e.preventDefault(); if (sessionLive && !locked) lock(); return; }
      if (e.key === 'Enter' && els.login && !els.login.classList.contains('hidden') && !typing) {
        e.preventDefault(); enterDesktop();
      }
    });
  }

  /* ---------------- init ---------------- */
  function bindStatic() {
    els.desktop.addEventListener('contextmenu', desktopContext);
    els.startBtn.addEventListener('click', e => { e.stopPropagation(); toggleLauncher(); });
    document.addEventListener('pointerdown', e => {
      if (launcherOpen && !e.target.closest('#launcher') && !e.target.closest('#startBtn')) closeLauncher();
    });
    els.loginEnter.addEventListener('click', enterDesktop);
    $('#oobeStart').addEventListener('click', completeOobe);
    $('#oobeName').addEventListener('keydown', e => { if (e.key === 'Enter') completeOobe(); });
    $('#trayLock').addEventListener('click', lock);
    $('#trayVolume').addEventListener('click', () => { updateSettings({ sound: !settings.sound }); toast('系统音效: ' + (settings.sound ? 'ON' : 'OFF')); });
    $('#trayNet').addEventListener('click', showNetworkInfo);
    $('#trayLinux').addEventListener('click', () => {
      if (settings.matrix) { }
      runInTerminal('linux-core');
    });
    $('#clockBtn').addEventListener('click', () => openApp('calendar'));
    $('#powerResume').addEventListener('click', () => location.reload());
    document.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b && !b.closest('.win-btn') && !b.closest('.calc-key')) sound.tap(640);
    });
    window.addEventListener('resize', U.debounce(() => {
      const layer = els.windowsLayer;
      if (!layer) return;
      const lw = layer.clientWidth, lh = layer.clientHeight;
      wins.forEach(w => {
        if (w.maximized) return;
        const r = w.el.getBoundingClientRect();
        if (r.left > lw - 80) w.el.style.left = Math.max(4, lw - 120) + 'px';
        if (r.top > lh - 40) w.el.style.top = Math.max(4, lh - 60) + 'px';
      });
    }, 150));
  }

  function start() {
    els.boot = $('#boot');
    els.bootBar = $('#bootBar');
    els.bootLog = $('#bootLog');
    els.bootSkip = $('#bootSkip');
    els.oobe = $('#oobe');
    els.login = $('#login');
    els.loginBg = $('.login-bg');
    els.loginClock = $('#loginClock');
    els.loginDate = $('#loginDate');
    els.loginName = $('#loginName');
    els.loginAction = $('#loginAction');
    els.loginHint = $('#loginHint');
    els.loginHost = $('#loginHost');
    els.loginLinux = $('#loginLinux');
    els.loginEnter = $('#loginEnter');
    els.desktop = $('#desktop');
    els.wallpaperLayer = $('#wallpaperLayer');
    els.desktopIcons = $('#desktopIcons');
    els.windowsLayer = $('#windowsLayer');
    els.notificationStack = $('#notificationStack');
    els.taskbar = $('#taskbar');
    els.pinnedApps = $('#pinnedApps');
    els.startBtn = $('#startBtn');
    els.launcher = $('#launcher');
    els.modalRoot = $('#modalRoot');
    els.toastRoot = $('#toastRoot');
    els.powerScreen = $('#powerScreen');
    els.cursorAura = $('#cursorAura');
    els.matrixCanvas = $('#matrixCanvas');
    els.trayLinux = $('#trayLinux');
    els.clockTime = $('#clockTime');
    els.clockDate = $('#clockDate');
    els.launcherBuild = $('#launcherBuild');

    applySettings();
    bindStatic();
    bindKeys();
    initCursor();
    renderPinned();
    buildLauncher();
    buildDesktopIcons();
    startClock();
    startBoot();
  }

  /* ---------------- public API ---------------- */
  BC.registerApp = registerApp;
  BC.openApp = openApp;
  BC.closeWindow = id => { const w = typeof id === 'string' ? wins.get(id) : id; if (w) closeWindow(w); };
  BC.focusWindow = focusWindow;
  BC.getWindows = () => Array.from(wins.values());
  BC.getActiveWindow = () => wins.get(activeId) || null;
  BC.apps = APPS;
  BC.appIcon = appIcon;
  BC.accents = ACCENTS;
  BC.wallpapers = WALLS;
  BC.settings = () => Object.assign({}, settings);
  BC.updateSettings = updateSettings;
  BC.setAccent = setAccent;
  BC.setWallpaper = setWallpaper;
  BC.openFile = openFile;
  BC.handleOpen = handleOpen;
  BC.actions = { handle: handleAction };
  BC.runInTerminal = runInTerminal;
  BC.notify = notify;
  BC.toast = toast;
  BC.ui = {
    notify, toast, dialog, confirm: confirmDialog, prompt: promptDialog, contextMenu,
    appIcon, icon: U.icon, esc: U.esc, fmtBytes: U.fmtBytes, fmtDate: U.fmtDate,
    fileKind: U.fileKind, copy: U.copy, download: U.download
  };
  BC.sound = sound;
  BC.lock = lock;
  BC.logout = logout;
  BC.start = start;
  BC.isLocked = () => locked;
  BC.isLive = () => sessionLive;
})();