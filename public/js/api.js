/* BATCAVE OS // API + shared utilities */
(function () {
  'use strict';
  const BOOT = window.__BC_BOOT__ || {};
  const TOKEN = BOOT.token || '';
  const enc = encodeURIComponent;

  async function readError(res) {
    let data = null;
    try { data = await res.json(); } catch { }
    const err = new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
    err.status = res.status;
    err.data = data;
    return err;
  }

  let recovering = false;
  async function sessionStale() {
    if (!BOOT.startedAt || recovering) return false;
    try {
      const hello = await fetch('/api/hello', { cache: 'no-store' }).then(r => r.json());
      return !!(hello && hello.startedAt && hello.startedAt !== BOOT.startedAt);
    } catch { return false; }
  }
  async function recoverSession() {
    if (recovering || !(await sessionStale())) return false;
    recovering = true;
    try { sessionStorage.setItem('bc.sessionReloadedAt', String(Date.now())); } catch { }
    location.reload();
    return true;
  }
  async function handleForbidden(res) {
    const err = await readError(res);
    if (res.status === 403) recoverSession().catch(() => { });
    return err;
  }

  async function request(path, opts = {}) {
    const headers = Object.assign({ 'x-batcave-token': TOKEN }, opts.headers || {});
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
      opts.method = opts.method || 'POST';
    }
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    if (!res.ok) throw await handleForbidden(res);
    return res.json();
  }

  function qs(params) {
    const u = new URLSearchParams();
    Object.keys(params || {}).forEach(k => {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') u.set(k, params[k]);
    });
    return u.toString();
  }

  const api = {
    boot: BOOT,
    token: TOKEN,
    online: !!BOOT.token,

    hello() { return fetch('/api/hello').then(r => r.json()); },
    stats() { return request('/api/stats'); },
    linuxStatus() { return request('/api/linux/status'); },

    fsList(path) { return request('/api/fs/list?' + qs({ path })); },
    fsRead(path) { return request('/api/fs/read?' + qs({ path })); },
    fsWrite(path, content, append) { return request('/api/fs/write', { json: { path, content, append: !!append } }); },
    fsMkdir(path) { return request('/api/fs/mkdir', { json: { path } }); },
    fsRemove(path) { return request('/api/fs/remove', { json: { path } }); },
    fsRename(from, to) { return request('/api/fs/rename', { json: { from, to } }); },
    fsComplete(q, cwd) { return request('/api/fs/complete?' + qs({ q, cwd })); },
    cd(mode, cwd, target) { return request('/api/cd', { json: { mode, cwd, target } }); },
    rawUrl(path, download) { return '/api/fs/raw?' + qs({ path, download: download ? 1 : undefined }); },
    async blobUrl(path) {
      const res = await fetch(api.rawUrl(path));
      if (!res.ok) throw await handleForbidden(res);
      return URL.createObjectURL(await res.blob());
    },
    upload(path, file, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/fs/upload');
        xhr.setRequestHeader('x-batcave-token', TOKEN);
        xhr.setRequestHeader('x-batcave-path', enc(path));
        xhr.upload.onprogress = e => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
        xhr.onload = () => {
          let data = null;
          try { data = JSON.parse(xhr.responseText); } catch { }
          if (xhr.status >= 200 && xhr.status < 300) resolve(data);
          else {
            if (xhr.status === 403) recoverSession().catch(() => { });
            reject(new Error((data && data.error) || ('上传失败 HTTP ' + xhr.status)));
          }
        };
        xhr.onerror = () => reject(new Error('上传失败：网络错误'));
        xhr.send(file);
      });
    },

    async execStream(opts, handlers = {}) {
      const ctrl = new AbortController();
      if (handlers.onController) handlers.onController(ctrl);
      const headers = {
        'content-type': 'application/json',
        'x-batcave-token': TOKEN,
        'x-batcave-confirm': opts.confirm ? '1' : '0'
      };
      let res;
      try {
        res = await fetch('/api/exec', {
          method: 'POST', headers, signal: ctrl.signal,
          body: JSON.stringify({ cmd: opts.cmd, mode: opts.mode, cwd: opts.cwd })
        });
      } catch (e) {
        if (e.name === 'AbortError') { const err = new Error('aborted'); err.aborted = true; throw err; }
        throw e;
      }
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || '需要二次确认');
        err.risky = true; err.data = data; throw err;
      }
      if (!res.ok) throw await handleForbidden(res);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let ev;
            try { ev = JSON.parse(line); } catch { continue; }
            if (ev.t === 'data' && handlers.onData) handlers.onData(ev.d || '', ev.k || 'out');
            else if (ev.t === 'begin' && handlers.onBegin) handlers.onBegin(ev);
            else if (ev.t === 'end' && handlers.onEnd) handlers.onEnd(ev);
            else if (ev.t === 'action' && handlers.onAction) handlers.onAction(ev.action || {});
            else if (handlers.onEvent) handlers.onEvent(ev);
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          if (handlers.onAbort) handlers.onAbort();
          const err = new Error('aborted'); err.aborted = true; throw err;
        }
        throw e;
      }
      return ctrl;
    },

    async proxyFetch(url, timeoutMs = 12000) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch('/api/proxy?url=' + enc(url), { signal: ctrl.signal });
        const text = await res.text();
        return { ok: res.ok, status: res.status, text, headers: res.headers };
      } finally { clearTimeout(timer); }
    },

    proxyUrl(url, reader, grant, incognito) {
      return '/api/proxy?url=' + enc(url) + (reader ? '&mode=reader' : '') + (grant ? '&grant=' + enc(grant) : '') + (incognito ? '&incog=1' : '');
    },

    urlCheck(url) { return request('/api/urlcheck?' + qs({ url })); },
    urlGrant(url) { return request('/api/urlgrant', { json: { url, acknowledge: true } }); },

    networkStatus() { return request('/api/network/status'); },
    wifiScan(elevated) { return request('/api/network/wifi/scan?' + qs({ elevated: elevated ? 1 : undefined })); },
    wifiConnect(ssid, password, open, elevated) { return request('/api/network/wifi/connect', { json: { ssid, password, open, elevated: !!elevated } }); },
    wifiDisconnect() { return request('/api/network/wifi/disconnect', { json: {} }); },
    ethernetAction(name, action) { return request('/api/network/ethernet', { json: { name, action } }); },
    openNetworkSettings(target) { return request('/api/network/open-settings', { json: { target } }); },

    appsSearch(q) { return request('/api/apps/search?' + qs({ q })); },
    appsInstalled(refresh) { return request('/api/apps/installed?' + qs({ refresh: refresh ? 1 : undefined })); },
    appsUpgrades(refresh) { return request('/api/apps/upgrades?' + qs({ refresh: refresh ? 1 : undefined })); },
    appsLaunch(mode, target) { return request('/api/apps/launch', { json: { mode, target } }); },
    appsLaunchers(refresh) { return request('/api/apps/launchers?' + qs({ refresh: refresh ? 1 : undefined })); },
    appsEssentials(refresh) { return request('/api/apps/essentials?' + qs({ refresh: refresh ? 1 : undefined })); },
    appsAccelerators(refresh) { return request('/api/apps/accelerators?' + qs({ refresh: refresh ? 1 : undefined })); },
    appsAcceleratorResolve(id) { return request('/api/apps/accelerators/resolve?' + qs({ id })); },
    appsUninstall(name) { return request('/api/apps/uninstall', { json: { name } }); },

    updateStatus() { return request('/api/update/status'); },
    updateCheck(source) { return request('/api/update/check?' + qs({ source })); },
    updateApply(source, version, revision) { return request('/api/update/apply', { json: { source, version, revision } }); },
    updateJob(id) { return request('/api/update/job?' + qs({ id })); },
    updateRestart() { return request('/api/update/restart', { json: {} }); },

    mailProviders() { return request('/api/mail/providers'); },
    mailLogin(email, password, provider) { return request('/api/mail/login', { json: { email, password, provider } }); },
    mailList(session, folder, limit) { return request('/api/mail/list', { json: { session, folder, limit } }); },
    mailRead(session, folder, uid) { return request('/api/mail/read', { json: { session, folder, uid } }); },
    mailSend(session, to, subject, text, html) { return request('/api/mail/send', { json: { session, to, subject, text, html } }); },
    mailLogout(session) { return request('/api/mail/logout', { json: { session } }); },

    embeddedList() { return request('/api/embedded/list'); },
    embeddedStart(id) { return request('/api/embedded/start', { json: { id } }); },
    embeddedStop(id) { return request('/api/embedded/stop', { json: { id } }); },
    embeddedUpdateStatus(app) { return request('/api/embedded/update/status?' + qs({ app })); },
    embeddedUpdateCheck(app, source) { return request('/api/embedded/update/check?' + qs({ app, source })); },
    embeddedUpdateApply(app, source, version) { return request('/api/embedded/update/apply', { json: { app, source, version } }); },
    embeddedUpdateJob(id) { return request('/api/embedded/update/job?' + qs({ id })); },

    releasesFeed(force) { return request('/api/releases/feed?' + qs({ force: force ? 1 : undefined })); },
    releasesCheck() { return request('/api/releases/check', { json: {} }); },
    releasesSeen(ids) { return request('/api/releases/seen', { json: { ids } }); },

    geoIp(q) { return request('/api/geo/ip?' + qs({ q })); },
    geoTimezone(lat, lon) { return request('/api/geo/timezone?' + qs({ lat, lon })); },
    geoWifi(elevated) { return request('/api/geo/wifi?' + qs({ elevated: elevated ? 1 : undefined })); },
    async geoTrace(host, handlers = {}, maxHops) {
      const ctrl = new AbortController();
      if (handlers.onController) handlers.onController(ctrl);
      let res;
      try {
        res = await fetch('/api/geo/trace', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'content-type': 'application/json', 'x-batcave-token': TOKEN },
          body: JSON.stringify({ host, maxHops: maxHops || 30 })
        });
      } catch (e) {
        if (e.name === 'AbortError') { const err = new Error('aborted'); err.aborted = true; throw err; }
        throw e;
      }
      if (!res.ok) throw await handleForbidden(res);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let ev;
            try { ev = JSON.parse(line); } catch { continue; }
            if (ev.type === 'line' && handlers.onLine) handlers.onLine(ev.text);
            else if (ev.type === 'start' && handlers.onStart) handlers.onStart(ev);
            else if (ev.type === 'end' && handlers.onEnd) handlers.onEnd(ev);
            else if (ev.type === 'error' && handlers.onError) handlers.onError(new Error(ev.message || 'trace error'));
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') { const err = new Error('aborted'); err.aborted = true; throw err; }
        throw e;
      }
      return ctrl;
    }
  };

  const util = {
    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    html(strings) { return strings; },
    fmtBytes(n) {
      if (n == null || isNaN(n)) return '—';
      n = Number(n);
      if (n < 1024) return n + ' B';
      const u = ['KB', 'MB', 'GB', 'TB'];
      let i = -1;
      do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
      return n.toFixed(n >= 10 ? 0 : 1) + ' ' + u[i];
    },
    fmtDate(ts) {
      if (!ts) return '—';
      const d = new Date(ts);
      if (isNaN(d)) return '—';
      const p = x => String(x).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    },
    fmtDuration(ms) {
      if (!ms && ms !== 0) return '—';
      if (ms < 1000) return Math.round(ms) + 'ms';
      const s = ms / 1000;
      if (s < 60) return s.toFixed(s >= 10 ? 0 : 1) + 's';
      return Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's';
    },
    uid() { return 'w' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); },
    clamp(n, a, b) { return Math.max(a, Math.min(b, n)); },
    debounce(fn, ms) {
      let t;
      return function () { clearTimeout(t); const args = arguments, self = this; t = setTimeout(() => fn.apply(self, args), ms); };
    },
    async copy(text) {
      try { await navigator.clipboard.writeText(text); return true; }
      catch {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;left:-999px';
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { }
        ta.remove();
        return ok;
      }
    },
    download(name, content, type) {
      const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    },
    hostJoin(base, sub) {
      const sep = String(base || '').includes('\\') ? '\\' : '/';
      return String(base || '').replace(/[\\/]+$/, '') + sep + String(sub || '').replace(/^[\\/]+/, '');
    },
    fileKind(entry) {
      const name = String(entry.name || '').toLowerCase();
      const ext = name.includes('.') ? name.split('.').pop() : '';
      if (entry.dir || entry.type === 'dir') return { kind: 'dir', icon: 'folder', color: '#ffcf5c' };
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico'].includes(ext)) return { kind: 'image', icon: 'image', color: '#9b8cff' };
      if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return { kind: 'audio', icon: 'music', color: '#ff79b0' };
      if (['mp4', 'm4v', 'webm', 'mkv', 'mov'].includes(ext)) return { kind: 'video', icon: 'play', color: '#ff9b5c' };
      if (['js', 'mjs', 'py', 'c', 'h', 'cpp', 'cc', 'rs', 'go', 'java', 'sh', 'ps1', 'cmd', 'bat', 'html', 'css', 'json', 'ts', 'tsx', 'jsx', 'yml', 'yaml', 'xml', 'toml'].includes(ext)) return { kind: 'code', icon: 'forge', color: '#5ffbf1' };
      if (['md', 'txt', 'log', 'ini', 'conf'].includes(ext)) return { kind: 'text', icon: 'notes', color: '#8fb4c2' };
      return { kind: 'file', icon: 'file', color: '#6e8b93' };
    },
    isTextExt(path) {
      const ext = String(path || '').toLowerCase().split('.').pop();
      return ['md', 'txt', 'log', 'js', 'mjs', 'c', 'h', 'cpp', 'cc', 'py', 'rs', 'go', 'java', 'sh', 'ps1', 'cmd', 'bat', 'html', 'css', 'json', 'ts', 'jsx', 'tsx', 'yml', 'yaml', 'xml', 'toml', 'ini', 'conf', 'svg', 'csv'].includes(ext);
    },
    isImageExt(path) {
      const ext = String(path || '').toLowerCase().split('.').pop();
      return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico'].includes(ext);
    },
    isAudioExt(path) {
      const ext = String(path || '').toLowerCase().split('.').pop();
      return ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext);
    },
    isVideoExt(path) {
      const ext = String(path || '').toLowerCase().split('.').pop();
      return ['mp4', 'm4v', 'webm', 'mkv', 'mov'].includes(ext);
    },
    baseName(p) { return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '/'; },
    dirName(p) {
      const clean = String(p || '').replace(/[\\/]+$/, '');
      const i = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
      return i <= 0 ? '/' : clean.slice(0, i);
    },
    icon(name, cls) {
      return '<svg class="ic ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
    }
  };

  window.BC = window.BC || {};
  BC.BOOT = BOOT;
  BC.api = api;
  BC.util = util;
  BC.store = {
    get(k, fallback) {
      try { const v = localStorage.getItem('bc.' + k); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(k, v) {
      try { localStorage.setItem('bc.' + k, JSON.stringify(v)); return true; } catch { return false; }
    },
    del(k) { try { localStorage.removeItem('bc.' + k); } catch { } }
  };
})();