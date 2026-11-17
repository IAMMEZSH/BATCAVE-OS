/* BATCAVE OS // media: podcasts + global internet radio */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;
  const $ = (s, r) => (r || document).querySelector(s);

  function artBg(url) {
    if (!/^https?:\/\//i.test(String(url || ''))) return '';
    return 'background-image:url(&quot;' + U.esc(url) + '&quot;)';
  }
  function clock(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }
  function stripHtml(s) {
    if (!s) return '';
    let out = String(s).replace(/<[^>]*>/g, ' ');
    const t = document.createElement('textarea');
    t.innerHTML = out;
    out = t.value;
    return out.replace(/\s+/g, ' ').trim();
  }
  function durText(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (/^\d+$/.test(s)) return clock(Number(s));
    const p = s.split(':').map(Number);
    if (p.every(n => !isNaN(n))) {
      const sec = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0];
      return clock(sec);
    }
    return s;
  }
  function external(url) {
    if (/^https?:\/\//i.test(url || '')) window.open(url, '_blank', 'noopener,noreferrer');
  }
  function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.className = kind || '';
  }

  /* ================================================================ PODCASTS */
  function parseFeed(xmlText, feedUrl) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('RSS 不是有效 XML');
    const channel = doc.querySelector('channel') || doc.querySelector('feed');
    if (!channel) throw new Error('该地址不是 RSS/Atom 播客源');
    const title = (channel.querySelector('title') || {}).textContent || '';
    const imageEl = channel.getElementsByTagName('itunes:image')[0] || channel.querySelector('image');
    const image = imageEl ? (imageEl.getAttribute('href') || (imageEl.querySelector('url') || {}).textContent || '') : '';
    let nodes = Array.from(doc.getElementsByTagName('item'));
    if (!nodes.length) nodes = Array.from(doc.getElementsByTagName('entry'));
    const episodes = [];
    nodes.forEach((node, i) => {
      const t = ((node.querySelector('title') || {}).textContent || '').trim() || ('第 ' + (i + 1) + ' 集');
      let url = '';
      const enc = node.getElementsByTagName('enclosure')[0];
      if (enc) url = enc.getAttribute('url') || '';
      if (!url) {
        const links = Array.from(node.getElementsByTagName('link'));
        const pick = links.find(l => {
          const rel = String(l.getAttribute('rel') || '').toLowerCase();
          const href = String(l.getAttribute('href') || '');
          return rel === 'enclosure' || /\.(mp3|m4a|m4b|aac|ogg|opus|flac|wav)(\?|$)/i.test(href);
        });
        if (pick) url = pick.getAttribute('href') || '';
      }
      if (!url) {
        const mc = node.getElementsByTagName('media:content')[0];
        if (mc) url = mc.getAttribute('url') || '';
      }
      try { if (url) url = new URL(url, feedUrl).href; } catch {}
      const dateRaw = ((node.querySelector('pubDate') || {}).textContent || (node.querySelector('published') || {}).textContent || (node.querySelector('updated') || {}).textContent || '').trim();
      const ts = dateRaw ? new Date(dateRaw).getTime() : 0;
      const duration = durText(node.getElementsByTagName('itunes:duration')[0] && node.getElementsByTagName('itunes:duration')[0].textContent);
      let desc = '';
      const descEl = node.getElementsByTagName('description')[0] || node.getElementsByTagName('summary')[0] || node.getElementsByTagName('content:encoded')[0];
      if (descEl) desc = stripHtml(descEl.textContent || '').slice(0, 220);
      if (url) episodes.push({ title: t, url, ts: isNaN(ts) ? 0 : ts, duration, desc });
    });
    return { title: title.trim(), image, episodes };
  }

  function createPodcast(body, win) {
    body.innerHTML =
      '<div class="app pod-app">' +
        '<div class="app-toolbar">' +
          '<button class="btn" id="podSubs">' + U.icon('music') + ' 我的订阅</button>' +
          '<input class="input" id="podSearch" placeholder="搜索播客（中文 / 英文 / 节目名）…" style="flex:1;min-width:110px;max-width:340px;height:28px;font-size:10px" autocomplete="off">' +
          '<select class="input" id="podCountry" style="height:28px;font-size:10px;max-width:150px" aria-label="目录国家"></select>' +
          '<button class="btn primary" id="podGo">搜索</button>' +
          '<button class="btn" id="podTop">热门榜</button>' +
          '<button class="btn" id="podRss">粘贴 RSS</button>' +
          '<span class="spacer" style="flex:1"></span><span class="fine" id="podCount"></span>' +
        '</div>' +
        '<div class="media-layout">' +
          '<aside class="media-side"><div class="media-side-head" id="podSideHead">发现</div><div class="media-list" id="podResults"><div class="media-empty">搜索节目，或粘贴任意公开 RSS 地址。</div></div></aside>' +
          '<section class="media-main">' +
            '<div class="pod-hero" id="podHero">' +
              '<span class="eyebrow">PODCAST UPLINK // PUBLIC RSS</span>' +
              '<h3>选择一档播客</h3>' +
              '<p>目录来自 Apple Podcasts 公开索引，音频来自节目公开 RSS。需要登录或 DRM 的平台（如 Spotify、部分小宇宙节目）无法直接播放。</p>' +
              '<p class="fine">部分国家/地区的目录可能因当地网络或平台限制而连不上——这是网络问题，不是系统问题。可自备加速器/代理后重试；Windows 能访问的站点，这里同样能访问。</p>' +
              '<div class="pod-chips">' + ['新闻', '科技', '商业', '财经', '故事', '悬疑', '犯罪', '历史', '科学', '健康', '心理', '教育', '文化', '社会', '国际', '喜剧', '影视', '音乐', '体育', '儿童', '英语', '日语', '韩语', '粤语', '睡眠', '冥想', 'AI', '创业'].map(t => '<button class="chip-btn" data-pod-term="' + t + '">' + t + '</button>').join('') + '</div>' +
            '</div>' +
            '<div class="ep-list" id="epList"></div>' +
          '</section>' +
        '</div>' +
        '<div class="media-player">' +
          '<div class="mp-now"><b id="podNow">未播放</b><span id="podNowSub"></span></div>' +
          '<button class="icon-btn" id="podPlay" title="播放 / 暂停">' + U.icon('play') + '</button>' +
          '<input class="range mp-seek" type="range" id="podSeek" min="0" max="1000" value="0" aria-label="进度">' +
          '<span class="mp-time" id="podTime">0:00 / 0:00</span>' +
          '<input class="range mp-vol" type="range" id="podVol" min="0" max="100" value="80" aria-label="音量">' +
          '<select class="input mp-rate" id="podRate" aria-label="倍速"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>' +
          '<button class="icon-btn" id="podOpen" title="在真实浏览器打开音频">' + U.icon('external') + '</button>' +
        '</div>' +
        '<audio id="podAudio" preload="none"></audio>' +
        '<div class="app-status"><span id="podStatus">READY</span><span class="spacer" style="flex:1"></span><span>APPLE DIRECTORY · OPEN RSS</span></div>' +
      '</div>';

    const resultsEl = $('#podResults', body), hero = $('#podHero', body), epList = $('#epList', body);
    const audio = $('#podAudio', body), playBtn = $('#podPlay', body), seek = $('#podSeek', body), timeEl = $('#podTime', body);
    const nowEl = $('#podNow', body), nowSubEl = $('#podNowSub', body), statusEl = $('#podStatus', body);
    const searchEl = $('#podSearch', body), sideHead = $('#podSideHead', body), countEl = $('#podCount', body);
    let mode = 'search';
    let loadSeq = 0;
    let list = [];
    let shown = 120;
    let current = null;
    let episodes = [];
    let currentEpisode = null;
    let lastSave = 0;
    let hls = null;
    const positions = BC.store.get('pod.pos', {}) || {};
    const COUNTRIES = [
      ['ALL', '全球目录'], ['CN', '中国'], ['TW', '台湾'], ['HK', '香港'], ['SG', '新加坡'],
      ['US', '美国'], ['GB', '英国'], ['JP', '日本'], ['KR', '韩国'], ['DE', '德国'],
      ['FR', '法国'], ['ES', '西班牙'], ['IT', '意大利'], ['CA', '加拿大'], ['AU', '澳大利亚'],
      ['IN', '印度'], ['BR', '巴西'], ['MX', '墨西哥'], ['NL', '荷兰'], ['SE', '瑞典']
    ];
    $('#podCountry', body).innerHTML = COUNTRIES.map(c => '<option value="' + c[0] + '">' + c[1] + '</option>').join('');

    function status(text, kind) { setStatus(statusEl, text, kind); }

    function isSubbed(feedUrl) {
      return (BC.store.get('pod.subs', []) || []).some(s => s.feedUrl === feedUrl);
    }
    function subs() { return BC.store.get('pod.subs', []) || []; }

    function renderList() {
      sideHead.textContent = mode === 'subs' ? '我的订阅' : (mode === 'top' ? '热门榜单' : '发现');
      if (!list.length) {
        resultsEl.innerHTML = '<div class="media-empty">' + (mode === 'subs'
          ? '还没有订阅。搜索节目后点击 + 收藏。'
          : '没有结果。换一个关键词，或粘贴 RSS 地址。') + '</div>';
        return;
      }
      const visible = list.slice(0, shown);
      resultsEl.innerHTML = visible.map((p, i) =>
        '<div class="media-item" data-pod="' + i + '">' +
          '<span class="media-art" style="' + artBg(p.artworkUrl600 || p.artworkUrl100) + '">' + (p.artworkUrl600 || p.artworkUrl100 ? '' : U.icon('music')) + '</span>' +
          '<div class="media-info"><b>' + U.esc(p.collectionName || '未命名播客') + '</b><span>' + U.esc(p.artistName || '') +
            ((p.genres && p.genres.length) ? ' · ' + U.esc(genreNames(p.genres).slice(0, 2).join(' / ')) : '') + '</span></div>' +
          (p.feedUrl ? '<button class="icon-btn small" data-pod-sub="' + i + '" title="' + (isSubbed(p.feedUrl) ? '取消订阅' : '订阅') + '">' + U.icon(isSubbed(p.feedUrl) ? 'check' : 'plus') + '</button>' : '<span class="fine" title="点击读取节目后即可订阅">RSS</span>') +
        '</div>').join('') +
        (list.length > shown ? '<button class="btn small" data-pod-more style="margin:8px auto;display:block">加载更多（还有 ' + (list.length - shown) + ' 个）</button>' : '');
      countEl.textContent = list.length + ' 个节目';
    }

    function renderHero() {
      if (!current) return;
      const art = current.artworkUrl600 || current.artworkUrl100 || current.artwork || '';
      hero.innerHTML =
        '<div class="pod-hero-row">' +
          '<span class="media-art big" style="' + artBg(art) + '">' + (art ? '' : U.icon('mic')) + '</span>' +
          '<div class="pod-hero-info"><span class="eyebrow">PODCAST FEED</span><h3>' + U.esc(current.collectionName || 'RSS 播客') + '</h3>' +
            '<p>' + U.esc(current.artistName || '') + (episodes.length ? ' · ' + episodes.length + ' 集' : '') + '</p>' +
            '<div class="diag-actions">' +
              '<button class="btn primary" data-pod-subtoggle>' + (isSubbed(current.feedUrl) ? '已订阅' : '订阅节目') + '</button>' +
              '<button class="btn" data-pod-feed>在浏览器打开 RSS</button>' +
            '</div></div>' +
        '</div>';
    }

    function renderEpisodes() {
      if (!episodes.length) {
        epList.innerHTML = '<div class="media-empty">该源没有可播放的公开音频条目。</div>';
        return;
      }
      epList.innerHTML = episodes.map((ep, i) =>
        '<div class="ep-item' + (currentEpisode && currentEpisode.url === ep.url ? ' on' : '') + '">' +
          '<button class="ep-play" data-ep-play="' + i + '" title="播放">' + U.icon('play') + '</button>' +
          '<div class="ep-main"><b>' + U.esc(ep.title) + '</b>' +
            '<span>' + U.esc(ep.ts ? U.fmtDate(ep.ts) : '') + (ep.duration ? ' · ' + U.esc(ep.duration) : '') + '</span>' +
            (ep.desc ? '<p>' + U.esc(ep.desc) + '</p>' : '') + '</div>' +
        '</div>').join('');
    }

    async function openPodcast(p) {
      if (!p.feedUrl && p.collectionId) {
        status('RESOLVING RSS…', 'warn');
        try {
          const cc = p.country || 'US';
          const r = await A.proxyFetch('https://itunes.apple.com/lookup?' + new URLSearchParams({ id: String(p.collectionId), entity: 'podcast', country: cc }), 20000);
          const d = JSON.parse(r.text);
          const hit = (d.results || []).find(x => x.feedUrl);
          if (hit) p = Object.assign({}, p, { feedUrl: hit.feedUrl, collectionName: p.collectionName || hit.collectionName, artistName: p.artistName || hit.artistName });
        } catch (e) { status('RSS 解析失败: ' + e.message, 'err'); }
      }
      if (!p.feedUrl) { BC.toast('该节目没有公开 RSS，无法直接播放'); return; }
      current = p;
      episodes = [];
      renderHero();
      epList.innerHTML = '<div class="media-empty">读取节目单…</div>';
      status('LOADING FEED…', 'warn');
      try {
        const r = await A.proxyFetch(p.feedUrl, 25000);
        if (!r.ok) throw new Error('RSS 请求失败 HTTP ' + r.status);
        const feed = parseFeed(r.text, p.feedUrl);
        current = Object.assign({}, p, {
          collectionName: p.collectionName && p.collectionName !== 'RSS 播客' ? p.collectionName : (feed.title || p.collectionName),
          artwork: feed.image
        });
        episodes = feed.episodes;
        renderHero();
        renderEpisodes();
        status('FEED OK · ' + episodes.length + ' 集', 'ok');
      } catch (e) {
        status('读取失败: ' + e.message, 'err');
        epList.innerHTML = '<div class="media-empty">无法读取该 RSS：' + U.esc(e.message) + '<br>可能是网络不可达、防盗链或格式不受支持。</div>';
      }
    }

    async function search(term) {
      term = String(term || '').trim();
      if (!term) return;
      mode = 'search';
      const seq = ++loadSeq;
      shown = 120;
      const picked = $('#podCountry', body).value;
      const cjk = /[\u3400-\u9fff]/.test(term);
      const all = cjk ? ['CN', 'TW', 'HK', 'SG', 'US'] : ['US', 'GB', 'CN', 'JP', 'KR', 'DE', 'FR', 'ES', 'IT', 'CA', 'AU', 'IN', 'BR', 'MX', 'NL', 'SE'];
      const countries = picked === 'ALL' ? all : [picked];
      status('SEARCHING ' + countries.length + ' DIRECTORIES…', 'warn');
      resultsEl.innerHTML = '<div class="media-empty">正在聚合 ' + countries.length + ' 个国家/地区的 Apple Podcasts 目录…</div>';
      try {
        const batches = await Promise.all(countries.map(cc => itunes(term, cc, countries.length > 1 ? 100 : 200).then(d => (d.results || []).map(x => Object.assign({ country: cc }, x))).catch(() => [])));
        if (seq !== loadSeq || mode !== 'search') return;
        const seen = new Set();
        list = [];
        batches.flat().forEach(p => {
          if (!p.feedUrl) return;
          const key = p.collectionId || p.feedUrl;
          if (seen.has(key)) return;
          seen.add(key);
          list.push(p);
        });
        list.forEach(p => { p.genres = genreNames(p.genres); });
        renderList();
        status(list.length + ' 个节目 · ' + countries.length + ' 个目录', list.length ? 'ok' : 'warn');
      } catch (e) {
        resultsEl.innerHTML = '<div class="media-empty">目录请求失败：' + U.esc(e.message) + '</div>';
        status('搜索失败: ' + e.message, 'err');
      }
    }

    async function itunes(term, country, limit) {
      const url = 'https://itunes.apple.com/search?' + new URLSearchParams({ media: 'podcast', entity: 'podcast', term, limit: String(limit || 200), country });
      const r = await A.proxyFetch(url, 25000);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return JSON.parse(r.text);
    }

    function genreNames(g) {
      return (g || []).map(x => typeof x === 'string' ? x : (x && (x.name || x.genre)) || '').filter(Boolean);
    }

    function withDeadline(p, ms) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('目录响应超时')), ms);
        p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
      });
    }

    async function topChart(cc) {
      const url = 'https://rss.marketingtools.apple.com/api/v2/' + cc.toLowerCase() + '/podcasts/top/100/podcasts.json';
      const r = await A.proxyFetch(url, 9000);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      let d;
      try { d = JSON.parse(r.text); } catch { throw new Error('目录返回的不是 JSON'); }
      const raw = ((d.feed || {}).results) || [];
      if (!raw.length) throw new Error('该地区无热门榜');
      return raw.map(x => ({
        collectionId: x.id,
        collectionName: x.name,
        artistName: x.artistName,
        artworkUrl100: x.artworkUrl100,
        artworkUrl600: String(x.artworkUrl100 || '').replace(/100x100bb/, '600x600bb'),
        genres: x.genres || [],
        country: cc.toUpperCase(),
        feedUrl: ''
      }));
    }

    async function topFallback(cc) {
      const term = /^(CN|TW|HK)$/.test(cc) ? '播客' : 'podcast';
      const d = await itunes(term, cc, 100);
      return (d.results || []).filter(x => x.feedUrl).map(x => Object.assign({ country: cc }, x));
    }

    async function loadTop() {
      mode = 'top';
      const seq = ++loadSeq;
      shown = 120;
      const picked = $('#podCountry', body).value;
      const all = ['US', 'GB', 'JP', 'DE', 'FR', 'TW', 'CA', 'AU', 'IT', 'ES', 'IN', 'BR', 'SG', 'NL', 'SE', 'CN'];
      const countries = picked === 'ALL' ? all : [picked];
      list = [];
      resultsEl.innerHTML = '<div class="media-empty">正在读取 ' + countries.length + ' 个国家/地区的热门榜…</div>';
      status('LOADING TOP CHARTS · 0/' + countries.length, 'warn');
      const seen = new Set();
      let done = 0;
      const failed = [];
      function merge(items) {
        let added = 0;
        (items || []).forEach(p => {
          const key = p.collectionId || (p.collectionName + '|' + p.artistName);
          if (!key || seen.has(key)) return;
          seen.add(key);
          p.genres = genreNames(p.genres);
          list.push(p);
          added++;
        });
        return added;
      }
      async function loadOne(cc) {
        try {
          merge(await withDeadline(topChart(cc), 10500));
        } catch (e) {
          try { merge(await withDeadline(topFallback(cc), 10000)); }
          catch { failed.push(cc); }
        } finally {
          done++;
          if (seq !== loadSeq || mode !== 'top') return;
          renderList();
          status('LOADING TOP CHARTS · ' + done + '/' + countries.length + ' · ' + list.length + ' 个节目', 'warn');
        }
      }
      for (let i = 0; i < countries.length; i += 4) {
        await Promise.all(countries.slice(i, i + 4).map(loadOne));
        if (seq !== loadSeq || mode !== 'top') return;
      }
      renderList();
      status(list.length + ' 个热门节目 · ' + (countries.length - failed.length) + '/' + countries.length + ' 个目录'
        + (failed.length ? ' · 网络不可达: ' + failed.join(',') : '') + ' · 点击后自动解析 RSS',
        list.length ? 'ok' : 'warn');
      if (failed.length) BC.toast('部分国家/地区目录因当地网络限制不可达：' + failed.join(', ')
        + '。这是网络问题，不是系统问题；可自备加速器/代理后重试。Windows 能访问的站点这里同样能访问。', { kind: 'warn', ttl: 7000 });
    }

    function toggleSub(p) {
      if (!p.feedUrl) { BC.toast('该节目尚未解析出公开 RSS'); return; }
      const arr = subs();
      const i = arr.findIndex(x => x.feedUrl === p.feedUrl);
      if (i >= 0) arr.splice(i, 1);
      else arr.unshift({ collectionName: p.collectionName, artistName: p.artistName, feedUrl: p.feedUrl, artworkUrl600: p.artworkUrl600 || p.artworkUrl100 || '' });
      BC.store.set('pod.subs', arr);
      BC.toast(i >= 0 ? '已取消订阅' : '已订阅: ' + (p.collectionName || ''));
      if (current && current.feedUrl === p.feedUrl) renderHero();
      if (mode === 'subs') { list = subs(); renderList(); }
      else renderList();
    }

    function playEpisode(ep) {
      if (!ep.url) { BC.toast('该集没有公开音频地址'); return; }
      currentEpisode = ep;
      nowEl.textContent = ep.title;
      nowSubEl.textContent = (current && current.collectionName) || '';
      if (hls) { try { hls.destroy(); } catch { } hls = null; }
      const isHls = /\.m3u8(\?|$)/i.test(ep.url);
      if (isHls && window.Hls && Hls.isSupported()) {
        hls = new Hls({ enableWorker: true });
        hls.on(Hls.Events.ERROR, (ev, data) => {
          if (data && data.fatal) status('HLS 流错误: ' + data.type + ' / ' + (data.details || ''), 'err');
        });
        hls.loadSource(ep.url);
        hls.attachMedia(audio);
      } else if (isHls && !audio.canPlayType('application/vnd.apple.mpegurl')) {
        status('这是 HLS 流且当前内核不支持，请在真实浏览器打开。', 'warn');
        external(ep.url);
        return;
      } else {
        audio.src = ep.url;
      }
      const saved = positions[ep.url];
      if (saved && saved > 5) {
        audio.addEventListener('loadedmetadata', function once() {
          audio.removeEventListener('loadedmetadata', once);
          if (isFinite(audio.duration) && saved < audio.duration - 8) {
            audio.currentTime = saved;
            status('从上次位置继续 · ' + clock(saved), 'ok');
          }
        });
      }
      audio.play().then(() => status('PLAYING', 'ok')).catch(e => status('播放失败: ' + e.message + '（可能是防盗链或格式不支持）', 'err'));
      renderEpisodes();
    }

    $('#podGo', body).addEventListener('click', () => search(searchEl.value));
    $('#podTop', body).addEventListener('click', loadTop);
    searchEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search(searchEl.value); } });
    $('#podSubs', body).addEventListener('click', () => {
      mode = 'subs';
      ++loadSeq;
      list = subs();
      renderList();
      if (!list.length) status('NO SUBSCRIPTIONS', 'warn');
    });
    $('#podRss', body).addEventListener('click', async () => {
      const url = await BC.ui.prompt('添加 RSS 播客', '粘贴播客的 RSS / Atom 地址。系统会直接读取公开源，不经过第三方账号。', { placeholder: 'https://example.com/feed.xml', okText: '读取' });
      if (!url) return;
      if (!/^https?:\/\//i.test(url.trim())) { BC.toast('请输入 http/https 地址'); return; }
      openPodcast({ collectionName: 'RSS 播客', artistName: (() => { try { return new URL(url.trim()).hostname; } catch { return ''; } })(), feedUrl: url.trim(), artworkUrl600: '' });
    });
    resultsEl.addEventListener('click', e => {
      if (e.target.closest('[data-pod-more]')) { shown += 120; renderList(); return; }
      const sub = e.target.closest('[data-pod-sub]');
      if (sub) { e.stopPropagation(); const p = list[Number(sub.dataset.podSub)]; if (p) toggleSub(p); return; }
      const item = e.target.closest('[data-pod]');
      if (item) { const p = list[Number(item.dataset.pod)]; if (p) openPodcast(p); }
    });
    hero.addEventListener('click', e => {
      if (e.target.closest('[data-pod-subtoggle]')) { if (current) toggleSub(current); return; }
      if (e.target.closest('[data-pod-feed]')) { if (current) external(current.feedUrl); return; }
      const chip = e.target.closest('[data-pod-term]');
      if (chip) { searchEl.value = chip.dataset.podTerm; search(searchEl.value); }
    });
    epList.addEventListener('click', e => {
      const btn = e.target.closest('[data-ep-play]');
      if (!btn) return;
      const ep = episodes[Number(btn.dataset.epPlay)];
      if (ep) playEpisode(ep);
    });
    playBtn.addEventListener('click', () => {
      if (!audio.src) { BC.toast('先从节目单选择一集'); return; }
      if (audio.paused) audio.play().catch(e => status('播放失败: ' + e.message, 'err'));
      else audio.pause();
    });
    $('#podOpen', body).addEventListener('click', () => { if (audio.src) external(audio.src); });
    audio.addEventListener('play', () => { playBtn.innerHTML = U.icon('pause'); });
    audio.addEventListener('playing', () => status('PLAYING', 'ok'));
    audio.addEventListener('waiting', () => status('缓冲中… 网络较慢时会等待音频数据', 'warn'));
    audio.addEventListener('stalled', () => status('缓冲停滞 · 正在等待网络恢复；可换一集或使用代理', 'warn'));
    audio.addEventListener('canplay', () => status('READY · 可播放', 'ok'));
    audio.addEventListener('pause', () => { playBtn.innerHTML = U.icon('play'); });
    audio.addEventListener('ended', () => { playBtn.innerHTML = U.icon('play'); status('PLAYBACK ENDED', 'ok'); });
    audio.addEventListener('error', () => {
      const code = audio.error ? audio.error.code : 0;
      const map = { 1: '播放被中止', 2: '网络错误', 3: '音频解码失败', 4: '格式或地址不受支持' };
      status('音频加载失败: ' + (map[code] || ('code ' + code)) + '。可尝试在真实浏览器打开。', 'err');
      playBtn.innerHTML = U.icon('play');
    });
    audio.addEventListener('timeupdate', () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        seek.value = String(Math.round(audio.currentTime / audio.duration * 1000));
        timeEl.textContent = clock(audio.currentTime) + ' / ' + clock(audio.duration);
      } else {
        timeEl.textContent = clock(audio.currentTime) + ' / —';
      }
      if (currentEpisode && Date.now() - lastSave > 5000) {
        lastSave = Date.now();
        positions[currentEpisode.url] = Math.floor(audio.currentTime);
        const keys = Object.keys(positions);
        if (keys.length > 60) keys.slice(0, keys.length - 60).forEach(k => delete positions[k]);
        BC.store.set('pod.pos', positions);
      }
    });
    seek.addEventListener('input', () => {
      if (isFinite(audio.duration) && audio.duration > 0) audio.currentTime = audio.duration * Number(seek.value) / 1000;
    });
    $('#podVol', body).addEventListener('input', e => { audio.volume = Number(e.target.value) / 100; });
    $('#podRate', body).addEventListener('change', e => { audio.playbackRate = Number(e.target.value) || 1; });
    audio.volume = 0.8;

    win.setTitle('播客', 'PODCASTS');
    loadTop();
    return () => { if (hls) { try { hls.destroy(); } catch { } } try { audio.pause(); audio.src = ''; } catch {} };
  }

  BC.registerApp({
    id: 'podcast', name: '播客', en: 'PODCASTS', icon: 'mic', color: '#ff79b0',
    width: 900, height: 620, minWidth: 520, minHeight: 380, singleton: true,
    desc: 'Apple Podcasts 目录 · 公开 RSS 播放',
    mount(body, win) { return createPodcast(body, win); }
  });

  /* ================================================================ RADIO */
  function createRadio(body, win) {
    body.innerHTML =
      '<div class="app radio-app">' +
        '<div class="app-toolbar">' +
          '<input class="input" id="radSearch" placeholder="搜索电台 / 风格 / 国家…" style="flex:1;min-width:110px;max-width:300px;height:28px;font-size:10px" autocomplete="off">' +
          '<button class="btn primary" id="radGo">搜索</button>' +
          '<input class="input" id="radCustom" placeholder="粘贴任意网络流 URL（https://…/stream.mp3）" style="flex:1;min-width:140px;max-width:380px;height:28px;font-size:10px" autocomplete="off">' +
          '<button class="btn" id="radStream">播放流</button>' +
          '<span class="spacer" style="flex:1"></span><span class="fine" id="radCount"></span>' +
        '</div>' +
        '<div class="media-layout">' +
          '<aside class="media-side"><div class="media-side-head">收藏电台</div><div class="media-list" id="radFavs"><div class="media-empty">还没有收藏。点击电台卡片上的 + 收藏。</div></div></aside>' +
          '<section class="media-main">' +
            '<div class="pod-hero" id="radHero">' +
              '<span class="eyebrow">GLOBAL RADIO // INTERNET BANDS</span>' +
              '<h3>收听全球广播</h3>' +
              '<p>目录来自 Radio Browser 社区数据库（数万台公开网络电台），可按国家、语言、类型筛选并分页加载。物理 AM / FM / 短波 / 长波频段需要 SDR 接收硬件；本应用不能把普通网卡变成收音机。</p>' +
              '<div class="pod-chips" id="radTags">' +
                ['新闻', '爵士', '古典', '摇滚', '电子', '流行', '嘻哈', '民谣', '乡村', '蓝调', '金属', '宗教', '体育', '财经', '谈话', '喜剧', '儿童', '老歌', '中国', '日本', '韩国', '美国', '英国', '德国', '法国', '意大利', '西班牙', '俄罗斯', '印度', '巴西'].map(t => '<button class="chip-btn" data-rad-term="' + t + '">' + t + '</button>').join('') +
              '</div>' +
              '<div class="rad-web"><button class="btn small" id="radWebsdr">打开 WebSDR 公共短波接收机</button><span class="fine">远程共享硬件，覆盖 AM/FM/短波/长波；不是本机天线。</span></div>' +
            '</div>' +
            '<div class="rad-filters">' +
              '<select class="input" id="radCountry" aria-label="国家"><option value="">全部国家</option></select>' +
              '<select class="input" id="radLang" aria-label="语言"><option value="">全部语言</option></select>' +
              '<select class="input" id="radTagSel" aria-label="类型"><option value="">全部类型</option>' + ['news', 'jazz', 'classical', 'rock', 'pop', 'electronic', 'talk', 'sport', 'business', 'comedy', 'oldies', 'folk', 'metal', 'hip hop', 'country', 'blues', 'religion', 'kids'].map(t => '<option value="' + t + '">' + t + '</option>').join('') + '</select>' +
              '<select class="input" id="radSort" aria-label="排序"><option value="clickcount">最热门</option><option value="votes">投票最多</option><option value="lastcheckok">最近在线</option><option value="name">名称</option></select>' +
              '<button class="btn small primary" id="radApply">筛选</button>' +
              '<button class="btn small" id="radMore">加载更多</button>' +
              '<span class="fine" id="radFilterInfo"></span>' +
            '</div>' +
            '<div class="rad-grid" id="radGrid"><div class="media-empty">正在载入全球热门电台…</div></div>' +
          '</section>' +
        '</div>' +
        '<div class="media-player">' +
          '<div class="mp-now"><b id="radNow">未播放</b><span id="radNowSub"></span></div>' +
          '<button class="icon-btn" id="radPlay" title="播放 / 暂停">' + U.icon('play') + '</button>' +
          '<span class="mp-live" id="radLive">LIVE</span>' +
          '<span class="mp-time" id="radTime">流媒体</span>' +
          '<input class="range mp-vol" type="range" id="radVol" min="0" max="100" value="80" aria-label="音量">' +
          '<button class="icon-btn" id="radOpen" title="在真实浏览器打开流">' + U.icon('external') + '</button>' +
        '</div>' +
        '<audio id="radAudio" preload="none"></audio>' +
        '<div class="app-status"><span id="radStatus">READY</span><span class="spacer" style="flex:1"></span><span>RADIO BROWSER · PUBLIC STREAMS</span></div>' +
      '</div>';

    const grid = $('#radGrid', body), favsEl = $('#radFavs', body);
    const audio = $('#radAudio', body), playBtn = $('#radPlay', body), statusEl = $('#radStatus', body);
    const nowEl = $('#radNow', body), nowSubEl = $('#radNowSub', body);
    let stations = [];
    let current = null;
    let currentUrl = '';
    let hls = null;
    let offset = 0;
    let lastBatch = 0;
    let query = { term: '', country: '', language: '', tag: '', sort: 'clickcount' };
    const status = (t, k) => setStatus(statusEl, t, k);
    const countryTerms = { '中国': 'China', '日本': 'Japan', '韩国': 'South Korea', '美国': 'United States', '英国': 'United Kingdom', '德国': 'Germany', '法国': 'France', '意大利': 'Italy', '西班牙': 'Spain', '俄罗斯': 'Russia', '印度': 'India', '巴西': 'Brazil' };
    const tagTerms = { '新闻': 'news', '爵士': 'jazz', '古典': 'classical', '摇滚': 'rock', '电子': 'electronic', '流行': 'pop', '嘻哈': 'hip hop', '民谣': 'folk', '乡村': 'country', '蓝调': 'blues', '金属': 'metal', '宗教': 'religion', '体育': 'sport', '财经': 'business', '谈话': 'talk', '喜剧': 'comedy', '儿童': 'kids', '老歌': 'oldies' };

    function favorites() { return BC.store.get('rad.favs', []) || []; }
    function isFav(uuid) { return favorites().some(f => f.stationuuid === uuid); }
    function saveFavs(arr) { BC.store.set('rad.favs', arr); }

    function stationCard(st, i, source) {
      const fav = isFav(st.stationuuid);
      return '<div class="rad-card" data-rad="' + source + ':' + i + '">' +
        '<div class="rad-top"><span class="rad-dot"></span><b>' + U.esc(st.name || '未命名电台') + '</b>' +
          '<button class="icon-btn small" data-rad-fav="' + source + ':' + i + '" title="' + (fav ? '取消收藏' : '收藏') + '">' + U.icon(fav ? 'check' : 'plus') + '</button></div>' +
        '<div class="rad-meta">' + U.esc(st.country || '—') + (st.codec ? ' · ' + U.esc(st.codec) : '') + (st.bitrate ? ' · ' + st.bitrate + ' kbps' : '') + '</div>' +
        '<div class="rad-tags">' + U.esc(String(st.tags || '').split(',').filter(Boolean).slice(0, 4).join(' / ') || 'NO TAGS') + '</div>' +
      '</div>';
    }

    function renderFavs() {
      const arr = favorites();
      if (!arr.length) {
        favsEl.innerHTML = '<div class="media-empty">还没有收藏。点击电台卡片上的 + 收藏。</div>';
        return;
      }
      favsEl.innerHTML = arr.map((st, i) => stationCard(st, i, 'fav')).join('');
    }

    function renderStations() {
      if (!stations.length) {
        grid.innerHTML = '<div class="media-empty">没有结果。换一个关键词，或直接粘贴网络流地址。</div>';
        return;
      }
      grid.innerHTML = stations.map((st, i) => stationCard(st, i, 'net')).join('');
      $('#radCount', body).textContent = stations.length + ' 个电台';
    }

    async function rbFetch(path, params) {
      const mirrors = [
        'https://de1.api.radio-browser.info',
        'https://nl1.api.radio-browser.info',
        'https://at1.api.radio-browser.info',
        'https://fi1.api.radio-browser.info',
        'https://all.api.radio-browser.info'
      ];
      let lastErr = '';
      for (const base of mirrors) {
        try {
          const q = new URLSearchParams(params || {});
          const r = await A.proxyFetch(base + path + '?' + q, 9000);
          if (!r.ok) { lastErr = 'HTTP ' + r.status; continue; }
          const data = JSON.parse(r.text);
          if (Array.isArray(data)) return data;
          lastErr = '目录返回了非数组数据';
        } catch (e) { lastErr = e.message; }
      }
      throw new Error(lastErr || 'Radio Browser 目录不可达');
    }

    async function rbSearch(params) {
      return rbFetch('/json/stations/search', Object.assign({ limit: '100', hidebroken: 'true', order: 'clickcount', reverse: 'true' }, params));
    }

    async function loadFacets() {
      try {
        const [cs, ls] = await Promise.all([
          rbFetch('/json/countries', {}).catch(() => []),
          rbFetch('/json/languages', {}).catch(() => [])
        ]);
        const cSel = $('#radCountry', body), lSel = $('#radLang', body);
        const cVal = cSel.value, lVal = lSel.value;
        cs.filter(x => x.stationcount > 0).sort((a, b) => b.stationcount - a.stationcount).slice(0, 260).forEach(x => {
          const o = document.createElement('option');
          o.value = x.name; o.textContent = x.name + ' · ' + x.stationcount;
          cSel.appendChild(o);
        });
        ls.filter(x => x.stationcount > 0).sort((a, b) => b.stationcount - a.stationcount).slice(0, 180).forEach(x => {
          const o = document.createElement('option');
          o.value = x.name; o.textContent = x.name + ' · ' + x.stationcount;
          lSel.appendChild(o);
        });
        cSel.value = cVal; lSel.value = lVal;
      } catch { }
    }

    async function loadStations(reset) {
      if (reset) { offset = 0; stations = []; }
      const p = {
        limit: '100',
        hidebroken: 'true',
        order: query.sort || 'clickcount',
        reverse: query.sort === 'name' ? 'false' : 'true',
        offset: String(offset)
      };
      if (query.term) p.name = query.term;
      if (query.country) p.country = query.country;
      if (query.language) p.language = query.language;
      if (query.tag) p.tag = query.tag;
      status('LOADING RADIO BROWSER…', 'warn');
      if (reset) grid.innerHTML = '<div class="media-empty">正在载入目录…</div>';
      try {
        let data;
        try { data = await rbSearch(p); }
        catch (e1) {
          status('网络较慢，重试目录…', 'warn');
          await new Promise(r => setTimeout(r, 900));
          data = await rbSearch(p);
        }
        lastBatch = data.length;
        offset += data.length;
        stations = reset ? data : stations.concat(data);
        renderStations();
        const label = [query.term, query.country, query.language, query.tag].filter(Boolean).join(' · ') || '全球热门';
        $('#radFilterInfo', body).textContent = label;
        status(stations.length + ' 个电台 · ' + label, stations.length ? 'ok' : 'warn');
      } catch (e) {
        if (reset) grid.innerHTML = '<div class="media-empty">目录请求失败：' + U.esc(e.message) + '<br>网络层不可达时，仍可用上方“播放流”直接播放已知的音频流地址。</div>';
        status('目录失败: ' + e.message, 'err');
      }
    }

    function search(term) {
      const t = String(term || '').trim();
      query = {
        term: t,
        country: $('#radCountry', body).value,
        language: $('#radLang', body).value,
        tag: $('#radTagSel', body).value,
        sort: $('#radSort', body).value
      };
      loadStations(true);
    }

    function chipSearch(term) {
      const cSel = $('#radCountry', body), tSel = $('#radTagSel', body), sEl = $('#radSearch', body);
      if (countryTerms[term]) {
        const val = countryTerms[term];
        if (!Array.from(cSel.options).some(o => o.value === val)) {
          const o = document.createElement('option'); o.value = val; o.textContent = val; cSel.appendChild(o);
        }
        cSel.value = val; tSel.value = ''; sEl.value = '';
        query = { term: '', country: val, language: $('#radLang', body).value, tag: '', sort: $('#radSort', body).value };
      } else if (tagTerms[term]) {
        tSel.value = tagTerms[term]; cSel.value = ''; sEl.value = '';
        query = { term: '', country: '', language: $('#radLang', body).value, tag: tagTerms[term], sort: $('#radSort', body).value };
      } else {
        search(term);
        return;
      }
      loadStations(true);
    }

    function playStation(st) {
      const url = st.url_resolved || st.url;
      if (!url) { BC.toast('该电台没有可用流地址'); return; }
      current = st;
      currentUrl = url;
      if (hls) { try { hls.destroy(); } catch { } hls = null; }
      const isHls = /\.m3u8(\?|$)/i.test(url);
      if (isHls && window.Hls && Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hls.on(Hls.Events.ERROR, (ev, data) => {
          if (data && data.fatal) status('HLS 流错误: ' + data.type + ' / ' + (data.details || ''), 'err');
        });
        hls.loadSource(url);
        hls.attachMedia(audio);
      } else if (isHls && !audio.canPlayType('application/vnd.apple.mpegurl')) {
        status('检测到 HLS (.m3u8)，当前内核不支持，已在外部浏览器打开。', 'warn');
        external(url);
        return;
      } else {
        audio.src = url;
      }
      nowEl.textContent = st.name || '网络电台';
      nowSubEl.textContent = [st.country, st.codec, st.bitrate ? st.bitrate + ' kbps' : ''].filter(Boolean).join(' · ');
      audio.play().then(() => status('LIVE · ' + (st.name || ''), 'ok')).catch(e => status('播放失败: ' + e.message + '（流可能受地区限制或已离线）', 'err'));
    }

    function toggleFav(st) {
      if (!st.stationuuid) { BC.toast('该电台缺少唯一 ID，无法收藏'); return; }
      const arr = favorites();
      const i = arr.findIndex(x => x.stationuuid === st.stationuuid);
      if (i >= 0) arr.splice(i, 1);
      else arr.unshift({ stationuuid: st.stationuuid, name: st.name, url_resolved: st.url_resolved, url: st.url, country: st.country, codec: st.codec, bitrate: st.bitrate, tags: st.tags });
      saveFavs(arr);
      BC.toast(i >= 0 ? '已取消收藏' : '已收藏');
      renderFavs();
      renderStations();
    }

    $('#radGo', body).addEventListener('click', () => search($('#radSearch', body).value));
    $('#radSearch', body).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search(e.target.value); } });
    $('#radApply', body).addEventListener('click', () => search($('#radSearch', body).value));
    $('#radMore', body).addEventListener('click', () => {
      if (!lastBatch) { BC.toast('没有更多结果，或先执行一次筛选'); return; }
      loadStations(false);
    });
    $('#radCountry', body).addEventListener('change', () => search($('#radSearch', body).value));
    $('#radLang', body).addEventListener('change', () => search($('#radSearch', body).value));
    $('#radTagSel', body).addEventListener('change', () => search($('#radSearch', body).value));
    $('#radSort', body).addEventListener('change', () => search($('#radSearch', body).value));
    $('#radWebsdr', body).addEventListener('click', () => external('https://www.websdr.org/'));
    $('#radTags', body).addEventListener('click', e => {
      const chip = e.target.closest('[data-rad-term]');
      if (chip) chipSearch(chip.dataset.radTerm);
    });
    $('#radStream', body).addEventListener('click', () => {
      const input = $('#radCustom', body);
      const url = input.value.trim();
      if (!/^https?:\/\//i.test(url)) { BC.toast('请输入 http/https 音频流地址'); return; }
      playStation({ name: '自定义流', url_resolved: url, country: 'CUSTOM', codec: '', bitrate: 0, tags: 'CUSTOM STREAM' });
    });
    grid.addEventListener('click', e => {
      const fav = e.target.closest('[data-rad-fav]');
      if (fav) {
        e.stopPropagation();
        const [src, idx] = fav.dataset.radFav.split(':');
        const st = (src === 'net' ? stations : favorites())[Number(idx)];
        if (st) toggleFav(st);
        return;
      }
      const card = e.target.closest('[data-rad]');
      if (card) {
        const [src, idx] = card.dataset.rad.split(':');
        const st = (src === 'net' ? stations : favorites())[Number(idx)];
        if (st) playStation(st);
      }
    });
    favsEl.addEventListener('click', e => {
      const fav = e.target.closest('[data-rad-fav]');
      if (fav) {
        e.stopPropagation();
        const [, idx] = fav.dataset.radFav.split(':');
        const st = favorites()[Number(idx)];
        if (st) toggleFav(st);
        return;
      }
      const card = e.target.closest('[data-rad]');
      if (card) {
        const [, idx] = card.dataset.rad.split(':');
        const st = favorites()[Number(idx)];
        if (st) playStation(st);
      }
    });
    playBtn.addEventListener('click', () => {
      if (!audio.src) { BC.toast('先选择一个电台'); return; }
      if (audio.paused) audio.play().catch(e => status('播放失败: ' + e.message, 'err'));
      else audio.pause();
    });
    $('#radOpen', body).addEventListener('click', () => { if (currentUrl) external(currentUrl); });
    audio.addEventListener('play', () => { playBtn.innerHTML = U.icon('pause'); });
    audio.addEventListener('pause', () => { playBtn.innerHTML = U.icon('play'); });
    audio.addEventListener('error', () => {
      const code = audio.error ? audio.error.code : 0;
      const map = { 1: '播放被中止', 2: '网络错误', 3: '音频解码失败', 4: '格式或地址不受支持' };
      status('流加载失败: ' + (map[code] || ('code ' + code)) + '。电台可能离线、限制地区或使用 HLS。', 'err');
      playBtn.innerHTML = U.icon('play');
    });
    audio.addEventListener('playing', () => { status('LIVE STREAM', 'ok'); });
    audio.addEventListener('waiting', () => status('缓冲中… 电台服务器响应较慢', 'warn'));
    audio.addEventListener('stalled', () => status('流停滞 · 正在等待网络；可换台或使用代理', 'warn'));
    $('#radVol', body).addEventListener('input', e => { audio.volume = Number(e.target.value) / 100; });
    audio.volume = 0.8;

    renderFavs();
    loadFacets();
    loadStations(true);

    win.setTitle('网络电台', 'RADIO');
    return () => { if (hls) { try { hls.destroy(); } catch { } } try { audio.pause(); audio.src = ''; } catch {} };
  }

  BC.registerApp({
    id: 'radio', name: '网络电台', en: 'RADIO', icon: 'radio', color: '#5ffbf1',
    width: 920, height: 620, minWidth: 520, minHeight: 380, singleton: true,
    desc: '全球网络电台 · 自定义音频流',
    mount(body, win) { return createRadio(body, win); }
  });
})();