/* BATCAVE OS // files + text editor */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function joinPath(dir, name) {
    return (String(dir || '/').replace(/\/+$/, '') || '') + '/' + String(name || '').replace(/^\/+/, '');
  }
  function looksLikeFile(path) {
    return /\.[a-z0-9]{1,10}$/i.test(String(path || ''));
  }

  function createFiles(body, win, params) {
    let path = (params && params.path) || '/';
    if (looksLikeFile(path)) path = U.dirName(path);
    let entries = [], selected = null, loadToken = 0;
    let backStack = [], forwardStack = [];
    let uploadInput = null;

    body.innerHTML =
      '<div class="app files-app">' +
        '<div class="app-toolbar">' +
          '<button class="icon-btn" data-nav="back" title="后退">' + U.icon('left') + '</button>' +
          '<button class="icon-btn" data-nav="fwd" title="前进">' + U.icon('right') + '</button>' +
          '<button class="icon-btn" data-nav="up" title="上一级">' + U.icon('up') + '</button>' +
          '<button class="icon-btn" data-nav="refresh" title="刷新">' + U.icon('refresh') + '</button>' +
          '<div class="breadcrumbs"></div>' +
          '<button class="icon-btn" data-act="newFolder" title="新建文件夹">' + U.icon('folder') + '</button>' +
          '<button class="icon-btn" data-act="newFile" title="新建文件">' + U.icon('plus') + '</button>' +
          '<button class="btn" data-act="upload">' + U.icon('upload') + '上传</button>' +
        '</div>' +
        '<div class="files-body">' +
          '<aside class="files-side">' +
            '<div class="side-label">LOCATIONS // 位置</div>' +
            '<button class="side-item on" data-path="/">' + U.icon('home') + 'Home</button>' +
            '<button class="side-item" data-path="/Projects">' + U.icon('forge') + 'Projects</button>' +
            '<button class="side-item" data-path="/Documents">' + U.icon('files') + 'Documents</button>' +
            '<button class="side-item" data-path="/Notes">' + U.icon('notes') + 'Notes</button>' +
            '<button class="side-item" data-path="/Uploads">' + U.icon('upload') + 'Uploads</button>' +
            '<div class="side-label">SYSTEM</div>' +
            '<button class="side-item" data-path="/Projects">' + U.icon('code') + 'Code Vault</button>' +
          '</aside>' +
          '<div class="files-main">' +
            '<div class="files-head"><span>名称</span><span>大小</span><span>修改时间</span></div>' +
            '<div class="file-list app-scroll" tabindex="0"></div>' +
            '<div class="app-status"><span id="fileStatus">加载中…</span><span class="spacer" style="flex:1"></span><span id="fileCount">—</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="drop-hint">' + U.icon('upload') + ' 释放以上传到 ' + U.esc(path) + '</div>' +
        '<input type="file" multiple hidden>' +
      '</div>';

    const app = $('.files-app', body);
    const listEl = $('.file-list', body);
    const crumbsEl = $('.breadcrumbs', body);
    const statusEl = $('#fileStatus', body);
    const countEl = $('#fileCount', body);
    const dropHint = $('.drop-hint', body);
    uploadInput = $('input[type=file]', body);

    function setStatus(text, cls) {
      statusEl.textContent = text;
      statusEl.className = cls || '';
    }
    function renderCrumbs() {
      const parts = path.split('/').filter(Boolean);
      let html = '<button class="crumb" data-crumb="/">' + 'HOME' + '</button>';
      let acc = '';
      parts.forEach(p => {
        acc += '/' + p;
        html += '<span class="crumb-sep">/</span><button class="crumb" data-crumb="' + U.esc(acc) + '">' + U.esc(p) + '</button>';
      });
      crumbsEl.innerHTML = html;
      $$('.crumb', crumbsEl).forEach(b => b.addEventListener('click', () => navigate(b.dataset.crumb)));
      $$('.side-item', app).forEach(b => b.classList.toggle('on', b.dataset.path === path));
    }
    function renderEntries() {
      listEl.innerHTML = '';
      if (!entries.length) {
        listEl.innerHTML = '<div class="empty-state" style="height:100%">' + U.icon('folder') + '<b>这里还没有文件</b><p>拖入文件即可上传，或使用右上角按钮新建。</p></div>';
      }
      const sorted = entries.slice().sort((a, b) => {
        const ad = a.dir ? 0 : 1, bd = b.dir ? 0 : 1;
        return ad !== bd ? ad - bd : String(a.name).localeCompare(String(b.name), 'zh');
      });
      sorted.forEach(ent => {
        const info = U.fileKind(ent);
        const row = document.createElement('div');
        row.className = 'file-row' + (selected === ent.path ? ' sel' : '');
        row.dataset.path = ent.path;
        row.tabIndex = 0;
        row.innerHTML =
          '<div class="file-name"><span class="app-ico" style="--iaccent:' + info.color + '">' + U.icon(info.icon) + '</span><b>' + U.esc(ent.name) + '</b></div>' +
          '<div class="file-meta">' + (ent.dir ? 'DIR' : U.fmtBytes(ent.size)) + '</div>' +
          '<div class="file-meta file-date"><span class="file-date-text">' + U.esc(U.fmtDate(ent.mtime)) + '</span>' +
            '<span class="file-actions">' +
              '<button class="icon-btn small" data-fa="rename" title="重命名">' + U.icon('edit') + '</button>' +
              '<button class="icon-btn small" data-fa="download" title="下载">' + U.icon('download') + '</button>' +
              '<button class="icon-btn small" data-fa="delete" title="删除">' + U.icon('trash') + '</button>' +
            '</span>' +
          '</div>';
        const rowClick = () => {
          selected = ent.path;
          $$('.file-row', listEl).forEach(x => x.classList.toggle('sel', x === row));
          setStatus((ent.dir ? '目录' : U.fmtBytes(ent.size)) + ' · ' + ent.path);
        };
        row.addEventListener('click', rowClick);
        row.addEventListener('dblclick', () => openEntry(ent));
        row.addEventListener('keydown', e => { if (e.key === 'Enter') openEntry(ent); });
        row.addEventListener('contextmenu', e => {
          e.preventDefault(); rowClick();
          BC.ui.contextMenu(e.clientX, e.clientY, [
            { label: '打开', icon: ent.dir ? 'folder' : 'right', action: () => openEntry(ent) },
            { label: '重命名', icon: 'edit', action: () => renameEntry(ent) },
            { label: '复制路径', icon: 'copy', action: async () => { await U.copy(ent.path); BC.toast('路径已复制'); } },
            { label: '下载', icon: 'download', action: () => downloadEntry(ent) },
            { sep: true },
            { label: '删除', icon: 'trash', danger: true, action: () => deleteEntry(ent) }
          ]);
        });
        $$('[data-fa]', row).forEach(btn => btn.addEventListener('click', e => {
          e.stopPropagation();
          const act = btn.dataset.fa;
          if (act === 'rename') renameEntry(ent);
          else if (act === 'download') downloadEntry(ent);
          else if (act === 'delete') deleteEntry(ent);
        }));
        listEl.appendChild(row);
      });
      countEl.textContent = entries.length + ' 项';
    }
    async function navigate(next, push) {
      if (!next) next = '/';
      const token = ++loadToken;
      setStatus('读取 ' + next + ' …');
      listEl.style.opacity = '.55';
      try {
        const res = await A.fsList(next);
        if (token !== loadToken) return;
        path = res.path || next;
        entries = res.entries || [];
        selected = null;
        if (push !== false) {
          if (path !== (backStack[backStack.length - 1] || '')) backStack.push(path);
          forwardStack = [];
        }
        renderCrumbs();
        renderEntries();
        dropHint.innerHTML = U.icon('upload') + ' 释放以上传到 ' + U.esc(path);
        win.setTitle('文件 · ' + (path === '/' ? 'Home' : U.baseName(path) || path), path);
        setStatus('就绪 · ' + path, 'ok');
        updateNav();
      } catch (e) {
        if (token !== loadToken) return;
        setStatus(e.message, 'err');
        BC.notify('无法打开目录', e.message, { icon: 'alert', kind: 'err' });
      } finally {
        listEl.style.opacity = '';
      }
    }
    function updateNav() {
      $('[data-nav="back"]', body).disabled = backStack.length < 1;
      $('[data-nav="fwd"]', body).disabled = forwardStack.length < 1;
      $('[data-nav="up"]', body).disabled = path === '/';
    }
    function openEntry(ent) {
      if (ent.dir) return navigate(ent.path);
      const info = U.fileKind(ent);
      if (info.kind === 'text' || info.kind === 'code') return BC.openApp('editor', { path: ent.path });
      if (info.kind === 'image') return BC.openApp('photos', { path: ent.path });
      if (info.kind === 'audio' || info.kind === 'video') return BC.openApp('player', { path: ent.path });
      downloadEntry(ent);
    }
    function downloadEntry(ent) {
      if (ent.dir) { BC.toast('目录无法直接下载'); return; }
      const a = document.createElement('a');
      a.href = A.rawUrl(ent.path, true);
      a.download = ent.name;
      document.body.appendChild(a); a.click(); a.remove();
    }
    async function renameEntry(ent) {
      const next = await BC.ui.prompt('重命名', '<p>当前路径：<code>' + U.esc(ent.path) + '</code></p>', { value: ent.name, okText: '重命名', icon: 'edit' });
      if (next == null) return;
      const name = String(next).trim();
      if (!name || name === ent.name) return;
      if (/[\\/]/.test(name)) { BC.toast('名称不能包含斜杠'); return; }
      try {
        const to = joinPath(U.dirName(ent.path), name);
        await A.fsRename(ent.path, to);
        BC.notify('已重命名', name, { icon: 'check', kind: 'ok' });
        selected = to;
        await navigate(path, false);
      } catch (e) { BC.notify('重命名失败', e.message, { icon: 'alert', kind: 'err' }); }
    }
    async function deleteEntry(ent) {
      const ok = await BC.ui.confirm('永久删除', '删除 <code>' + U.esc(ent.path) + '</code>？<br><br>此操作会直接作用于真实文件系统，无法从回收站恢复。', { okText: '删除', danger: true, icon: 'trash' });
      if (!ok) return;
      try {
        await A.fsRemove(ent.path);
        BC.notify('已删除', ent.name, { icon: 'trash', kind: 'ok' });
        await navigate(path, false);
      } catch (e) { BC.notify('删除失败', e.message, { icon: 'alert', kind: 'err' }); }
    }
    async function newFolder() {
      const name = await BC.ui.prompt('新建文件夹', '<p>位置：<code>' + U.esc(path) + '</code></p>', { value: 'New Folder', okText: '创建', icon: 'folder' });
      if (name == null || !String(name).trim()) return;
      try {
        await A.fsMkdir(joinPath(path, String(name).trim()));
        await navigate(path, false);
      } catch (e) { BC.notify('创建失败', e.message, { icon: 'alert', kind: 'err' }); }
    }
    async function newFile() {
      const name = await BC.ui.prompt('新建文件', '<p>位置：<code>' + U.esc(path) + '</code></p>', { value: 'untitled.txt', okText: '创建', icon: 'file' });
      if (name == null || !String(name).trim()) return;
      const vp = joinPath(path, String(name).trim());
      try {
        await A.fsWrite(vp, '');
        await navigate(path, false);
        BC.openApp('editor', { path: vp });
      } catch (e) { BC.notify('创建失败', e.message, { icon: 'alert', kind: 'err' }); }
    }
    async function uploadFiles(files) {
      if (!files || !files.length) return;
      let okCount = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const target = joinPath(path, f.name);
        setStatus('上传 ' + f.name + ' · 0%', '');
        try {
          await A.upload(target, f, p => setStatus('上传 ' + f.name + ' · ' + Math.round(p * 100) + '%', ''));
          okCount++;
        } catch (e) {
          BC.notify('上传失败', f.name + ' — ' + e.message, { icon: 'alert', kind: 'err' });
        }
      }
      if (okCount) BC.notify('上传完成', okCount + ' 个文件已写入 ' + path, { icon: 'upload', kind: 'ok' });
      await navigate(path, false);
    }

    $('[data-act="newFolder"]', body).addEventListener('click', newFolder);
    $('[data-act="newFile"]', body).addEventListener('click', newFile);
    $('[data-act="upload"]', body).addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', () => { uploadFiles(Array.from(uploadInput.files || [])); uploadInput.value = ''; });
    $$('[data-nav]', body).forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.nav;
      if (act === 'refresh') return navigate(path, false);
      if (act === 'up') return navigate(U.dirName(path), true);
      if (act === 'back') {
        if (backStack.length < 1) return;
        const current = path;
        const prev = backStack.length > 1 ? backStack[backStack.length - 2] : '/';
        backStack.pop();
        forwardStack.push(current);
        navigate(prev, false);
      }
      if (act === 'fwd') {
        const next = forwardStack.pop();
        if (next) { backStack.push(next); navigate(next, false); }
      }
    }));
    $$('.side-item', body).forEach(b => b.addEventListener('click', () => navigate(b.dataset.path, true)));
    app.addEventListener('dragover', e => { e.preventDefault(); app.classList.add('dragging'); });
    app.addEventListener('dragleave', e => { if (!app.contains(e.relatedTarget)) app.classList.remove('dragging'); });
    app.addEventListener('drop', e => {
      e.preventDefault(); app.classList.remove('dragging');
      const files = Array.from(e.dataTransfer.files || []);
      uploadFiles(files);
    });
    listEl.addEventListener('dragover', e => { e.preventDefault(); app.classList.add('dragging'); });
    listEl.addEventListener('drop', e => {
      e.preventDefault(); app.classList.remove('dragging');
      uploadFiles(Array.from(e.dataTransfer.files || []));
    });
    listEl.addEventListener('click', e => { if (e.target === listEl) { selected = null; $$('.file-row', listEl).forEach(x => x.classList.remove('sel')); } });

    win.onParams = (w, p) => {
      if (p && p.path) {
        const target = looksLikeFile(p.path) ? U.dirName(p.path) : p.path;
        navigate(target, true);
      }
    };
    updateNav();
    navigate(path, true);
    return () => { loadToken++; };
  }

  BC.registerApp({
    id: 'files', name: '文件', en: 'FILES', icon: 'files', color: '#ffcf5c',
    width: 900, height: 570, minWidth: 400, minHeight: 280, singleton: true,
    desc: '真实 Home 文件系统 · 上传下载',
    mount(body, win, params) { return createFiles(body, win, params); }
  });

  /* ---------------- editor ---------------- */
  function createEditor(body, win, params) {
    let vpath = params.path || '';
    let dirty = false;
    let saveTimer = null;

    body.innerHTML =
      '<div class="app">' +
        '<div class="app-toolbar">' +
          '<button class="icon-btn" data-ed="save" title="保存 (Ctrl+S)">' + U.icon('save') + '</button>' +
          '<button class="icon-btn" data-ed="download" title="下载">' + U.icon('download') + '</button>' +
          '<button class="icon-btn" data-ed="reveal" title="在文件中显示">' + U.icon('folder') + '</button>' +
          '<input class="input editor-path" value="' + U.esc(vpath) + '" placeholder="/Notes/untitled.md" spellcheck="false" aria-label="文件路径">' +
          '<button class="icon-btn" data-ed="forge" title="在 Code Forge 中打开">' + U.icon('forge') + '</button>' +
        '</div>' +
        '<div class="editor-wrap">' +
          '<div class="editor-gutter"><div class="editor-lines">1</div></div>' +
          '<textarea class="editor-area" spellcheck="false" wrap="off" placeholder="开始输入…"></textarea>' +
        '</div>' +
        '<div class="app-status"><span id="edStatus">就绪</span><span class="spacer" style="flex:1"></span><span id="edCount">0 行 · 0 字符</span><span id="edDirty"></span></div>' +
      '</div>';
    const pathInput = $('.editor-path', body);
    const area = $('.editor-area', body);
    const gutter = $('.editor-lines', body);
    const statusEl = $('#edStatus', body);
    const countEl = $('#edCount', body);
    const dirtyEl = $('#edDirty', body);

    function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = cls || ''; }
    function setDirty(v) {
      dirty = v;
      dirtyEl.textContent = v ? '未保存' : '';
      dirtyEl.className = v ? 'warn' : 'ok';
      win.setSub(v ? 'UNSAVED CHANGES' : (vpath || 'UNTITLED'));
    }
    function updateLines() {
      const val = area.value;
      const lines = val.split('\n').length;
      gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
      countEl.textContent = lines + ' 行 · ' + val.length + ' 字符';
      gutter.style.transform = 'translateY(' + (-area.scrollTop) + 'px)';
    }
    function updateTitle() {
      win.setTitle(vpath ? '编辑器 · ' + U.baseName(vpath) : '编辑器 · 未命名', vpath || 'UNTITLED');
    }
    async function loadFile(p) {
      if (!p) return;
      setStatus('加载 ' + p + ' …');
      try {
        const res = await A.fsRead(p);
        vpath = res.path || p;
        pathInput.value = vpath;
        area.value = res.content || '';
        setDirty(false);
        updateLines();
        updateTitle();
        setStatus('已加载 · ' + U.fmtBytes(res.size), 'ok');
        setTimeout(() => area.focus(), 60);
      } catch (e) {
        setStatus(e.message, 'err');
        BC.notify('无法打开文件', e.message, { icon: 'alert', kind: 'err' });
      }
    }
    async function save() {
      let target = pathInput.value.trim() || vpath;
      if (!target) {
        target = await BC.ui.prompt('保存到 Home', '<p>输入虚拟路径，例如 <code>/Notes/note.md</code>。</p>', { value: '/Notes/note-' + Date.now().toString(36) + '.md', okText: '保存', icon: 'save' });
        if (!target) return;
      }
      if (!target.startsWith('/')) target = '/' + target;
      setStatus('保存中…');
      try {
        await A.fsWrite(target, area.value);
        vpath = target;
        pathInput.value = target;
        setDirty(false);
        updateTitle();
        setStatus('已保存 · ' + new Date().toLocaleTimeString('zh-CN'), 'ok');
        BC.notify('文件已保存', target, { icon: 'save', kind: 'ok' });
      } catch (e) {
        setStatus(e.message, 'err');
        BC.notify('保存失败', e.message, { icon: 'alert', kind: 'err' });
      }
    }
    area.addEventListener('input', () => {
      if (!dirty) setDirty(true);
      updateLines();
    });
    area.addEventListener('scroll', () => { gutter.style.transform = 'translateY(' + (-area.scrollTop) + 'px)'; });
    area.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = area.selectionStart, en = area.selectionEnd;
        area.setRangeText('  ', s, en, 'end');
        setDirty(true); updateLines();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); save();
      }
    });
    pathInput.addEventListener('change', () => {
      updateTitle();
      if (dirty) setDirty(true);
    });
    $('[data-ed="save"]', body).addEventListener('click', save);
    $('[data-ed="download"]', body).addEventListener('click', () => {
      U.download(U.baseName(pathInput.value || 'untitled.txt'), area.value);
    });
    $('[data-ed="reveal"]', body).addEventListener('click', () => {
      const p = pathInput.value.trim() || vpath;
      BC.openApp('files', { path: p ? U.dirName(p) : '/' });
    });
    $('[data-ed="forge"]', body).addEventListener('click', () => {
      BC.openApp('forge', { code: area.value, filename: U.baseName(pathInput.value || 'main.js') });
    });

    updateLines();
    updateTitle();
    if (vpath) loadFile(vpath);
    else {
      area.value = '# SENTINEL NOTES\n\n';
      setDirty(true);
      updateLines();
      setTimeout(() => area.focus(), 80);
    }
    win.setTitle('编辑器 · ' + (vpath ? U.baseName(vpath) : '未命名'), vpath || 'UNTITLED');
    return () => { clearTimeout(saveTimer); };
  }

  BC.registerApp({
    id: 'editor', name: '编辑器', en: 'EDITOR', icon: 'editor', color: '#8fb4c2',
    width: 820, height: 580, minWidth: 380, minHeight: 260, singleton: false,
    desc: '真实文件读写 · UTF-8 文本编辑器',
    mount(body, win, params) { return createEditor(body, win, params); }
  });
})();