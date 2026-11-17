/* BATCAVE OS // 发布雷达：GitHub / GitCode 双平台新项目与新版本 */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;
  const NOTIFIED_KEY = 'bc.releaseFeed.notified';

  function openUrl(url) {
    if (!/^https:\/\//i.test(String(url || ''))) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function sourceName(id) { return id === 'gitcode' ? 'GitCode' : 'GitHub'; }

  function assetOf(platform) {
    if (!platform) return null;
    return platform.windowsAsset || (platform.assets || []).find(a => /\.zip$/i.test(a.name)) || (platform.assets || [])[0] || null;
  }

  function platformBlock(project, id) {
    const p = project.platforms && project.platforms[id];
    if (!p) {
      return '<section class="release-platform muted">' +
        '<div class="release-plat-head"><b>' + sourceName(id) + '</b><span>未发布</span></div>' +
        '<p class="release-plat-note">该平台暂未发现发行版。</p>' +
        '</section>';
    }
    const asset = assetOf(p);
    return '<section class="release-platform">' +
      '<div class="release-plat-head"><b>' + sourceName(id) + '</b><span>v' + U.esc(p.version) + '</span></div>' +
      '<div class="release-plat-meta">' +
        (p.published ? '<span>' + U.esc(U.fmtDate(p.published)) + '</span>' : '') +
        (asset ? '<span>' + U.esc(U.fmtBytes(asset.size)) + '</span>' : '') +
      '</div>' +
      '<div class="release-plat-actions">' +
        '<button class="btn small" data-rf-url="' + U.esc(p.releaseUrl) + '">发布页</button>' +
        (asset ? '<button class="btn small primary" data-rf-url="' + U.esc(asset.url) + '">下载' + (asset.windows ? ' Windows 包' : '') + '</button>' : '') +
      '</div>' +
      '</section>';
  }

  function projectCard(project, events) {
    const unseen = events.filter(e => e.repo === project.repo && !e.seen);
    const newest = unseen[0];
    const isProject = newest && newest.kind === 'project';
    const chips = [];
    if (newest) chips.push('<span class="release-new">' + (isProject ? '新项目' : '新版本') + '</span>');
    if (project.updateAvailable) chips.push('<span class="release-update">可更新</span>');
    if (project.latest) chips.push('<span class="chip">最新 v' + U.esc(project.latest) + '</span>');
    if (project.installed) chips.push('<span class="chip">本机 v' + U.esc(project.installed) + '</span>');

    const actions = [];
    if (project.updater === 'embedded' && project.app) {
      actions.push('<button class="btn small" data-rf-open="' + U.esc(project.app) + '">打开应用</button>');
      actions.push('<button class="btn small primary" data-rf-update="' + U.esc(project.app) + '">应用内更新</button>');
    } else if (project.updater === 'self') {
      actions.push('<button class="btn small primary" data-rf-self="1">系统更新中心</button>');
    }
    if (unseen.length) actions.push('<button class="btn small" data-rf-seen-repo="' + U.esc(project.repo) + '">标记已读</button>');

    return '<article class="release-card' + (unseen.length ? ' is-new' : '') + '" data-repo="' + U.esc(project.repo) + '">' +
      '<div class="release-head">' +
        '<div class="release-id">' +
          '<span class="release-category">' + U.esc(project.category) + '</span>' +
          '<b>' + U.esc(project.name) + '</b>' +
          '<span class="release-en">' + U.esc(project.en) + '</span>' +
        '</div>' +
        '<div class="release-chips">' + chips.join('') + '</div>' +
      '</div>' +
      '<p class="release-desc">' + U.esc(project.desc) + '</p>' +
      '<div class="release-repo">' + U.esc(project.repo) + ' · GitHub ↔ GitCode</div>' +
      '<div class="release-platforms">' + platformBlock(project, 'github') + platformBlock(project, 'gitcode') + '</div>' +
      (actions.length ? '<div class="release-actions">' + actions.join('') + '</div>' : '') +
      (project.releaseNotes ? '<details class="release-notes-wrap"><summary>更新说明</summary><pre class="release-notes">' + U.esc(project.releaseNotes) + '</pre></details>' : '') +
      '</article>';
  }

  function createFeed(body, win) {
    body.innerHTML =
      '<div class="releases-app">' +
        '<div class="releases-top">' +
          '<div class="releases-title">' +
            '<span class="releases-en">RELEASE RADAR // GITHUB ↔ GITCODE</span>' +
            '<h2>发布雷达</h2>' +
            '<p>监控两个平台的新项目与新版本。发现更新时桌面会提示；下载或更新时自行选择一个平台。</p>' +
          '</div>' +
          '<div class="releases-controls">' +
            '<button class="btn small" data-rf-check>立即检查</button>' +
            '<button class="btn small" data-rf-seen>全部已读</button>' +
          '</div>' +
        '</div>' +
        '<div class="releases-status" data-rf-status>正在读取双平台发布信息…</div>' +
        '<div class="releases-list" data-rf-list></div>' +
        '<div class="releases-foot">只读取公开 Release 元数据；下载地址指向 GitHub 或 GitCode 官方发布页。</div>' +
      '</div>';

    const list = body.querySelector('[data-rf-list]');
    const status = body.querySelector('[data-rf-status]');
    const checkBtn = body.querySelector('[data-rf-check]');
    const seenBtn = body.querySelector('[data-rf-seen]');
    let feed = null;
    let busy = false;
    let timer = null;

    function setStatus(html, cls) {
      status.className = 'releases-status' + (cls ? ' ' + cls : '');
      status.innerHTML = html;
    }

    function render() {
      if (!feed) return;
      const unseen = (feed.events || []).filter(e => !e.seen);
      const projects = feed.projects || [];
      const errors = feed.errors || [];
      setStatus(
        '<span class="chip">项目 ' + projects.length + '</span>' +
        '<span class="chip">未读发布 ' + unseen.length + '</span>' +
        '<span class="chip">更新 ' + (feed.updatedAt ? U.fmtDate(feed.updatedAt) : '—') + '</span>' +
        (errors.length ? '<span class="chip warn" title="' + U.esc(errors.join('\n')) + '">' + errors.length + ' 个源读取失败</span>' : ''),
        errors.length ? 'warn' : ''
      );
      if (!projects.length) {
        list.innerHTML = '<div class="releases-empty">尚无可读取的发行版。</div>';
        return;
      }
      list.innerHTML = projects.map(p => projectCard(p, feed.events || [])).join('');
    }

    async function load(force) {
      if (busy) return;
      busy = true;
      checkBtn.disabled = true;
      seenBtn.disabled = true;
      setStatus('<span class="term-spinner"></span> 正在读取双平台发布信息…');
      try {
        feed = force ? await A.releasesCheck() : await A.releasesFeed(false);
        render();
      } catch (e) {
        setStatus('读取失败：' + U.esc(e.message) + '。可以稍后重试，或直接访问两个平台的 Release 页面。', 'err');
      } finally {
        busy = false;
        checkBtn.disabled = false;
        seenBtn.disabled = false;
      }
    }

    async function markRepoSeen(repo) {
      const ids = (feed && feed.events || []).filter(e => !e.seen && e.repo === repo).map(e => e.id);
      if (!ids.length) return;
      try {
        await A.releasesSeen(ids);
        ids.forEach(id => { feed.events.find(e => e.id === id).seen = true; });
        render();
      } catch (e) { BC.toast('标记失败: ' + e.message); }
    }

    checkBtn.addEventListener('click', () => load(true));
    seenBtn.addEventListener('click', async () => {
      try {
        await A.releasesSeen([]);
        (feed && feed.events || []).forEach(e => { e.seen = true; });
        render();
      } catch (e) { BC.toast('标记失败: ' + e.message); }
    });

    list.addEventListener('click', e => {
      const urlBtn = e.target.closest('[data-rf-url]');
      if (urlBtn) { openUrl(urlBtn.dataset.rfUrl); return; }
      const openBtn = e.target.closest('[data-rf-open]');
      if (openBtn) { BC.openApp(openBtn.dataset.rfOpen); return; }
      const updBtn = e.target.closest('[data-rf-update]');
      if (updBtn) {
        const app = updBtn.dataset.rfUpdate;
        BC.openApp(app);
        setTimeout(() => document.dispatchEvent(new CustomEvent('bc:open-app-update', { detail: { app } })), 350);
        return;
      }
      if (e.target.closest('[data-rf-self]')) { BC.openApp('update'); return; }
      const seenRepo = e.target.closest('[data-rf-seen-repo]');
      if (seenRepo) markRepoSeen(seenRepo.dataset.rfSeenRepo);
    });

    win.setTitle('发布雷达', 'RELEASE RADAR');
    load(false);
    timer = setInterval(() => load(false), 15 * 60 * 1000);
    return () => { if (timer) clearInterval(timer); };
  }

  BC.registerApp({
    id: 'releases', name: '发布雷达', en: 'RELEASE RADAR', icon: 'radio', color: '#ffcf5c',
    width: 1080, height: 720, minWidth: 720, minHeight: 480, singleton: true,
    desc: 'GitHub / GitCode 新项目与新版本提示',
    mount(body, win) { return createFeed(body, win); }
  });

  function notifiedSet() {
    try { return new Set(JSON.parse(sessionStorage.getItem(NOTIFIED_KEY) || '[]')); }
    catch { return new Set(); }
  }
  function rememberNotified(ids) {
    try {
      const set = notifiedSet();
      ids.forEach(id => set.add(id));
      sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify(Array.from(set).slice(-200)));
    } catch { }
  }

  async function checkNotify() {
    if (!A.online || !BC.isLive()) return;
    try {
      const feed = await A.releasesFeed(false);
      const unseen = (feed.events || []).filter(e => !e.seen);
      if (!unseen.length) return;
      const notified = notifiedSet();
      const fresh = unseen.filter(e => !notified.has(e.id));
      if (!fresh.length) return;
      rememberNotified(fresh.map(e => e.id));
      const first = fresh[0];
      const text = fresh.length === 1
        ? (first.kind === 'project' ? '新项目：' : '新版本：') + first.name + ' v' + first.version
        : '检测到 ' + fresh.length + ' 条新发布：' + fresh.slice(0, 2).map(e => e.name).join('、') + (fresh.length > 2 ? ' 等' : '');
      const item = BC.ui.notify('发布雷达', text, { icon: 'radio', kind: 'ok', ttl: 15000 });
      if (!item) return;
      const box = item.querySelector('div');
      if (box) {
        const btn = document.createElement('button');
        btn.className = 'btn small primary';
        btn.textContent = '查看双平台';
        btn.style.marginTop = '6px';
        btn.addEventListener('click', () => { BC.openApp('releases'); item.remove(); });
        box.appendChild(btn);
      }
    } catch { }
  }

  (function armNotify() {
    let fast = setInterval(() => {
      if (!BC.isLive()) return;
      clearInterval(fast);
      fast = null;
      checkNotify();
    }, 2000);
    setTimeout(() => { if (fast) clearInterval(fast); }, 5 * 60 * 1000);
    setInterval(checkNotify, 15 * 60 * 1000);
  })();
})();
