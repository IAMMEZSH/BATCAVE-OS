/* BATCAVE OS // 系统更新：GitHub / GitCode 程序层更新 */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;
  const SOURCES = [
    { id: 'github', label: 'GitHub' },
    { id: 'gitcode', label: 'GitCode' }
  ];
  const PHASES = {
    checking: 'CHECKING',
    downloading: 'DOWNLOADING',
    verifying: 'VERIFYING',
    extracting: 'EXTRACTING',
    validating: 'VALIDATING',
    applying: 'APPLYING',
    done: 'READY',
    error: 'FAILED'
  };

  function labelOf(id) {
    const s = SOURCES.find(x => x.id === id);
    return s ? s.label : String(id || '—');
  }

  function revOf(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
  }

  function buildOf(version, revision) {
    const r = revOf(revision);
    return 'v' + (version || '—') + (r ? ' · r' + r : '');
  }

  function checkKey(result) {
    return String(result.latest || '') + '-r' + revOf(result.latestRevision);
  }

  function notifyUpdate(result, auto) {
    const label = buildOf(result.latest, result.latestRevision);
    const item = BC.notify('发现 BATCAVE ' + label, auto
      ? '版本号已更新；本次修复三个内嵌应用一直加载的问题。打开系统更新查看说明并安装。'
      : '打开系统更新查看更新说明并安装。', { icon: 'download', kind: 'ok', ttl: auto ? 15000 : 8000 });
    if (!item) return;
    const box = item.querySelector('div');
    if (!box) return;
    const btn = document.createElement('button');
    btn.className = 'btn small primary';
    btn.textContent = '打开系统更新';
    btn.style.marginTop = '6px';
    btn.addEventListener('click', () => { BC.openApp('update'); item.remove(); });
    box.appendChild(btn);
  }

  function when(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d)) return String(value);
    return U.fmtDate(d);
  }

  function createUpdate(body, win) {
    body.innerHTML =
      '<div class="app update-app">' +
        '<div class="app-toolbar">' +
          '<span class="toolbar-title">系统更新</span><span class="toolbar-sub">UPDATE CENTER</span><span class="spacer" style="flex:1"></span>' +
          '<button class="btn small" id="updRefresh">' + U.icon('refresh') + ' 刷新状态</button>' +
        '</div>' +
        '<div class="update-body">' +
          '<section class="update-hero">' +
            '<div class="update-version"><span class="update-kicker">CURRENT BUILD</span><b id="updCurrent">—</b><span id="updCodename">—</span></div>' +
            '<div><span class="update-kicker">UPDATE SOURCE</span><div class="update-source-btns" id="updSources">' +
              SOURCES.map(s => '<button data-src="' + s.id + '">' + s.label + '</button>').join('') +
            '</div></div>' +
            '<button class="btn primary" id="updCheck">' + U.icon('download') + ' 检查更新</button>' +
          '</section>' +
          '<div id="updRestartBanner" class="update-banner hidden"><span><b>更新已安装</b> · 重启 BATCAVE 后生效，数据目录不会被覆盖。</span><button class="btn small primary" data-act="restart">立即重启</button></div>' +
          '<section class="update-card" id="updCard"><div class="update-card-head"><div><h3>连接更新源</h3><p>选择 GitHub 或 GitCode 获取版本清单。更新包会做 SHA-256 校验。</p></div></div></section>' +
          '<section class="update-progress hidden" id="updProgress">' +
            '<div class="update-progress-top"><span id="updPhase">IDLE</span><b id="updPct">0%</b></div>' +
            '<div class="update-bar"><span id="updBar"></span></div>' +
            '<div class="update-progress-msg" id="updMsg"></div>' +
            '<div class="update-actions"><button class="btn small primary hidden" data-act="restart" id="updRestartBtn">立即重启</button><button class="btn small hidden" data-act="retry" id="updRetryBtn">重试</button></div>' +
          '</section>' +
          '<section class="update-history"><h3>INSTALLED UPDATES</h3><div id="updHistory"><div class="update-foot">暂无更新记录。</div></div></section>' +
          '<p class="update-foot"><b>更新边界：</b>更新中心只替换 BATCAVE 程序层（server.js、lib、public、embedded、docs）。<b>data/</b>、内嵌应用数据、账号与凭据不会被下载包覆盖；Windows 基座补丁仍由 Windows Update 提供，不需要重装系统。更新源只接受本仓库在 GitHub / GitCode 的发布地址，并校验清单中的 SHA-256。</p>' +
        '</div>' +
        '<div class="update-reboot hidden" id="updReboot"><span class="spin"></span><b>正在重启 BATCAVE</b><span>页面会自动恢复。若超过 60 秒仍未恢复，请关闭窗口后重新打开 BATCAVE。</span></div>' +
      '</div>';

    const el = s => body.querySelector(s);
    let source = BC.store.get('update.source', 'github');
    if (!SOURCES.some(s => s.id === source)) source = 'github';
    let status = null;
    let check = null;
    let jobId = '';
    let timer = null;
    let busy = false;

    function renderSources() {
      body.querySelectorAll('[data-src]').forEach(b => b.classList.toggle('active', b.dataset.src === source));
    }

    function setBusy(next) {
      busy = next;
      el('#updCheck').disabled = next;
      body.querySelectorAll('[data-src]').forEach(b => { b.disabled = next; });
    }

    function fmtSize(n) {
      return n ? U.fmtBytes(n) : '—';
    }

    function renderHistory() {
      const rows = (status && status.history || []).slice(0, 8);
      el('#updHistory').innerHTML = rows.length
        ? rows.map(r => '<div class="update-history-row"><b>' + U.esc(buildOf(r.version, r.revision)) + '</b><span>' + U.esc(labelOf(r.source)) + ' · ' + U.esc(when(r.installedAt)) + (r.previousVersion ? ' · 来自 ' + U.esc(buildOf(r.previousVersion, r.previousRevision)) : '') + '</span></div>').join('')
        : '<div class="update-foot">暂无更新记录。</div>';
    }

    function renderStatus() {
      if (!status) return;
      el('#updCurrent').textContent = buildOf(status.current, status.currentRevision);
      el('#updCodename').textContent = status.codename || '';
      el('#updRestartBanner').classList.toggle('hidden', !status.restartRequired);
      renderHistory();
    }

    function notesBlock(notes) {
      return '<div class="update-notes-text">' + U.esc(notes || '此版本没有附加更新说明。') + '</div>';
    }

    function renderCheck() {
      const card = el('#updCard');
      if (!check) {
        card.innerHTML = '<div class="update-card-head"><div><h3>连接更新源</h3><p>选择 GitHub 或 GitCode 获取版本清单。更新包会做 SHA-256 校验。</p></div></div>';
        return;
      }
      const fallback = check.fallback ? '<div class="update-banner" style="margin:0 0 10px"><span><b>' + U.esc(labelOf(check.requestedSource)) + ' 暂不可用</b> · 已自动改用 ' + U.esc(labelOf(check.source)) + ' 的清单。</span></div>' : '';
      const pending = status && status.restartRequired && status.installed && status.installed.version;
      const pendingBuild = pending ? buildOf(pending, status.installed.revision) : '';
      if (pending && String(pending) === String(check.latest) && revOf(status.installed.revision) === revOf(check.latestRevision) && check.updateAvailable) {
        card.innerHTML =
          '<div class="update-card-head"><div><h3>' + U.esc(pendingBuild) + ' 已安装，等待重启</h3>' +
            '<p>文件已替换并通过校验。重启 BATCAVE 后载入新版本，当前进程仍是 ' + U.esc(buildOf(check.current, check.currentRevision)) + '。</p></div>' +
            '<span class="chip" style="color:var(--ok);border-color:rgba(77,255,184,.28)">READY</span></div>' +
          fallback +
          notesBlock((status.installed && status.installed.notes) || check.notes) +
          '<div class="update-actions"><button class="btn primary" data-act="restart">' + U.icon('restart') + ' 重启并载入 ' + U.esc(pendingBuild) + '</button></div>';
        return;
      }
      if (check.updateAvailable) {
        const sameVersion = String(check.latest) === String(check.current);
        card.innerHTML =
          '<div class="update-card-head"><div><h3>' + (sameVersion ? '发现修复更新 ' : '发现新版本 ') + U.esc(buildOf(check.latest, check.latestRevision)) + ' <span style="color:var(--acc)">' + U.esc(check.latestCodename || '') + '</span></h3>' +
            '<p>当前 ' + U.esc(buildOf(check.current, check.currentRevision)) + ' · 发布于 ' + U.esc(when(check.released)) + ' · 更新包 ' + U.esc(fmtSize(check.size)) + ' · 来源 ' + U.esc(labelOf(check.source)) + '</p></div>' +
            '<span class="chip">' + U.esc(PHASES.done) + '</span></div>' +
          fallback +
          '<div class="update-meta"><span class="chip">SHA-256 校验</span><span class="chip">保留 data/</span><span class="chip">可回滚备份</span></div>' +
          notesBlock(check.notes) +
          '<div class="update-actions"><button class="btn primary" data-act="apply">' + U.icon('download') + ' 下载并安装</button><button class="btn small" data-act="notes">完整更新说明</button><span class="spacer"></span><span class="update-foot">安装完成后重启即可，无需重装系统。</span></div>';
        return;
      }
      const ahead = check.latest && check.current && (check.latest !== check.current || revOf(check.latestRevision) < revOf(check.currentRevision));
      card.innerHTML =
        '<div class="update-card-head"><div><h3>' + (ahead ? '当前版本高于发布源' : '已是最新版本') + '</h3>' +
          '<p>当前 ' + U.esc(buildOf(check.current, check.currentRevision)) + ' ' + U.esc(check.codename || '') + ' · 发布源 ' + U.esc(buildOf(check.latest, check.latestRevision)) + ' · 检查时间 ' + U.esc(when(check.checkedAt)) + '</p></div>' +
          '<span class="chip" style="color:var(--ok);border-color:rgba(77,255,184,.28)">' + U.esc(ahead ? 'DEV' : 'LATEST') + '</span></div>' +
        fallback +
        '<div class="update-actions"><button class="btn small" data-act="notes">查看当前版本说明</button><span class="spacer"></span><span class="update-foot">更新源：' + U.esc(labelOf(check.source)) + '</span></div>' +
        notesBlock(check.notes);
    }

    function renderError(message) {
      el('#updCard').innerHTML =
        '<div class="update-card-head"><div><h3>暂时无法检查更新</h3><p>网络、镜像或发布源可能不可用。可以切换源后重试。</p></div><span class="chip" style="color:var(--danger)">OFFLINE</span></div>' +
        '<div class="update-banner update-error"><span><b>错误：</b>' + U.esc(message) + '</span></div>' +
        '<div class="update-actions"><button class="btn primary" data-act="check">重试</button><button class="btn small" data-act="switch">切换到 ' + U.esc(labelOf(source === 'github' ? 'gitcode' : 'github')) + '</button></div>';
    }

    function renderProgress(job) {
      el('#updProgress').classList.remove('hidden');
      el('#updPhase').textContent = PHASES[job.phase] || String(job.phase || '').toUpperCase();
      el('#updPct').textContent = Math.max(0, Math.min(100, Number(job.percent) || 0)) + '%';
      el('#updBar').style.width = Math.max(0, Math.min(100, Number(job.percent) || 0)) + '%';
      const bytes = job.total ? ' · ' + fmtSize(job.received || 0) + ' / ' + fmtSize(job.total) : '';
      el('#updMsg').textContent = (job.message || '') + bytes;
      el('#updRestartBtn').classList.toggle('hidden', job.phase !== 'done');
      el('#updRetryBtn').classList.toggle('hidden', job.phase !== 'error');
      el('#updProgress').classList.toggle('update-error', job.phase === 'error');
      if (job.phase === 'done') el('#updRestartBanner').classList.remove('hidden');
      if (job.phase === 'error') {
        el('#updMsg').textContent = job.error || job.message || '更新失败';
      }
    }

    async function loadStatus() {
      try {
        status = await A.updateStatus();
        renderStatus();
      } catch (e) {
        BC.toast('读取更新状态失败：' + e.message, { kind: 'err', ttl: 6000 });
      }
    }

    async function doCheck(auto) {
      if (busy) return;
      setBusy(true);
      check = null;
      el('#updCard').innerHTML = '<div class="update-card-head"><div><h3>正在连接 ' + U.esc(labelOf(source)) + '…</h3><p>读取 update/latest.json，比较版本并取得更新说明。</p></div></div>';
      try {
        check = await A.updateCheck(source);
        renderCheck();
        if (check.updateAvailable && !auto) notifyUpdate(check, false);
        if (check.updateAvailable && auto && BC.store.get('update.notified') !== checkKey(check)) {
          BC.store.set('update.notified', checkKey(check));
          notifyUpdate(check, true);
        }
      } catch (e) {
        renderError(e.message || String(e));
      } finally {
        setBusy(false);
        renderSources();
      }
    }

    async function doApply() {
      if (!check || !check.updateAvailable || busy) return;
      const label = buildOf(check.latest, check.latestRevision);
      const ok = await BC.ui.confirm('安装 BATCAVE ' + label, '将下载并替换程序层文件。data/、内嵌应用数据和账号不会被覆盖；安装完成后需要重启 BATCAVE。更新包会校验 SHA-256。', { okText: '下载并安装', danger: false });
      if (!ok) return;
      setBusy(true);
      el('#updProgress').classList.remove('hidden');
      el('#updBar').style.width = '0%';
      try {
        const res = await A.updateApply(check.source || source, check.latest, check.latestRevision);
        jobId = res.jobId;
        BC.toast('已开始下载更新');
        pollJob();
      } catch (e) {
        renderProgress({ phase: 'error', percent: 0, error: e.message, message: e.message });
        setBusy(false);
      }
    }

    function stopPoll() {
      if (timer) { clearInterval(timer); timer = null; }
    }

    function pollJob() {
      stopPoll();
      timer = setInterval(async () => {
        try {
          const job = await A.updateJob(jobId);
          if (!job) return;
          renderProgress(job);
          if (job.phase === 'done') {
            stopPoll();
            setBusy(false);
            await loadStatus();
            renderCheck();
            BC.notify('更新已安装', '重启 BATCAVE 后生效。', { icon: 'restart', kind: 'ok', ttl: 9000 });
          } else if (job.phase === 'error') {
            stopPoll();
            setBusy(false);
            BC.notify('更新失败', job.error || '请稍后重试。', { icon: 'alert', kind: 'err', ttl: 9000 });
          }
        } catch (e) {
          stopPoll();
          setBusy(false);
          renderProgress({ phase: 'error', percent: 0, error: e.message, message: e.message });
        }
      }, 700);
    }

    async function doRestart() {
      const ok = await BC.ui.confirm('重启 BATCAVE', '更新已写入磁盘。现在重启服务以载入新版本？页面会短暂断开并自动恢复。', { okText: '立即重启', danger: false });
      if (!ok) return;
      el('#updReboot').classList.remove('hidden');
      try { await A.updateRestart(); } catch (e) { /* the service may drop before replying */ }
      const pending = status && status.installed;
      const target = (check && (check.latest || check.current)) || (pending && pending.version) || (status && status.current) || '';
      const targetRevision = (check && check.latestRevision) || (pending && pending.revision) || 0;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const res = await fetch('/api/hello', { cache: 'no-store' });
          if (!res.ok) continue;
          const hello = await res.json();
          const server = hello.server || {};
          if (!target || (String(server.version) === String(target) && (!revOf(targetRevision) || revOf(server.revision) === revOf(targetRevision)))) { location.reload(); return; }
        } catch {}
      }
      el('#updReboot').innerHTML = '<b>重启超时</b><span>请关闭 BATCAVE 窗口，然后重新打开桌面快捷方式。更新文件已经安装，不会丢失数据。</span>';
    }

    function openNotes() {
      const url = check && check.notesUrl;
      if (!url) { BC.toast('该版本没有提供外部说明链接'); return; }
      BC.openApp('browser', { url });
    }

    body.querySelectorAll('[data-src]').forEach(b => b.addEventListener('click', () => {
      if (busy) return;
      source = b.dataset.src;
      BC.store.set('update.source', source);
      renderSources();
      doCheck(false);
    }));
    el('#updCheck').addEventListener('click', () => doCheck(false));
    el('#updRefresh').addEventListener('click', async () => { await loadStatus(); BC.toast('状态已刷新'); });
    body.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'apply') doApply();
      else if (act === 'notes') openNotes();
      else if (act === 'restart') doRestart();
      else if (act === 'retry') { el('#updProgress').classList.add('hidden'); doApply(); }
      else if (act === 'check') doCheck(false);
      else if (act === 'switch') { source = source === 'github' ? 'gitcode' : 'github'; BC.store.set('update.source', source); renderSources(); doCheck(false); }
    });

    renderSources();
    loadStatus().then(() => doCheck(true));
    win.setTitle('系统更新', 'UPDATE CENTER');
    return () => stopPoll();
  }

  let announced = false;
  async function announceUpdate() {
    if (announced || !BC.isLive || !BC.isLive()) return;
    try {
      const result = await A.updateCheck(BC.store.get('update.source', 'github'));
      if (!result || !result.ok) return;
      announced = true;
      if (!result.updateAvailable) return;
      const key = checkKey(result);
      if (BC.store.get('update.notified') === key) return;
      BC.store.set('update.notified', key);
      notifyUpdate(result, true);
    } catch { }
  }
  BC.checkUpdates = announceUpdate;

  BC.registerApp({
    id: 'update', name: '系统更新', en: 'UPDATE CENTER', icon: 'download', color: '#4dffb8',
    width: 820, height: 650, minWidth: 640, minHeight: 480, singleton: true,
    desc: '从 GitHub / GitCode 安全更新程序层，无需重装系统',
    mount(body, win) { return createUpdate(body, win); }
  });
})();
