/* BATCAVE OS // 真实邮箱：QQ邮箱 / 网易163 / 126 / yeah（IMAP + SMTP） */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;

  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  }

  function addressLabel(s) {
    const v = String(s || '');
    const m = v.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
    return m ? (m[1].trim() || m[2]) : v.replace(/[<>]/g, '');
  }

  function createMail(body, win) {
    body.innerHTML =
      '<div class="app mail-app">' +
        '<div class="mail-head">' +
          '<div class="mail-brand"><span class="mail-mark">' + U.icon('mail') + '</span><div><b>邮箱</b><span>IMAP · SMTP · TLS</span></div></div>' +
          '<div class="mail-account" id="mailAccount"></div>' +
          '<div class="mail-head-actions">' +
            '<button class="btn small" id="mailRefresh" disabled>刷新</button>' +
            '<button class="btn small primary" id="mailComposeBtn" disabled>写邮件</button>' +
            '<button class="btn small" id="mailLogout" style="display:none">退出</button>' +
          '</div>' +
        '</div>' +
        '<div class="mail-main" id="mailMain">' +
          '<aside class="mail-folders" id="mailFolders"></aside>' +
          '<section class="mail-list-wrap">' +
            '<div class="mail-list-head"><b id="mailFolderName">收件箱</b><span id="mailCount"></span></div>' +
            '<div class="mail-list" id="mailList"><div class="mail-hint">连接邮箱后显示邮件。</div></div>' +
          '</section>' +
          '<section class="mail-read" id="mailRead"><div class="mail-hint">选择一封邮件阅读。</div></section>' +
        '</div>' +
        '<div class="mail-login" id="mailLogin">' +
          '<div class="mail-login-card">' +
            '<div class="mail-login-head"><span class="mail-mark big">' + U.icon('mail') + '</span><div><b>连接真实邮箱</b><span>邮件直接走服务商 IMAP/SMTP，不经过第三方服务器</span></div></div>' +
            '<label>邮箱地址</label><input class="input" id="mailEmail" placeholder="you@qq.com / you@163.com / you@126.com" autocomplete="username" spellcheck="false">' +
            '<label>授权码 / 密码</label><input class="input" id="mailPass" type="password" placeholder="邮箱客户端授权码（不是网页登录密码）" autocomplete="current-password">' +
            '<label>服务商</label><select class="input" id="mailProviderSel"><option value="">自动识别</option></select>' +
            '<div class="mail-provider-hint" id="mailProviderHint">QQ邮箱与网易邮箱需先在网页版开启 IMAP/SMTP 并生成授权码；授权码由你本人填入下方输入框，BATCAVE 不会索要、上传或写入磁盘。</div>' +
            '<div class="mail-login-actions"><button class="btn primary" id="mailLoginBtn">登录邮箱</button><span id="mailLoginState" class="note"></span></div>' +
            '<details class="mail-guide"><summary>如何获取 QQ / 网易授权码</summary>' +
              '<p><b>QQ邮箱：</b>mail.qq.com → 设置 → 账号 → 开启 IMAP/SMTP 服务 → 生成授权码。登录密码填授权码。</p>' +
              '<p><b>163 / 126 / yeah：</b>网页版 → 设置 → POP3/SMTP/IMAP → 开启 IMAP/SMTP → 新增客户端授权密码。</p>' +
              '<p>服务商可能要求短信验证。授权码只由你本人在本机输入；BATCAVE 不提供代填、不绕过邮箱安全策略，也不会把授权码写入磁盘或日志；授权码只在内存中保留到退出或 30 分钟过期。</p>' +
            '</details>' +
          '</div>' +
        '</div>' +
        '<div class="mail-compose" id="mailCompose">' +
          '<div class="mail-compose-head"><b>写邮件</b><span id="mailComposeFrom"></span><button class="btn small" id="mailComposeClose">关闭</button></div>' +
          '<div class="mail-compose-body">' +
            '<label>收件人</label><input class="input" id="mailTo" placeholder="多个收件人用逗号分隔">' +
            '<label>主题</label><input class="input" id="mailSubject" placeholder="主题">' +
            '<label>正文</label><textarea class="input mail-textarea" id="mailBody" placeholder="写点什么…"></textarea>' +
          '</div>' +
          '<div class="mail-compose-foot"><span id="mailSendState" class="note"></span><button class="btn" id="mailSendBtn">发送</button></div>' +
        '</div>' +
        '<div class="app-status"><span id="mailStatus" class="ok">OFFLINE</span><span id="mailServerInfo">IMAP · SMTP</span><span style="flex:1"></span><span id="mailSessionInfo"></span></div>' +
      '</div>';

    const els = {
      account: body.querySelector('#mailAccount'),
      main: body.querySelector('#mailMain'),
      folders: body.querySelector('#mailFolders'),
      folderName: body.querySelector('#mailFolderName'),
      count: body.querySelector('#mailCount'),
      list: body.querySelector('#mailList'),
      read: body.querySelector('#mailRead'),
      login: body.querySelector('#mailLogin'),
      email: body.querySelector('#mailEmail'),
      pass: body.querySelector('#mailPass'),
      providerSel: body.querySelector('#mailProviderSel'),
      providerHint: body.querySelector('#mailProviderHint'),
      loginBtn: body.querySelector('#mailLoginBtn'),
      loginState: body.querySelector('#mailLoginState'),
      status: body.querySelector('#mailStatus'),
      serverInfo: body.querySelector('#mailServerInfo'),
      sessionInfo: body.querySelector('#mailSessionInfo'),
      refresh: body.querySelector('#mailRefresh'),
      composeBtn: body.querySelector('#mailComposeBtn'),
      logout: body.querySelector('#mailLogout'),
      compose: body.querySelector('#mailCompose'),
      composeFrom: body.querySelector('#mailComposeFrom'),
      to: body.querySelector('#mailTo'),
      subject: body.querySelector('#mailSubject'),
      bodyText: body.querySelector('#mailBody'),
      sendBtn: body.querySelector('#mailSendBtn'),
      sendState: body.querySelector('#mailSendState'),
      composeClose: body.querySelector('#mailComposeClose')
    };

    let providers = [];
    let session = null;
    let account = null;
    let folders = [];
    let currentFolder = 'INBOX';
    let messages = [];
    let busy = false;

    function setStatus(text, cls) { els.status.textContent = text; els.status.className = cls || ''; }
    function setLoginState(text, cls) { els.loginState.textContent = text || ''; els.loginState.className = 'note ' + (cls || ''); }
    function showLogin(show) { els.login.style.display = show ? 'flex' : 'none'; }
    function setBusy(v) {
      busy = v;
      els.refresh.disabled = v || !session;
      els.composeBtn.disabled = v || !session;
      els.loginBtn.disabled = v;
      els.sendBtn.disabled = v;
    }

    function providerById(id) { return providers.find(p => p.id === id); }
    function guessProvider(email) {
      const domain = String(email || '').split('@')[1] || '';
      return providers.find(p => p.domains.includes(domain.toLowerCase())) || null;
    }
    function updateHint() {
      const manual = providerById(els.providerSel.value);
      const p = manual || guessProvider(els.email.value);
      els.providerHint.textContent = p ? p.hint : 'QQ邮箱与网易邮箱需先在网页版开启 IMAP/SMTP 并生成授权码。凭据仅保留在内存，不写盘、不记录日志。';
    }

    async function loadProviders() {
      try {
        const r = await A.mailProviders();
        providers = r.providers || [];
        for (const p of providers) {
          const o = document.createElement('option');
          o.value = p.id;
          o.textContent = p.name + ' · ' + p.imap;
          els.providerSel.appendChild(o);
        }
      } catch (e) {
        els.providerHint.textContent = '无法读取服务商列表：' + e.message;
      }
    }

    function renderAccount() {
      if (!account) {
        els.account.innerHTML = '';
        els.sessionInfo.textContent = '';
        els.serverInfo.textContent = 'IMAP · SMTP';
        els.logout.style.display = 'none';
        return;
      }
      els.account.innerHTML = '<span class="mail-account-email">' + U.esc(account.email) + '</span><span class="mail-account-provider">' + U.esc(account.provider.name) + '</span>';
      els.sessionInfo.textContent = '会话仅内存 · 30 分钟过期';
      els.serverInfo.textContent = account.provider.name + ' · TLS';
      els.logout.style.display = '';
      els.composeFrom.textContent = account.email;
    }

    function renderFolders() {
      els.folders.innerHTML = '<div class="mail-folder-head">文件夹</div>' +
        folders.map(f => {
          const active = f.name === currentFolder;
          return '<button class="mail-folder' + (active ? ' active' : '') + '" data-folder="' + U.esc(f.name) + '" title="' + U.esc(f.name) + '">' +
            '<span>' + U.esc(f.display || f.name) + '</span>' + (/\\Sent/i.test(f.flags) ? '<em>已发送</em>' : /\\Drafts/i.test(f.flags) ? '<em>草稿</em>' : /\\Trash/i.test(f.flags) ? '<em>垃圾箱</em>' : '') +
          '</button>';
        }).join('');
      els.folders.querySelectorAll('[data-folder]').forEach(b => b.addEventListener('click', () => loadFolder(b.dataset.folder)));
    }

    function renderList() {
      if (!messages.length) {
        els.list.innerHTML = '<div class="mail-hint">这个文件夹没有邮件。</div>';
        els.count.textContent = '0 封';
        return;
      }
      els.count.textContent = messages.length + ' 封';
      els.list.innerHTML = messages.map((m, i) =>
        '<button class="mail-item' + (m.seen ? '' : ' unseen') + '" data-mail="' + i + '">' +
          '<div class="mail-item-top"><b>' + U.esc(addressLabel(m.from)) + '</b><span>' + U.esc(fmtDate(m.date)) + '</span></div>' +
          '<div class="mail-item-subject">' + U.esc(m.subject) + '</div>' +
          '<div class="mail-item-meta">' + (m.size ? Math.max(1, Math.round(m.size / 1024)) + ' KB' : '') + (m.seen ? '' : ' · 未读') + '</div>' +
        '</button>'
      ).join('');
      els.list.querySelectorAll('[data-mail]').forEach(b => b.addEventListener('click', () => openMessage(messages[Number(b.dataset.mail)])));
    }

    function renderReadEmpty(text) {
      els.read.innerHTML = '<div class="mail-hint">' + U.esc(text || '选择一封邮件阅读。') + '</div>';
    }

    async function loadFolder(folder) {
      if (!session || busy) return;
      currentFolder = folder || 'INBOX';
      const f = folders.find(x => x.name === currentFolder);
      els.folderName.textContent = f ? (f.display || f.name) : currentFolder;
      renderFolders();
      els.list.innerHTML = '<div class="mail-hint"><span class="term-spinner"></span> 正在通过 IMAP 读取…</div>';
      els.count.textContent = '';
      setBusy(true);
      setStatus('FETCHING…', 'warn');
      try {
        const r = await A.mailList(session, currentFolder, 40);
        messages = r.messages || [];
        renderList();
        renderReadEmpty('选择一封邮件阅读。');
        setStatus('READY · ' + messages.length, 'ok');
      } catch (e) {
        els.list.innerHTML = '<div class="mail-hint err">读取失败：' + U.esc(e.message) + '</div>';
        setStatus('FETCH FAILED', 'err');
        if (/会话已过期|重新登录/.test(e.message)) toLogin('会话已过期，请重新登录。');
      } finally { setBusy(false); }
    }

    async function openMessage(m) {
      if (!session || busy) return;
      els.read.innerHTML = '<div class="mail-hint"><span class="term-spinner"></span> 正在获取邮件正文…</div>';
      setBusy(true);
      setStatus('OPENING…', 'warn');
      try {
        const r = await A.mailRead(session, currentFolder, m.uid);
        const msg = r.message;
        m.seen = true;
        renderList();
        els.read.innerHTML =
          '<div class="mail-read-head">' +
            '<h2>' + U.esc(msg.subject) + '</h2>' +
            '<div class="mail-read-meta"><span>发件人：' + U.esc(addressLabel(msg.from)) + '</span><span>收件人：' + U.esc(msg.to || account.email) + '</span><span>' + U.esc(fmtDate(msg.date)) + '</span></div>' +
          '</div>' +
          '<div class="mail-read-body" id="mailBodyView"></div>' +
          (msg.attachments && msg.attachments.length ? '<div class="mail-attach">附件：' + msg.attachments.map(a => '<span>' + U.esc(a.filename) + ' · ' + Math.max(1, Math.round(a.size / 1024)) + ' KB</span>').join('') + '</div>' : '');
        const view = els.read.querySelector('#mailBodyView');
        if (msg.html) {
          const doc = '<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{font-family:system-ui,"Segoe UI",sans-serif;font-size:14px;line-height:1.7;color:#e8f4f8;background:#08141a;margin:0;padding:16px;word-break:break-word}a{color:#5ffbf1}img{max-width:100%;height:auto}blockquote{border-left:2px solid #2a4a56;margin:8px 0;padding-left:10px;color:#9fb8c2}pre{white-space:pre-wrap}</style></head><body>' + msg.html + '</body></html>';
          const iframe = document.createElement('iframe');
          iframe.className = 'mail-html-frame';
          iframe.setAttribute('sandbox', '');
          iframe.setAttribute('referrerpolicy', 'no-referrer');
          iframe.srcdoc = doc;
          view.appendChild(iframe);
        } else {
          const pre = document.createElement('pre');
          pre.className = 'mail-text-body';
          pre.textContent = msg.text || '(无正文)';
          view.appendChild(pre);
        }
        setStatus('READY', 'ok');
        if (window.innerWidth <= 900) requestAnimationFrame(() => els.read.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      } catch (e) {
        els.read.innerHTML = '<div class="mail-hint err">读取失败：' + U.esc(e.message) + '</div>';
        setStatus('READ FAILED', 'err');
      } finally { setBusy(false); }
    }

    async function doLogin() {
      if (busy) return;
      const email = els.email.value.trim();
      const password = els.pass.value;
      if (!email) return setLoginState('请输入邮箱地址', 'err');
      if (!password) return setLoginState('请输入授权码/密码', 'err');
      setBusy(true);
      setLoginState('正在连接 IMAP（TLS）…', 'warn');
      setStatus('CONNECTING…', 'warn');
      try {
        const r = await A.mailLogin(email, password, els.providerSel.value || undefined);
        session = r.session;
        account = { email: r.email, provider: r.provider };
        folders = r.folders || [];
        currentFolder = 'INBOX';
        els.pass.value = '';
        showLogin(false);
        renderAccount();
        renderFolders();
        els.folderName.textContent = '收件箱';
        setLoginState('', '');
        setBusy(false);
        await loadFolder('INBOX');
        BC.toast('已连接 ' + r.provider.name + '：' + r.email + '（IMAP 登录成功）', { kind: 'ok', ttl: 4200 });
      } catch (e) {
        setLoginState(e.message, 'err');
        setStatus('LOGIN FAILED', 'err');
      } finally { setBusy(false); }
    }

    function toLogin(text) {
      session = null;
      account = null;
      folders = [];
      messages = [];
      renderAccount();
      els.folders.innerHTML = '';
      els.list.innerHTML = '<div class="mail-hint">请输入邮箱与授权码登录。</div>';
      renderReadEmpty('选择一封邮件阅读。');
      showLogin(true);
      setBusy(false);
      setStatus('OFFLINE', '');
      if (text) setLoginState(text, 'warn');
    }

    async function doLogout() {
      if (session) {
        try { await A.mailLogout(session); } catch { }
      }
      toLogin('已退出，内存中的授权码已丢弃。');
      BC.toast('已退出邮箱', { kind: 'ok' });
    }

    function openCompose() {
      if (!session) return;
      els.compose.classList.add('open');
      els.to.value = '';
      els.subject.value = '';
      els.bodyText.value = '';
      els.sendState.textContent = '';
      setTimeout(() => els.to.focus(), 80);
    }
    function closeCompose() { els.compose.classList.remove('open'); }

    async function doSend() {
      if (!session || busy) return;
      const to = els.to.value.trim();
      const subject = els.subject.value.trim();
      const text = els.bodyText.value;
      if (!to) return (els.sendState.textContent = '请填写收件人');
      if (!subject && !text) return (els.sendState.textContent = '主题和正文至少填一项');
      setBusy(true);
      els.sendState.textContent = '正在通过 SMTP（TLS）发送…';
      setStatus('SENDING…', 'warn');
      try {
        const r = await A.mailSend(session, to, subject, text, '');
        els.sendState.textContent = r.message || '已发送';
        setStatus('SENT', 'ok');
        BC.toast('邮件已发送', { kind: 'ok' });
        setTimeout(() => { closeCompose(); }, 900);
      } catch (e) {
        els.sendState.textContent = '发送失败：' + e.message;
        setStatus('SEND FAILED', 'err');
      } finally { setBusy(false); }
    }

    els.providerSel.addEventListener('change', updateHint);
    els.email.addEventListener('input', updateHint);
    els.loginBtn.addEventListener('click', doLogin);
    els.pass.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    els.refresh.addEventListener('click', () => loadFolder(currentFolder));
    els.composeBtn.addEventListener('click', openCompose);
    els.composeClose.addEventListener('click', closeCompose);
    els.logout.addEventListener('click', doLogout);
    els.sendBtn.addEventListener('click', doSend);
    els.compose.addEventListener('pointerdown', e => { if (e.target === els.compose) closeCompose(); });

    loadProviders();
    renderAccount();
    showLogin(true);
    setStatus('OFFLINE', '');
    win.setTitle('邮箱', 'MAIL RELAY');

    return () => {
      if (session) { try { A.mailLogout(session); } catch { } }
    };
  }

  BC.registerApp({
    id: 'mail', name: '邮箱', en: 'MAIL RELAY', icon: 'mail', color: '#6fe3ff',
    width: 1180, height: 760, minWidth: 820, minHeight: 520, singleton: true,
    desc: 'QQ邮箱 · 网易163/126 · 真实 IMAP/SMTP',
    mount(body, win) { return createMail(body, win); }
  });
})();