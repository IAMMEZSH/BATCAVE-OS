/* BATCAVE OS // local media player + image viewer */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const PLAYER_DIRS = 'bc.player.dirs';
  const PHOTO_DIRS = 'bc.photos.dirs';
  const PLAYER_VOL = 'bc.player.volume';
  const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];
  const VIDEO_EXT = ['mp4', 'm4v', 'webm', 'mkv', 'mov'];
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico'];

  function extOf(name) {
    const s = String(name || '').toLowerCase();
    return s.includes('.') ? s.split('.').pop() : '';
  }
  function mediaKind(name) {
    const ext = extOf(name);
    if (AUDIO_EXT.includes(ext)) return 'audio';
    if (VIDEO_EXT.includes(ext)) return 'video';
    return null;
  }
  function baseName(p) {
    return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '/';
  }
  function normPath(p) {
    let s = '/' + String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const out = [];
    for (const seg of s.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    return '/' + out.join('/');
  }
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '--:--';
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }
  function fmtSize(n) {
    const v = Number(n) || 0;
    if (v >= 1073741824) return (v / 1073741824).toFixed(2) + ' GB';
    if (v >= 1048576) return (v / 1048576).toFixed(1) + ' MB';
    if (v >= 1024) return Math.round(v / 1024) + ' KB';
    return v + ' B';
  }
  function readDirs(key, fallback) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || 'null');
      if (Array.isArray(raw)) {
        const out = raw.map(normPath).filter(x => x !== '/');
        if (out.length) return Array.from(new Set(out));
      }
    } catch { }
    return fallback.slice();
  }
  function writeDirs(key, dirs) {
    try { localStorage.setItem(key, JSON.stringify(dirs)); } catch { }
  }
  function readVolume() {
    try {
      const v = Number(localStorage.getItem(PLAYER_VOL));
      return isFinite(v) && v >= 0 && v <= 1 ? v : 0.8;
    } catch { return 0.8; }
  }
  function writeVolume(v) {
    try { localStorage.setItem(PLAYER_VOL, String(v)); } catch { }
  }

  async function collectMedia(dir, depth, out, seen) {
    let res;
    try { res = await A.fsList(dir); } catch { return; }
    for (const e of (res.entries || [])) {
      if (out.length >= 500) return;
      if (e.dir) {
        if (depth > 0 && !String(e.name || '').startsWith('.')) await collectMedia(e.path, depth - 1, out, seen);
        continue;
      }
      const kind = mediaKind(e.name);
      if (!kind || seen.has(e.path)) continue;
      seen.add(e.path);
      out.push({ path: e.path, name: e.name, kind, size: e.size || 0 });
    }
  }

  async function collectImages(dir, depth, out, seen) {
    let res;
    try { res = await A.fsList(dir); } catch { return; }
    for (const e of (res.entries || [])) {
      if (out.length >= 600) return;
      if (e.dir) {
        if (depth > 0 && !String(e.name || '').startsWith('.')) await collectImages(e.path, depth - 1, out, seen);
        continue;
      }
      if (!IMAGE_EXT.includes(extOf(e.name)) || seen.has(e.path)) continue;
      seen.add(e.path);
      out.push({ path: e.path, name: e.name, size: e.size || 0 });
    }
  }

  /* ================================================================ MEDIA PLAYER */
  function createPlayer(body, win, params) {
    body.innerHTML =
      '<div class="app mplay-app">' +
        '<div class="app-toolbar">' +
          '<span class="toolbar-title">影音播放器</span><span class="toolbar-sub">LOCAL AUDIO · VIDEO</span>' +
          '<span class="spacer"></span>' +
          '<button class="btn" data-mp="folder">' + U.icon('folder') + ' 扫描文件夹</button>' +
          '<button class="btn primary" data-mp="open">' + U.icon('upload') + ' 打开文件</button>' +
          '<button class="icon-btn" data-mp="refresh" title="刷新媒体库">' + U.icon('refresh') + '</button>' +
          '<input type="file" id="mpFile" accept="audio/*,video/*,.mkv,.flac,.m4a,.m4v" multiple hidden>' +
        '</div>' +
        '<div class="mplay-layout">' +
          '<aside class="mplay-side">' +
            '<div class="mplay-side-head"><span>媒体库</span><span id="mpCount">0</span></div>' +
            '<div class="mplay-filters">' +
              '<button class="chip on" data-kind="all">全部</button>' +
              '<button class="chip" data-kind="audio">音乐</button>' +
              '<button class="chip" data-kind="video">视频</button>' +
            '</div>' +
            '<div class="mplay-list" id="mpList"></div>' +
          '</aside>' +
          '<section class="mplay-main" id="mpMain">' +
            '<div class="mplay-screen" id="mpScreen">' +
              '<video id="mpVideo" playsinline preload="metadata" hidden></video>' +
              '<div class="mplay-audio" id="mpAudioArt" hidden><div class="mplay-disc">' + U.icon('music') + '</div><div class="mplay-eq"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>' +
              '<div class="mplay-idle" id="mpIdle">' + U.icon('play') + '<b>选择媒体开始播放</b><p>媒体库扫描 /Music、/Videos、/Downloads、/Uploads；也可以直接打开本地文件或扫描其他文件夹。</p></div>' +
            '</div>' +
            '<div class="mplay-meta">' +
              '<div class="mplay-now"><b id="mpTitle">未选择媒体</b><span id="mpSub">LOCAL FILE · NO CLOUD</span></div>' +
              '<div class="mplay-controls">' +
                '<button class="icon-btn" data-mp="prev" title="上一个">' + U.icon('left') + '</button>' +
                '<button class="icon-btn mplay-play" data-mp="toggle" title="播放 / 暂停">' + U.icon('play') + '</button>' +
                '<button class="icon-btn" data-mp="next" title="下一个">' + U.icon('right') + '</button>' +
                '<input class="range mplay-seek" type="range" id="mpSeek" min="0" max="1000" value="0" aria-label="播放进度">' +
                '<span class="mplay-time" id="mpTime">0:00 / --:--</span>' +
                '<span class="mplay-vol-wrap">' + U.icon('volume') + '<input class="range" type="range" id="mpVol" min="0" max="100" aria-label="音量"></span>' +
                '<select class="input mplay-rate" id="mpRate" aria-label="播放速度"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>' +
                '<button class="btn mplay-loop" data-mp="loop" title="单曲循环">LOOP</button>' +
                '<button class="icon-btn" data-mp="fullscreen" title="全屏">' + U.icon('max') + '</button>' +
              '</div>' +
            '</div>' +
          '</section>' +
        '</div>' +
        '<audio id="mpAudio" preload="metadata"></audio>' +
        '<div class="app-status"><span id="mpStatus" class="ok">READY</span><span class="spacer"></span><span id="mpHint">RANGE STREAM · SEEK ENABLED</span></div>' +
      '</div>';

    const listEl = $('#mpList', body);
    const audio = $('#mpAudio', body);
    const video = $('#mpVideo', body);
    const art = $('#mpAudioArt', body);
    const idle = $('#mpIdle', body);
    const seek = $('#mpSeek', body);
    const timeEl = $('#mpTime', body);
    const playBtn = $('[data-mp="toggle"]', body);
    const loopBtn = $('[data-mp="loop"]', body);
    const kindButtons = $$('[data-kind]', body);
    const dirs = readDirs(PLAYER_DIRS, ['/Music', '/Videos', '/Downloads', '/Uploads']);
    let items = [];
    let current = -1;
    let filter = 'all';
    let loop = false;
    let seeking = false;
    let scanToken = 0;

    function status(text, kind) {
      const el = $('#mpStatus', body);
      el.textContent = text || 'READY';
      el.className = kind || 'ok';
    }
    function activeEl() {
      if (current < 0 || !items[current]) return null;
      return items[current].kind === 'video' ? video : audio;
    }
    function isCurrent(el) {
      return activeEl() === el;
    }
    function currentItem() { return current >= 0 ? items[current] : null; }
    function visibleItems() {
      return filter === 'all' ? items : items.filter(x => x.kind === filter);
    }
    function renderList() {
      const visible = visibleItems();
      $('#mpCount', body).textContent = visible.length + (filter === 'all' ? '' : ' / ' + items.length);
      if (!visible.length) {
        listEl.innerHTML = '<div class="mplay-empty">' + U.icon('music') + '<b>媒体库为空</b><p>把音乐或视频放入 <code>~/Batcave/Music</code>、<code>Videos</code>、<code>Downloads</code>，或点击“打开文件”。</p></div>';
        return;
      }
      listEl.innerHTML = visible.map((it) => {
        const cur = currentItem();
        return '<button class="mplay-item' + (cur && cur.path === it.path ? ' on' : '') + '" data-path="' + U.esc(it.path) + '" title="' + U.esc(it.path) + '">' +
          '<span class="mplay-thumb">' + U.icon(it.kind === 'video' ? 'play' : 'music') + '</span>' +
          '<span class="mplay-info"><b>' + U.esc(it.name) + '</b><span>' + (it.kind === 'video' ? 'VIDEO' : 'AUDIO') + ' · ' + U.esc(fmtSize(it.size)) + '</span></span>' +
          '</button>';
      }).join('');
    }
    function updateNow() {
      const it = currentItem();
      const title = $('#mpTitle', body), sub = $('#mpSub', body);
      if (!it) {
        title.textContent = '未选择媒体';
        sub.textContent = 'LOCAL FILE · NO CLOUD';
        win.setTitle('影音播放器', 'MEDIA PLAYER');
        return;
      }
      title.textContent = it.name;
      sub.textContent = (it.kind === 'video' ? 'VIDEO' : 'AUDIO') + ' · ' + fmtSize(it.size) + ' · ' + it.path;
      win.setTitle(it.name, it.kind === 'video' ? 'VIDEO' : 'AUDIO');
    }
    function updateControls() {
      const el = activeEl();
      const playing = !!(el && !el.paused && !el.ended);
      playBtn.innerHTML = U.icon(playing ? 'pause' : 'play');
      art.classList.toggle('playing', !!(el === audio && playing));
      loopBtn.classList.toggle('on', loop);
    }
    function resetSeek() {
      seek.value = '0';
      timeEl.textContent = '0:00 / --:--';
    }
    function ensureItem(path) {
      const p = normPath(path);
      const old = items.find(x => x.path === p);
      if (old) return old;
      const kind = mediaKind(p);
      if (!kind) return null;
      const it = { path: p, name: baseName(p), kind, size: 0 };
      items.push(it);
      return it;
    }
    function playPath(path) {
      const p = normPath(path);
      let idx = items.findIndex(x => x.path === p);
      if (idx < 0) {
        const added = ensureItem(p);
        if (!added) { BC.toast('不是可播放的音频或视频文件: ' + p); return; }
        idx = items.indexOf(added);
      }
      playIndex(idx);
    }
    function playIndex(idx) {
      if (idx < 0 || idx >= items.length) return;
      current = idx;
      const it = items[idx];
      const isVideo = it.kind === 'video';
      audio.pause();
      video.pause();
      try { audio.removeAttribute('src'); audio.load(); } catch { }
      try { video.removeAttribute('src'); video.load(); } catch { }
      video.hidden = !isVideo;
      art.hidden = isVideo;
      idle.hidden = true;
      audio.volume = video.volume = readVolume();
      const el = isVideo ? video : audio;
      el.src = A.rawUrl(it.path);
      el.load();
      resetSeek();
      renderList();
      updateNow();
      updateControls();
      status('LOADING · ' + it.name, 'warn');
      const p = el.play();
      if (p && p.catch) p.catch(e => status('播放失败 · ' + (e.message || '浏览器不支持该编码'), 'err'));
      if ('mediaSession' in navigator && navigator.mediaSession) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({ title: it.name, artist: 'BATCAVE LOCAL', album: it.path });
          navigator.mediaSession.setActionHandler('play', () => { el.play().catch(() => { }); });
          navigator.mediaSession.setActionHandler('pause', () => el.pause());
          navigator.mediaSession.setActionHandler('previoustrack', () => next(-1));
          navigator.mediaSession.setActionHandler('nexttrack', () => next(1));
        } catch { }
      }
    }
    function next(delta) {
      if (!items.length) return;
      const base = current < 0 ? 0 : current;
      playIndex((base + delta + items.length) % items.length);
    }
    function toggle() {
      const el = activeEl();
      if (!el) { if (items.length) playIndex(0); return; }
      if (el.paused) el.play().catch(e => status('播放失败 · ' + e.message, 'err'));
      else el.pause();
    }
    function onPlay(e) {
      if (!isCurrent(e.target)) return;
      updateControls();
      status('PLAYING · ' + (currentItem() ? currentItem().name : ''), 'ok');
    }
    function onPause(e) {
      if (!isCurrent(e.target)) return;
      updateControls();
      status('PAUSED', 'warn');
    }
    function onTime(e) {
      if (!isCurrent(e.target)) return;
      const el = e.target;
      if (!seeking) {
        const dur = el.duration;
        if (isFinite(dur) && dur > 0) {
          seek.value = String(Math.round(el.currentTime / dur * 1000));
          timeEl.textContent = fmtTime(el.currentTime) + ' / ' + fmtTime(dur);
        } else {
          timeEl.textContent = fmtTime(el.currentTime) + ' / --:--';
        }
      }
    }
    function onMeta(e) {
      if (!isCurrent(e.target)) return;
      const el = e.target;
      timeEl.textContent = fmtTime(el.currentTime) + ' / ' + fmtTime(el.duration);
      status((el.paused ? 'READY · ' : 'PLAYING · ') + fmtTime(el.duration), 'ok');
    }
    function onEnded(e) {
      if (!isCurrent(e.target)) return;
      if (loop) { e.target.currentTime = 0; e.target.play().catch(() => { }); return; }
      if (items.length > 1) next(1);
      else { updateControls(); status('PLAYBACK ENDED', 'ok'); }
    }
    function onError(e) {
      if (!isCurrent(e.target)) return;
      const code = e.target.error ? e.target.error.code : 0;
      status('无法播放 · 编码不支持或文件损坏（error ' + code + '）', 'err');
      updateControls();
    }
    [audio, video].forEach(el => {
      el.addEventListener('play', onPlay);
      el.addEventListener('pause', onPause);
      el.addEventListener('timeupdate', onTime);
      el.addEventListener('loadedmetadata', onMeta);
      el.addEventListener('durationchange', onMeta);
      el.addEventListener('ended', onEnded);
      el.addEventListener('error', onError);
    });

    async function scan(extra) {
      const token = ++scanToken;
      status('SCANNING · ' + dirs.join(' · '), 'warn');
      const found = [], seen = new Set();
      for (const dir of dirs) await collectMedia(dir, 2, found, seen);
      for (const p of (extra || [])) {
        const v = normPath(p);
        const kind = mediaKind(v);
        if (kind && !seen.has(v)) { seen.add(v); found.push({ path: v, name: baseName(v), kind, size: 0 }); }
      }
      if (token !== scanToken) return;
      found.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      const cur = currentItem();
      items = found;
      current = cur ? items.findIndex(x => x.path === cur.path) : -1;
      if (cur && current >= 0) updateNow();
      renderList();
      if (!items.length) status('NO MEDIA FOUND', 'warn');
      else status('READY · ' + items.length + ' FILES', 'ok');
    }
    function addDir(dir) {
      const p = normPath(dir);
      if (p === '/' || dirs.includes(p)) return p;
      dirs.push(p);
      writeDirs(PLAYER_DIRS, dirs);
      return p;
    }
    async function pickFolder() {
      const value = await BC.ui.prompt('扫描文件夹', '输入 Home 内的目录路径。媒体播放器会递归扫描其中的音频与视频文件。', { value: dirs[0] || '/Music', okText: '加入媒体库', icon: 'folder' });
      if (value == null) return;
      const p = addDir(value);
      await scan();
      status('SCAN · ' + p, 'ok');
    }
    async function uploadFiles(files) {
      const list = Array.from(files || []);
      if (!list.length) return;
      let last = null;
      for (const f of list) {
        const name = String(f.name || 'media');
        if (!mediaKind(name) && !/^audio\//.test(f.type) && !/^video\//.test(f.type)) { BC.toast('跳过非音频/视频文件: ' + name); continue; }
        const safe = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
        const path = '/Uploads/' + safe;
        status('UPLOADING · ' + name, 'warn');
        try {
          await A.upload(path, f, p => status('UPLOADING · ' + name + ' · ' + Math.round(p * 100) + '%', 'warn'));
          last = path;
          status('UPLOADED · ' + name, 'ok');
        } catch (e) { status('上传失败 · ' + e.message, 'err'); }
      }
      if (last) {
        await scan([last]);
        playPath(last);
      }
    }

    listEl.addEventListener('click', e => {
      const b = e.target.closest('[data-path]');
      if (b) playPath(b.dataset.path);
    });
    kindButtons.forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.kind;
      kindButtons.forEach(x => x.classList.toggle('on', x === b));
      renderList();
    }));
    $('[data-mp="prev"]', body).addEventListener('click', () => next(-1));
    $('[data-mp="next"]', body).addEventListener('click', () => next(1));
    playBtn.addEventListener('click', toggle);
    seek.addEventListener('pointerdown', () => { seeking = true; });
    seek.addEventListener('input', () => {
      const el = activeEl();
      if (!el || !isFinite(el.duration)) return;
      const t = el.duration * Number(seek.value) / 1000;
      timeEl.textContent = fmtTime(t) + ' / ' + fmtTime(el.duration);
    });
    seek.addEventListener('change', () => {
      const el = activeEl();
      if (el && isFinite(el.duration) && el.duration > 0) el.currentTime = el.duration * Number(seek.value) / 1000;
      seeking = false;
    });
    const vol = $('#mpVol', body);
    vol.value = String(Math.round(readVolume() * 100));
    vol.addEventListener('input', () => {
      const v = Number(vol.value) / 100;
      audio.volume = video.volume = v;
      writeVolume(v);
    });
    $('#mpRate', body).addEventListener('change', e => {
      const r = Number(e.target.value) || 1;
      audio.playbackRate = r;
      video.playbackRate = r;
    });
    loopBtn.addEventListener('click', () => { loop = !loop; updateControls(); status(loop ? 'LOOP ON' : 'LOOP OFF', 'ok'); });
    $('[data-mp="fullscreen"]', body).addEventListener('click', () => {
      const target = currentItem() && currentItem().kind === 'video' ? video : $('#mpScreen', body);
      if (target.requestFullscreen) target.requestFullscreen().catch(e => status('全屏失败 · ' + e.message, 'err'));
    });
    $('[data-mp="open"]', body).addEventListener('click', () => $('#mpFile', body).click());
    $('[data-mp="folder"]', body).addEventListener('click', pickFolder);
    $('[data-mp="refresh"]', body).addEventListener('click', () => scan());
    $('#mpFile', body).addEventListener('change', async e => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      await uploadFiles(files);
    });
    const screen = $('#mpScreen', body);
    screen.addEventListener('dragover', e => { e.preventDefault(); screen.classList.add('drop'); });
    screen.addEventListener('dragleave', () => screen.classList.remove('drop'));
    screen.addEventListener('drop', async e => {
      e.preventDefault();
      screen.classList.remove('drop');
      await uploadFiles(e.dataTransfer && e.dataTransfer.files);
    });
    screen.addEventListener('click', e => { if (e.target === screen || e.target === idle) { /* no-op */ } });

    const applyParams = p => {
      if (!p) return;
      if (p.path) playPath(p.path);
      if (p.dir) { addDir(p.dir); scan([p.path].filter(Boolean)); }
    };
    win.onParams = (w, p) => applyParams(p);
    renderList();
    updateControls();
    scan(params && params.path ? [params.path] : []);
    if (params && params.path) setTimeout(() => playPath(params.path), 120);
    return () => {
      scanToken++;
      audio.pause();
      video.pause();
      try { audio.removeAttribute('src'); audio.load(); } catch { }
      try { video.removeAttribute('src'); video.load(); } catch { }
      if ('mediaSession' in navigator && navigator.mediaSession) {
        try { navigator.mediaSession.metadata = null; } catch { }
      }
    };
  }

  /* ================================================================ IMAGE VIEWER */
  function createPhotos(body, win, params) {
    body.innerHTML =
      '<div class="app photo-app">' +
        '<div class="app-toolbar">' +
          '<span class="toolbar-title">图片查看器</span><span class="toolbar-sub">LOCAL IMAGE VIEWER</span>' +
          '<span class="spacer"></span>' +
          '<button class="btn" data-ph="folder">' + U.icon('folder') + ' 扫描文件夹</button>' +
          '<button class="btn primary" data-ph="open">' + U.icon('upload') + ' 打开图片</button>' +
          '<button class="icon-btn" data-ph="refresh" title="刷新图片库">' + U.icon('refresh') + '</button>' +
          '<input type="file" id="phFile" accept="image/*" multiple hidden>' +
        '</div>' +
        '<div class="photo-main" id="phMain">' +
          '<div class="photo-grid" id="phGrid"></div>' +
          '<div class="photo-stage" id="phStage" tabindex="0" hidden>' +
            '<div class="photo-bar">' +
              '<button class="icon-btn" data-ph="back" title="返回图片库">' + U.icon('left') + '</button>' +
              '<div class="photo-caption"><b id="phName">—</b><span id="phMeta"></span></div>' +
              '<span class="spacer"></span>' +
              '<button class="icon-btn" data-ph="prev" title="上一张">' + U.icon('left') + '</button>' +
              '<button class="icon-btn" data-ph="next" title="下一张">' + U.icon('right') + '</button>' +
              '<button class="icon-btn" data-ph="zoomout" title="缩小">−</button>' +
              '<button class="icon-btn" data-ph="zoomin" title="放大">+</button>' +
              '<button class="btn" data-ph="fit">适应</button>' +
              '<button class="btn" data-ph="actual">1:1</button>' +
              '<button class="icon-btn" data-ph="rotate" title="旋转 90°">' + U.icon('refresh') + '</button>' +
              '<button class="btn" data-ph="slideshow">幻灯片</button>' +
              '<button class="icon-btn" data-ph="fullscreen" title="全屏">' + U.icon('max') + '</button>' +
              '<button class="icon-btn" data-ph="download" title="下载">' + U.icon('download') + '</button>' +
              '<button class="icon-btn" data-ph="delete" title="删除">' + U.icon('trash') + '</button>' +
              '<button class="icon-btn" data-ph="close" title="关闭预览">' + U.icon('close') + '</button>' +
            '</div>' +
            '<div class="photo-canvas" id="phCanvas"><img class="photo-img fit" id="phImg" alt=""></div>' +
            '<div class="photo-film" id="phFilm"></div>' +
          '</div>' +
        '</div>' +
        '<div class="app-status"><span id="phStatus" class="ok">READY</span><span class="spacer"></span><span id="phCount">0 张</span><span id="phHint">ARROW KEYS · FIT / ZOOM</span></div>' +
      '</div>';

    const grid = $('#phGrid', body);
    const stage = $('#phStage', body);
    const img = $('#phImg', body);
    const film = $('#phFilm', body);
    const dirs = readDirs(PHOTO_DIRS, ['/Pictures', '/Gallery', '/Uploads', '/Downloads']);
    let items = [];
    let current = -1;
    let zoom = 1;
    let rotation = 0;
    let fit = true;
    let slideshow = null;
    let scanToken = 0;

    function status(text, kind) {
      const el = $('#phStatus', body);
      el.textContent = text || 'READY';
      el.className = kind || 'ok';
    }
    function currentItem() { return current >= 0 ? items[current] : null; }
    function renderGrid() {
      $('#phCount', body).textContent = items.length + ' 张';
      if (!items.length) {
        grid.innerHTML = '<div class="photo-empty">' + U.icon('image') + '<b>图片库为空</b><p>把图片放入 <code>~/Batcave/Pictures</code>、<code>Gallery</code>、<code>Uploads</code> 或 <code>Downloads</code>，也可以点击“打开图片”。</p></div>';
        return;
      }
      grid.innerHTML = items.map((it, i) =>
        '<button class="photo-card" data-index="' + i + '" title="' + U.esc(it.path) + '">' +
          '<img loading="lazy" src="' + U.esc(A.rawUrl(it.path)) + '" alt="' + U.esc(it.name) + '">' +
          '<span class="photo-card-label">' + U.esc(it.name) + '<i>' + U.esc(fmtSize(it.size)) + '</i></span>' +
        '</button>').join('');
    }
    function renderFilm() {
      film.innerHTML = items.map((it, i) =>
        '<button class="photo-film-item' + (i === current ? ' on' : '') + '" data-index="' + i + '" title="' + U.esc(it.name) + '">' +
          '<img loading="lazy" src="' + U.esc(A.rawUrl(it.path)) + '" alt="">' +
        '</button>').join('');
    }
    function resetView() {
      fit = true;
      zoom = 1;
      rotation = 0;
      img.classList.add('fit');
      img.style.width = '';
      img.style.height = '';
      img.style.maxWidth = '';
      img.style.maxHeight = '';
      img.style.transform = 'rotate(0deg)';
      $('#phCanvas', body).scrollTop = 0;
      $('#phCanvas', body).scrollLeft = 0;
    }
    function setZoom(z) {
      if (!img.naturalWidth) return;
      fit = false;
      zoom = Math.max(0.05, Math.min(8, z));
      img.classList.remove('fit');
      img.style.maxWidth = 'none';
      img.style.maxHeight = 'none';
      img.style.width = Math.max(1, Math.round(img.naturalWidth * zoom)) + 'px';
      img.style.height = 'auto';
      status('ZOOM ' + Math.round(zoom * 100) + '%', 'ok');
    }
    function setFit() {
      resetView();
      status('FIT TO WINDOW', 'ok');
    }
    function loadCurrent() {
      const it = currentItem();
      if (!it) { closeStage(); return; }
      $('#phName', body).textContent = it.name;
      $('#phMeta', body).textContent = it.path;
      img.alt = it.name;
      img.src = A.rawUrl(it.path);
      resetView();
      renderFilm();
      status('LOADING · ' + it.name, 'warn');
    }
    function openIndex(i) {
      if (i < 0 || i >= items.length) return;
      current = i;
      grid.hidden = true;
      stage.hidden = false;
      loadCurrent();
      stage.focus();
    }
    function closeStage() {
      stopSlideshow();
      stage.hidden = true;
      grid.hidden = false;
      current = -1;
      img.removeAttribute('src');
      win.setTitle('图片查看器', 'IMAGE VIEWER');
    }
    function step(delta) {
      if (!items.length) return;
      const base = current < 0 ? 0 : current;
      openIndex((base + delta + items.length) % items.length);
    }
    function stopSlideshow() {
      if (slideshow) { clearInterval(slideshow); slideshow = null; }
      const b = $('[data-ph="slideshow"]', body);
      if (b) b.classList.remove('on');
    }
    function toggleSlideshow() {
      if (slideshow) { stopSlideshow(); status('SLIDESHOW OFF', 'warn'); return; }
      if (items.length < 2) { BC.toast('至少需要两张图片'); return; }
      slideshow = setInterval(() => step(1), 5000);
      $('[data-ph="slideshow"]', body).classList.add('on');
      status('SLIDESHOW · 5s', 'ok');
    }
    async function scan(extra) {
      const token = ++scanToken;
      status('SCANNING · ' + dirs.join(' · '), 'warn');
      const found = [], seen = new Set();
      for (const dir of dirs) await collectImages(dir, 2, found, seen);
      for (const p of (extra || [])) {
        const v = normPath(p);
        if (IMAGE_EXT.includes(extOf(v)) && !seen.has(v)) { seen.add(v); found.push({ path: v, name: baseName(v), size: 0 }); }
      }
      if (token !== scanToken) return;
      found.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      const cur = currentItem();
      items = found;
      current = cur ? items.findIndex(x => x.path === cur.path) : -1;
      renderGrid();
      if (!stage.hidden) { if (current >= 0) loadCurrent(); else closeStage(); }
      status(items.length ? 'READY · ' + items.length + ' IMAGES' : 'NO IMAGES FOUND', items.length ? 'ok' : 'warn');
      if (current < 0) win.setTitle('图片查看器', 'IMAGE VIEWER');
    }
    function addDir(dir) {
      const p = normPath(dir);
      if (p === '/' || dirs.includes(p)) return p;
      dirs.push(p);
      writeDirs(PHOTO_DIRS, dirs);
      return p;
    }
    async function pickFolder() {
      const value = await BC.ui.prompt('扫描文件夹', '输入 Home 内的目录路径。图片查看器会递归扫描其中的图片。', { value: dirs[0] || '/Pictures', okText: '加入图片库', icon: 'folder' });
      if (value == null) return;
      const p = addDir(value);
      await scan();
      status('SCAN · ' + p, 'ok');
    }
    async function uploadFiles(files) {
      const list = Array.from(files || []);
      if (!list.length) return;
      let last = null;
      for (const f of list) {
        if (!/^image\//.test(f.type) && !IMAGE_EXT.includes(extOf(f.name))) { BC.toast('跳过非图片文件: ' + f.name); continue; }
        const safe = String(f.name || 'image').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
        const path = '/Gallery/' + safe;
        status('UPLOADING · ' + f.name, 'warn');
        try {
          await A.upload(path, f, p => status('UPLOADING · ' + f.name + ' · ' + Math.round(p * 100) + '%', 'warn'));
          last = path;
        } catch (e) { status('上传失败 · ' + e.message, 'err'); }
      }
      if (last) {
        await scan([last]);
        const idx = items.findIndex(x => x.path === normPath(last));
        if (idx >= 0) openIndex(idx);
      }
    }

    grid.addEventListener('click', e => {
      const b = e.target.closest('[data-index]');
      if (b) openIndex(Number(b.dataset.index));
    });
    film.addEventListener('click', e => {
      const b = e.target.closest('[data-index]');
      if (b) openIndex(Number(b.dataset.index));
    });
    $('[data-ph="back"]', body).addEventListener('click', closeStage);
    $('[data-ph="close"]', body).addEventListener('click', closeStage);
    $('[data-ph="prev"]', body).addEventListener('click', () => step(-1));
    $('[data-ph="next"]', body).addEventListener('click', () => step(1));
    $('[data-ph="zoomout"]', body).addEventListener('click', () => setZoom((fit ? 1 : zoom) * 0.8));
    $('[data-ph="zoomin"]', body).addEventListener('click', () => setZoom((fit ? 1 : zoom) * 1.25));
    $('[data-ph="fit"]', body).addEventListener('click', setFit);
    $('[data-ph="actual"]', body).addEventListener('click', () => setZoom(1));
    $('[data-ph="rotate"]', body).addEventListener('click', () => {
      rotation = (rotation + 90) % 360;
      img.style.transform = 'rotate(' + rotation + 'deg)';
      status('ROTATE ' + rotation + '°', 'ok');
    });
    $('[data-ph="slideshow"]', body).addEventListener('click', toggleSlideshow);
    $('[data-ph="fullscreen"]', body).addEventListener('click', () => {
      if (stage.requestFullscreen) stage.requestFullscreen().catch(e => status('全屏失败 · ' + e.message, 'err'));
    });
    $('[data-ph="download"]', body).addEventListener('click', () => {
      const it = currentItem();
      if (!it) return;
      const a = document.createElement('a');
      a.href = A.rawUrl(it.path, true);
      a.download = it.name;
      document.body.appendChild(a); a.click(); a.remove();
    });
    $('[data-ph="delete"]', body).addEventListener('click', async () => {
      const it = currentItem();
      if (!it) return;
      const ok = await BC.ui.confirm('删除图片', '永久删除 <code>' + U.esc(it.name) + '</code>？<br><br>此操作会直接作用于真实文件系统，无法从回收站恢复。', { okText: '删除', danger: true, icon: 'trash' });
      if (!ok) return;
      try {
        await A.fsRemove(it.path);
        BC.toast('图片已删除');
        await scan();
      } catch (e) { BC.toast('删除失败: ' + e.message); }
    });
    $('[data-ph="open"]', body).addEventListener('click', () => $('#phFile', body).click());
    $('[data-ph="folder"]', body).addEventListener('click', pickFolder);
    $('[data-ph="refresh"]', body).addEventListener('click', () => scan());
    $('#phFile', body).addEventListener('change', async e => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      await uploadFiles(files);
    });
    img.addEventListener('load', () => {
      const it = currentItem();
      if (!it) return;
      $('#phMeta', body).textContent = it.path + ' · ' + img.naturalWidth + '×' + img.naturalHeight + ' · ' + fmtSize(it.size);
      status('READY · ' + img.naturalWidth + '×' + img.naturalHeight, 'ok');
      win.setTitle(it.name, 'IMAGE VIEWER');
    });
    img.addEventListener('error', () => status('无法显示图片 · 文件损坏或格式不受支持', 'err'));
    const canvas = $('#phCanvas', body);
    canvas.addEventListener('dblclick', () => { fit ? setZoom(1) : setFit(); });
    stage.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'Escape') { e.preventDefault(); closeStage(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom((fit ? 1 : zoom) * 1.25); }
      else if (e.key === '-') { e.preventDefault(); setZoom((fit ? 1 : zoom) * 0.8); }
    });
    stage.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) status('EXIT FULLSCREEN', 'ok');
    });

    const applyParams = p => {
      if (!p) return;
      if (p.path) {
        const v = normPath(p.path);
        const idx = items.findIndex(x => x.path === v);
        if (idx >= 0) openIndex(idx);
        else scan([v]).then(() => { const i = items.findIndex(x => x.path === v); if (i >= 0) openIndex(i); });
      }
      if (p.dir) { addDir(p.dir); scan([p.path].filter(Boolean)); }
    };
    win.onParams = (w, p) => applyParams(p);
    renderGrid();
    scan(params && params.path ? [params.path] : []);
    if (params && params.path) setTimeout(() => applyParams(params), 120);
    return () => {
      scanToken++;
      stopSlideshow();
      img.removeAttribute('src');
    };
  }

  BC.registerApp({
    id: 'player', name: '影音播放器', en: 'MEDIA PLAYER', icon: 'play', color: '#ff9b5c',
    width: 980, height: 640, minWidth: 560, minHeight: 380, singleton: true,
    desc: '本地音乐与视频播放 · 播放列表 · 拖动进度',
    mount(body, win, params) { return createPlayer(body, win, params); }
  });
  BC.registerApp({
    id: 'photos', name: '图片查看器', en: 'IMAGE VIEWER', icon: 'image', color: '#9b8cff',
    width: 960, height: 660, minWidth: 520, minHeight: 380, singleton: true,
    desc: '本地图片浏览 · 缩放 · 幻灯片',
    mount(body, win, params) { return createPhotos(body, win, params); }
  });
})();
