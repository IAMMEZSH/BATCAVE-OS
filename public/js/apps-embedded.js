/* BATCAVE OS // 自带应用：TenSaint73OS + 环球报阁（本机子进程 + iframe） */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;

  function createEmbedded(cfg, body, win) {
    body.innerHTML =
      '<div class="app embedded-app">' +
        '<div class="embedded-bar">' +
          '<span class="embedded-badge">' + U.esc(cfg.en) + '</span>' +
          '<span class="embedded-title">' + U.esc(cfg.name) + '</span>' +
          '<span class="embedded-port">127.0.0.1:' + cfg.port + '</span>' +
          '<span class="embedded-version" data-eb-version>v' + U.esc(cfg.version || '—') + '</span>' +
          '<span class="spacer" style="flex:1"></span>' +
          '<button class="btn small primary" data-eb="start">启动</button>' +
          '<button class="btn small" data-eb="stop">停止</button>' +
          '<button class="btn small" data-eb="reload">重载</button>' +
          '<button class="btn small" data-eb="external">新窗口</button>' +
          '<button class="btn small" data-eb="update">更新</button>' +
        '</div>' +
        '<div class="embedded-stage">' +
          '<div class="embedded-splash" data-eb-splash>' +
            '<div class="term-spinner"></div>' +
            '<b>' + U.esc(cfg.name) + '</b>' +
            '<p>' + U.esc(cfg.desc) + '</p>' +
            '<span class="embedded-hint">首次启动会拉起本机子进程；数据存放于 BATCAVE 数据目录。</span>' +
          '</div>' +
          '<iframe class="embedded-frame hidden" title="' + U.esc(cfg.name) + '" allow="clipboard-read; clipboard-write"></iframe>' +
          '<div class="embedded-update hidden" data-eb-upd>' +
            '<div class="update-card">' +
              '<div class="update-card-head">' +
                '<div><h3>应用更新</h3><p>选择 GitHub 或 GitCode 获取官方 Windows x64 发布包；下载后校验 SHA-256，更新会保留用户数据并在失败时回滚。</p></div>' +
                '<button class="btn small" data-eb-upd-close>关闭</button>' +
              '</div>' +
              '<div class="update-meta" data-eb-upd-meta></div>' +
              '<div class="update-source-btns" data-eb-upd-sources>' +
                '<button data-eb-src="github">GitHub</button>' +
                '<button data-eb-src="gitcode">GitCode</button>' +
              '</div>' +
              '<div class="update-actions">' +
                '<button class="btn small primary" data-eb-upd-check>检查更新</button>' +
                '<button class="btn small primary hidden" data-eb-upd-apply>下载并更新</button>' +
              '</div>' +
              '<div class="update-progress hidden" data-eb-upd-progress>' +
                '<div class="update-progress-top"><span data-eb-upd-phase>IDLE</span><b data-eb-upd-pct>0%</b></div>' +
                '<div class="update-bar"><span data-eb-upd-bar></span></div>' +
                '<div class="update-progress-msg" data-eb-upd-msg></div>' +
              '</div>' +
              '<div class="update-banner hidden" data-eb-upd-note></div>' +
              '<div data-eb-upd-notes></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="embedded-foot">' + U.esc(cfg.footNote || '') + '</div>' +
        '<div class="app-status"><span data-eb-status class="ok">IDLE</span><span>' + U.esc(cfg.en) + ' · EMBEDDED</span><span class="spacer" style="flex:1"></span><span data-eb-url>—</span></div>' +
      '</div>';

    const frame = body.querySelector('.embedded-frame');
    const splash = body.querySelector('[data-eb-splash]');
    const statusEl = body.querySelector('[data-eb-status]');
    const urlEl = body.querySelector('[data-eb-url]');
    const versionEl = body.querySelector('[data-eb-version]');
    const updEl = body.querySelector('[data-eb-upd]');
    const updMeta = body.querySelector('[data-eb-upd-meta]');
    const updNotes = body.querySelector('[data-eb-upd-notes]');
    const updNote = body.querySelector('[data-eb-upd-note]');
    const updProgress = body.querySelector('[data-eb-upd-progress]');
    const updPhase = body.querySelector('[data-eb-upd-phase]');
    const updPct = body.querySelector('[data-eb-upd-pct]');
    const updBar = body.querySelector('[data-eb-upd-bar]');
    const updMsg = body.querySelector('[data-eb-upd-msg]');
    const updCheckBtn = body.querySelector('[data-eb-upd-check]');
    const updApplyBtn = body.querySelector('[data-eb-upd-apply]');
    let started = false;
    let appVersion = cfg.version || '';
    let updateSource = BC.store.get('embedded.source.' + cfg.id, 'gitcode');
    if (updateSource !== 'github' && updateSource !== 'gitcode') updateSource = 'gitcode';
    let lastCheck = null;
    let updBusy = false;
    let pollTimer = null;

    function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = cls || ''; }
    function setVersion(v) {
      appVersion = String(v || '');
      versionEl.textContent = 'v' + (appVersion || '—');
    }
    function sourceLabel(id) { return id === 'gitcode' ? 'GitCode' : 'GitHub'; }
    function renderSources() {
      body.querySelectorAll('[data-eb-src]').forEach(b => b.classList.toggle('active', b.dataset.ebSrc === updateSource));
      body.querySelectorAll('[data-eb-src]').forEach(b => { b.disabled = updBusy; });
    }
    function showNote(html, cls) {
      if (!html) { updNote.className = 'update-banner hidden'; updNote.innerHTML = ''; return; }
      updNote.className = 'update-banner' + (cls ? ' ' + cls : '');
      updNote.innerHTML = html;
    }
    function setProgress(phase, pct, msg) {
      updProgress.classList.remove('hidden');
      updPhase.textContent = phase || 'WORKING';
      updPct.textContent = Math.round(Number(pct) || 0) + '%';
      updBar.style.width = Math.max(0, Math.min(100, Number(pct) || 0)) + '%';
      updMsg.textContent = msg || '';
    }
    function renderCheck(r) {
      updMeta.innerHTML = [
        '当前 v' + (r.current || '—'),
        '最新 v' + (r.latest || '—'),
        sourceLabel(r.source),
        r.asset && r.asset.size ? U.fmtBytes(r.asset.size) : '',
        r.published ? '发布 ' + U.fmtDate(r.published) : ''
      ].filter(Boolean).map(x => '<span class="chip">' + U.esc(x) + '</span>').join('');
      if (r.fallbackFrom) {
        updateSource = r.source === 'gitcode' ? 'gitcode' : 'github';
        BC.store.set('embedded.source.' + cfg.id, updateSource);
      }
      if (!r.updateAvailable) {
        updNotes.innerHTML = '<div class="update-notes-text">当前已是最新版本 v' + U.esc(r.current || '') + '。</div>';
        updApplyBtn.classList.add('hidden');
        showNote('已是最新版本，无需更新。' + (r.fallbackFrom ? '（' + sourceLabel(r.fallbackFrom) + ' 不可用，已自动改用 ' + sourceLabel(r.source) + '）' : ''), '');
        setProgress('READY', 100, '');
        setTimeout(() => updProgress.classList.add('hidden'), 900);
        return;
      }
      updNotes.innerHTML = '<div class="update-notes-text">' + U.esc(r.notes || '此版本没有附加更新说明。') + '</div>';
      updApplyBtn.textContent = '下载并更新 v' + r.latest;
      updApplyBtn.classList.remove('hidden');
      updApplyBtn.disabled = false;
      showNote('<b>发现新版本 v' + U.esc(r.latest) + '</b> · 来源 ' + sourceLabel(r.source) + (r.fallbackFrom ? '（' + sourceLabel(r.fallbackFrom) + ' 不可用，已自动切换）' : '') + '。更新会重启该应用，用户数据保留。', '');
      setProgress('READY', 100, '校验通过，可以开始更新。');
      setTimeout(() => updProgress.classList.add('hidden'), 1200);
    }
    async function refreshStatus() {
      try {
        const st = await A.embeddedUpdateStatus(cfg.id);
        setVersion(st.current);
        return st;
      } catch { return null; }
    }
    async function checkForUpdates() {
      if (updBusy) return;
      updBusy = true;
      renderSources();
      updCheckBtn.disabled = true;
      updApplyBtn.classList.add('hidden');
      showNote('');
      setProgress('CHECKING', 2, '读取 ' + sourceLabel(updateSource) + ' 最新发布…');
      try {
        const r = await A.embeddedUpdateCheck(cfg.id, updateSource);
        lastCheck = r;
        setVersion(r.current);
        renderCheck(r);
      } catch (e) {
        showNote('检查失败：' + U.esc(e.message) + '<br>可以切换另一个源后重试。', 'update-error');
        setProgress('FAILED', 0, e.message || '检查失败');
      } finally {
        updBusy = false;
        updCheckBtn.disabled = false;
        renderSources();
      }
    }
    async function applyUpdate() {
      if (updBusy || !lastCheck || !lastCheck.updateAvailable) return;
      if (BC.ui && BC.ui.confirm) {
        const ok = await BC.ui.confirm('更新 ' + cfg.name,
          '将下载并安装 <b>v' + U.esc(lastCheck.latest) + '</b>，应用会停止并重启。用户数据、账号与配置会保留；失败会自动回滚。',
          { okText: '下载并更新', icon: 'download' });
        if (!ok) return;
      }
      updBusy = true;
      renderSources();
      updCheckBtn.disabled = true;
      updApplyBtn.disabled = true;
      updApplyBtn.classList.add('hidden');
      showNote('<b>正在更新</b> · 请勿关闭 BATCAVE；应用会在替换完成后自动重启。', '');
      setProgress('STARTING', 1, '准备下载…');
      try {
        const r = await A.embeddedUpdateApply(cfg.id, (lastCheck && lastCheck.source) || updateSource, lastCheck.latest);
        pollUpdateJob(r.jobId);
      } catch (e) {
        updBusy = false;
        updCheckBtn.disabled = false;
        updApplyBtn.disabled = false;
        updApplyBtn.classList.remove('hidden');
        renderSources();
        showNote('更新失败：' + U.esc(e.message), 'update-error');
        setProgress('FAILED', 0, e.message || '更新失败');
      }
    }
    async function pollUpdateJob(id) {
      try {
        const j = await A.embeddedUpdateJob(id);
        setProgress(String(j.phase || '').toUpperCase(), j.percent || 0, j.message || '');
        if (j.phase === 'done') {
          updBusy = false;
          updCheckBtn.disabled = false;
          updApplyBtn.disabled = false;
          updApplyBtn.classList.add('hidden');
          renderSources();
          if (j.version) setVersion(j.version);
          started = true;
          setStatus('RUNNING', 'ok');
          showNote('<b>更新完成</b> · ' + U.esc(cfg.name) + ' 已更新到 v' + U.esc(j.version || '') + '，用户数据已保留。', '');
          showFrame('http://127.0.0.1:' + cfg.port + (cfg.path || '/'));
          return;
        }
        if (j.phase === 'error') {
          updBusy = false;
          updCheckBtn.disabled = false;
          updApplyBtn.disabled = false;
          updApplyBtn.classList.remove('hidden');
          renderSources();
          showNote('更新失败：' + U.esc(j.error || j.message || '未知错误') + '<br>旧版本已保留或已自动恢复。', 'update-error');
          await refreshStatus();
          return;
        }
        pollTimer = setTimeout(() => pollUpdateJob(id), 700);
      } catch (e) {
        updBusy = false;
        updCheckBtn.disabled = false;
        updApplyBtn.disabled = false;
        renderSources();
        showNote('无法读取更新进度：' + U.esc(e.message), 'update-error');
      }
    }
    function openUpdatePanel() {
      updEl.classList.remove('hidden');
      renderSources();
      refreshStatus();
      checkForUpdates();
    }
    function showSplash(html) {
      splash.classList.remove('hidden');
      splash.innerHTML = html;
      frame.classList.add('hidden');
    }
    function showFrame(url) {
      splash.classList.add('hidden');
      frame.classList.remove('hidden');
      frame.src = url + '?embed=batcave&_r=' + Date.now();
      urlEl.textContent = url;
    }

    async function start() {
      setStatus('STARTING…', 'warn');
      showSplash('<div class="term-spinner"></div><b>' + U.esc(cfg.name) + '</b><p>正在启动 ' + U.esc(cfg.name) + '…</p>');
      try {
        const r = await A.embeddedStart(cfg.id);
        if (!r.ok) {
          setStatus('FAILED', 'err');
          showSplash('<b style="color:#ff8fa6">启动失败</b><p>' + U.esc(r.error || '未知错误') + '</p><pre class="embedded-log">' + U.esc(r.log || '') + '</pre>');
          return false;
        }
        started = true;
        if (r.version) setVersion(r.version);
        setStatus('RUNNING', 'ok');
        showFrame(r.url || ('http://127.0.0.1:' + cfg.port + (cfg.path || '/')));
        return true;
      } catch (e) {
        if (e.status === 403) {
          setStatus('SESSION REFRESH', 'warn');
          showSplash('<div class="term-spinner"></div><b>BATCAVE 会话已更新</b><p>检测到服务已重启，正在刷新页面并恢复本地应用。刷新后请重新点开此应用。</p>');
          return false;
        }
        setStatus('FAILED', 'err');
        showSplash('<b style="color:#ff8fa6">启动失败</b><p>' + U.esc(e.message) + '</p>');
        return false;
      }
    }

    async function stop() {
      setStatus('STOPPING…', 'warn');
      try {
        const r = await A.embeddedStop(cfg.id);
        started = false;
        frame.src = 'about:blank';
        frame.classList.add('hidden');
        setStatus(r.running ? 'STILL RUNNING' : 'STOPPED', r.running ? 'warn' : 'ok');
        showSplash('<b>' + U.esc(cfg.name) + '</b><p>已停止。点「启动」可重新运行。</p>');
      } catch (e) {
        setStatus('STOP FAILED', 'err');
        BC.toast('停止失败: ' + e.message);
      }
    }

    body.querySelector('[data-eb="start"]').addEventListener('click', start);
    body.querySelector('[data-eb="stop"]').addEventListener('click', stop);
    body.querySelector('[data-eb="reload"]').addEventListener('click', () => {
      if (!started) return start();
      frame.src = frame.src.split('?')[0] + '?embed=batcave&_r=' + Date.now();
      setStatus('RELOADED', 'ok');
    });
    body.querySelector('[data-eb="external"]').addEventListener('click', async () => {
      if (!started) { const ok = await start(); if (!ok) return; }
      window.open('http://127.0.0.1:' + cfg.port + (cfg.path || '/'), '_blank', 'noopener,noreferrer');
    });
    body.querySelector('[data-eb="update"]').addEventListener('click', openUpdatePanel);
    body.querySelector('[data-eb-upd-close]').addEventListener('click', () => updEl.classList.add('hidden'));
    body.querySelectorAll('[data-eb-src]').forEach(btn => btn.addEventListener('click', () => {
      if (updBusy) return;
      updateSource = btn.dataset.ebSrc === 'gitcode' ? 'gitcode' : 'github';
      BC.store.set('embedded.source.' + cfg.id, updateSource);
      renderSources();
      checkForUpdates();
    }));
    updCheckBtn.addEventListener('click', checkForUpdates);
    updApplyBtn.addEventListener('click', applyUpdate);

    win.setTitle(cfg.name, cfg.en);
    refreshStatus().then(() => start());
    return () => {
      if (pollTimer) clearTimeout(pollTimer);
      frame.src = 'about:blank';
    };
  }

  BC.registerApp({
    id: 'tensaint', name: 'TenSaint73OS', en: 'COMMAND NEXUS', icon: 'forge', color: '#63e6be',
    width: 1080, height: 700, minWidth: 640, minHeight: 420, singleton: true,
    desc: '自带社区系统 · 论坛/文件/会员 · 单管理员',
    mount(body, win) {
      return createEmbedded({
        id: 'tensaint', name: 'TenSaint73OS', en: 'COMMAND NEXUS', port: 7781, version: '1.8.0',
        desc: '自带运行的 TenSaint73OS：社区论坛、共享文件、会员与 AI 中枢。',
        footNote: '单管理员凭据不随发行包分发；如需最高管理员身份，请在 TenSaint73OS 内用你桌面保存的 .tsowner 凭据导入。'
      }, body, win);
    }
  });

  BC.registerApp({
    id: 'reading', name: '环球报阁', en: 'GLOBAL READING ROOM', icon: 'reader', color: '#8fb4c2',
    width: 1120, height: 720, minWidth: 680, minHeight: 440, singleton: true,
    desc: '自带全球报刊阅读 · RSS/翻译/朗读',
    mount(body, win) {
      return createEmbedded({
        id: 'reading', name: '环球报阁', en: 'GLOBAL READING ROOM', port: 7782, version: '1.3.0',
        desc: '多语种报刊阅读：RSS 抓取、正文抽取、翻译、朗读与导出。',
        footNote: '数据独立存放于 BATCAVE 数据目录；不携带任何原有阅读记录或账号数据。'
      }, body, win);
    }
  });

  BC.registerApp({
    id: 'codeforge', name: 'CodeForge AI', en: 'CODEFORGE AI 1.0.4', icon: 'forge', color: '#ff9b5c',
    width: 1200, height: 760, minWidth: 760, minHeight: 480, singleton: true,
    desc: '自带 AI 编程中枢 · 编译/运行/自修复',
    mount(body, win) {
      return createEmbedded({
        id: 'codeforge', name: 'CodeForge AI', en: 'CODEFORGE AI 1.0.4', port: 7790, version: '1.0.4',
        path: '/console/',
        desc: 'AI 编程中枢：项目浏览、编译运行、诊断与自修复。',
        footNote: '优先复用本机桌面 CodeForge-AI 安装（含模型与配置）；未检测到则运行发行包自带的精简版。'
      }, body, win);
    }
  });
})();