/* BATCAVE OS // 办公套件：微信/QQ、Office 检测预置、PDF 浏览与页级编辑 */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;

  function createOffice(body, win) {
    body.innerHTML =
      '<div class="app office-app">' +
        '<div class="office-top">' +
          '<div class="office-tabs"><button class="active" data-ot="office">办公套件</button><button data-ot="im">微信 · QQ</button><button data-ot="pdf">PDF 工具</button></div>' +
          '<button class="btn small" id="officeRefresh">重新检测</button>' +
        '</div>' +
        '<div class="office-body">' +
          '<section class="office-pane" data-op="office"><div class="office-loading"><span class="term-spinner"></span> 正在读取注册表与开始菜单…</div></section>' +
          '<section class="office-pane hidden" data-op="im"></section>' +
          '<section class="office-pane hidden" data-op="pdf">' +
            '<div class="pdf-layout">' +
              '<div class="pdf-side">' +
                '<div class="pdf-actions">' +
                  '<label class="btn small primary">选择 PDF<input type="file" id="pdfPick" accept="application/pdf,.pdf" hidden></label>' +
                  '<label class="btn small">合并 PDF<input type="file" id="pdfMerge" accept="application/pdf,.pdf" multiple hidden></label>' +
                  '<button class="btn small" id="pdfPreview" disabled>预览</button>' +
                  '<button class="btn small primary" id="pdfSave" disabled>导出 PDF</button>' +
                '</div>' +
                '<div class="pdf-meta" id="pdfMeta">尚未载入 PDF。</div>' +
                '<div class="pdf-pages" id="pdfPages"></div>' +
                '<div class="pdf-extra">' +
                  '<label class="pdf-check"><input type="checkbox" id="pdfNums"> 每页底部加页码</label>' +
                  '<div class="pdf-wm"><input id="pdfWm" placeholder="水印文字（拉丁字符）" spellcheck="false"><button class="btn small" id="pdfWmApply">应用</button></div>' +
                  '<div class="pdf-meta-edit"><input id="pdfTitle" placeholder="PDF 标题"><input id="pdfAuthor" placeholder="作者"></div>' +
                  '<button class="btn small" id="pdfClear">清空</button>' +
                '</div>' +
              '</div>' +
              '<div class="pdf-stage">' +
                '<div class="pdf-empty" id="pdfEmpty"><b>PDF 工具</b><span>选择本地 PDF 即可浏览；旋转 / 删除 / 排序 / 合并 / 页码 / 水印 / 元数据全部在本机浏览器内完成，文件不上传服务器。</span><span class="note">预览使用系统内置 PDF 阅读器；导出为标准 PDF 文件。</span></div>' +
                '<iframe id="pdfFrame" class="pdf-frame hidden" title="PDF 预览"></iframe>' +
              '</div>' +
            '</div>' +
          '</section>' +
        '</div>' +
        '<pre class="office-log hidden" id="officeLog"></pre>' +
        '<div class="app-status"><span id="officeStatus" class="ok">READY</span><span>OFFICE · IM · PDF</span><span class="spacer" style="flex:1"></span><span id="officeInfo"></span></div>' +
      '</div>';

    const tabs = body.querySelectorAll('[data-ot]');
    const panes = body.querySelectorAll('[data-op]');
    const statusEl = body.querySelector('#officeStatus');
    const infoEl = body.querySelector('#officeInfo');
    const logEl = body.querySelector('#officeLog');
    let data = null, busy = false, ctrl = null, pdfBusy = false;

    function setStatus(t, c) { statusEl.textContent = t; statusEl.className = c || ''; }
    function log(s) {
      logEl.classList.remove('hidden');
      logEl.textContent += (logEl.textContent ? '\n' : '') + s;
      if (logEl.textContent.length > 120000) logEl.textContent = logEl.textContent.slice(-90000);
      logEl.scrollTop = logEl.scrollHeight;
    }
    function switchTab(t) {
      tabs.forEach(b => b.classList.toggle('active', b.dataset.ot === t));
      panes.forEach(p => p.classList.toggle('hidden', p.dataset.op !== t));
    }
    tabs.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.ot)));

    function card(item, extra) {
      const launchable = item.appId || item.exe;
      extra = extra || '';
      return '<div class="es-card' + (item.installed ? ' ready' : '') + '">' +
        '<div class="es-head"><span class="es-en">' + U.esc(item.en || item.id.toUpperCase()) + '</span><span class="es-state">' + (item.installed ? '已安装' : '未安装') + '</span></div>' +
        '<b>' + U.esc(item.name) + '</b>' +
        '<span class="es-ver">' + (item.version ? 'v' + U.esc(item.version) : (item.installed ? '已在本机' : (item.winget ? '官方安装器 · winget' : '需单独授权'))) + '</span>' +
        '<p>' + U.esc(item.desc || '') + '</p>' +
        '<div class="es-actions">' +
          (item.installed
            ? (launchable ? '<button class="btn small primary" data-es-launch="' + item.id + '">启动</button>' : '<span class="note">请从开始菜单启动</span>')
            : (item.winget ? '<button class="btn small primary" data-es-install="' + item.id + '"' + (busy ? ' disabled' : '') + '>安装</button>' : '<span class="note">未提供静默安装</span>')) +
          extra +
        '</div></div>';
    }

    const DESC = {
      wechat: '微信桌面版：聊天、文件传输、朋友圈。登录与账号由腾讯管理。',
      qq: 'QQ 桌面版：聊天、群文件、远程演示。登录与账号由腾讯管理。',
      word: 'Microsoft Word：需本机已安装且已授权的 Office。',
      excel: 'Microsoft Excel：需本机已安装且已授权的 Office。',
      powerpoint: 'Microsoft PowerPoint：需本机已安装且已授权的 Office。',
      wps: 'WPS Office：文字 / 表格 / 演示，安装后可整套使用。',
      libreoffice: 'LibreOffice：Writer / Calc / Impress / Draw 全套离线办公，免费开源。'
    };
    const EN = { wechat: 'WECHAT', qq: 'QQ', word: 'WORD', excel: 'EXCEL', powerpoint: 'POWERPOINT', wps: 'WPS', libreoffice: 'LIBREOFFICE' };

    function enhanced(list) {
      return list.map(x => Object.assign({}, x, { desc: DESC[x.id] || '', en: EN[x.id] || '' }));
    }

    function render() {
      if (!data || !data.ok) {
        body.querySelector('[data-op="office"]').innerHTML = '<div class="office-loading">' + U.esc((data && data.message) || '无法读取本机应用状态') + '</div>';
        setStatus('UNAVAILABLE', 'err');
        return;
      }
      const all = enhanced(data.essentials || []);
      const office = all.filter(x => x.group === 'office');
      const im = all.filter(x => x.group === 'im');
      const ms = office.filter(x => ['word', 'excel', 'powerpoint'].includes(x.id));
      const msReady = ms.filter(x => x.installed).length;

      body.querySelector('[data-op="office"]').innerHTML =
        '<div class="office-hero"><b>整套办公</b><span>本机真实程序 · 文档格式与 Windows 完全一致</span></div>' +
        '<div class="es-group-title">Microsoft Office <span>' + msReady + '/3</span></div>' +
        (msReady
          ? '<div class="es-grid">' + ms.map(x => card(x)).join('') + '</div>'
          : '<div class="office-tip">未检测到 Microsoft Office。Office 需要有效许可证，系统不会伪造或内置授权；可先用下面的免费整套 LibreOffice，或安装 WPS。已有 Office 安装包/账号时，装好后这里会自动识别并可启动。</div>') +
        '<div class="es-group-title">免费与国产套件</div>' +
        '<div class="es-grid">' + office.filter(x => x.id === 'libreoffice' || x.id === 'wps').map(x => card(x)).join('') + '</div>' +
        '<div class="office-tip">LibreOffice 提供 Writer / Calc / Impress / Draw 整套离线办公，兼容 .docx / .xlsx / .pptx 的读写；WPS 提供中文界面与云文档。两者都由 winget 官方源安装。</div>';

      body.querySelector('[data-op="im"]').innerHTML =
        '<div class="office-hero"><b>微信 · QQ</b><span>桌面客户端 · 本机原生运行</span></div>' +
        '<div class="es-grid">' + im.map(x => card(x)).join('') + '</div>' +
        '<div class="office-tip">当前本机：' + U.esc(im.filter(x => x.installed).map(x => x.name).join('、') || '暂无') + '。微信/QQ 由腾讯提供，登录、消息与文件传输均在官方客户端内完成，BATCAVE 不读取你的聊天数据。' +
        (im.some(x => !x.installed) ? '<br><button class="btn small primary" id="imInstallMissing">安装缺失的即时通讯（' + im.filter(x => !x.installed).length + '）</button>' : '') + '</div>';

      bindActions();
      infoEl.textContent = '微信/QQ + Office + PDF';
      setStatus('READY', 'ok');
    }

    function bindActions() {
      body.querySelectorAll('[data-es-launch]').forEach(b => b.addEventListener('click', async () => {
        const it = data.essentials.find(x => x.id === b.dataset.esLaunch);
        if (!it) return;
        const res = it.appId ? await A.appsLaunch('appid', it.appId) : await A.appsLaunch('exe', it.exe);
        BC.toast(res.message || (res.ok ? '已请求启动' : '启动失败'), { kind: res.ok ? 'ok' : 'err' });
      }));
      body.querySelectorAll('[data-es-install]').forEach(b => b.addEventListener('click', async () => {
        const it = data.essentials.find(x => x.id === b.dataset.esInstall);
        if (!it) return;
        const ok = await runWinget(it.winget, it.name);
        if (ok) BC.toast(it.name + ' 安装完成', { kind: 'ok' });
        data = await A.appsEssentials(true);
        render();
      }));
      const imBtn = body.querySelector('#imInstallMissing');
      if (imBtn) imBtn.addEventListener('click', async () => {
        if (busy) return;
        const missing = data.essentials.filter(x => x.group === 'im' && !x.installed && x.winget);
        for (const it of missing) await runWinget(it.winget, it.name);
        data = await A.appsEssentials(true);
        render();
      });
    }

    async function runWinget(id, name) {
      if (busy) { BC.toast('已有安装任务在运行'); return false; }
      if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(id || '')) return false;
      busy = true;
      log('> winget install --id ' + id);
      setStatus('INSTALLING · ' + id, 'warn');
      return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          busy = false;
          ctrl = null;
          setStatus(ok ? 'INSTALLED · ' + name : 'INSTALL FAILED · ' + name, ok ? 'ok' : 'err');
          resolve(ok);
        };
        A.execStream({ mode: 'powershell', cmd: 'winget install --id "' + id + '" --source winget --accept-package-agreements --accept-source-agreements --silent' }, {
          onController: c => { ctrl = c; },
          onData: d => log(d.replace(/\x1b\[[0-9;]*m/g, '')),
          onEnd: ev => finish(ev && ev.code === 0)
        }).catch(e => {
          if (!e.aborted) log('失败：' + (e.message || e));
          finish(false);
        });
      });
    }

    body.querySelector('#officeRefresh').addEventListener('click', () => load(true));

    async function load(force) {
      setStatus('PROBING…', 'warn');
      try {
        data = await A.appsEssentials(!!force);
        render();
      } catch (e) {
        setStatus('PROBE FAILED', 'err');
        body.querySelector('[data-op="office"]').innerHTML = '<div class="office-loading">检测失败：' + U.esc(e.message) + '</div>';
      }
    }

    /* ---------------- PDF ---------------- */
    const pdf = { docs: [], pages: [], name: '', pageNum: false, wm: '', title: '', author: '' };
    let previewUrl = '';
    const pdfFrame = body.querySelector('#pdfFrame');
    const pdfEmpty = body.querySelector('#pdfEmpty');
    const pdfPagesEl = body.querySelector('#pdfPages');
    const pdfMeta = body.querySelector('#pdfMeta');

    function ensureLib() {
      if (!window.PDFLib) { BC.toast('PDF 引擎未加载，请刷新桌面'); return false; }
      return true;
    }

    async function addFiles(fileList, replace) {
      if (!ensureLib()) return;
      const files = Array.from(fileList || []).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
      if (!files.length) return;
      if (pdfBusy) return BC.toast('请等待当前 PDF 任务完成');
      pdfBusy = true;
      setStatus('LOADING PDF…', 'warn');
      try {
        if (replace) {
          pdf.docs = []; pdf.pages = []; pdf.name = ''; pdf.title = ''; pdf.author = ''; pdf.wm = ''; pdf.pageNum = false;
          body.querySelector('#pdfWm').value = '';
          body.querySelector('#pdfTitle').value = '';
          body.querySelector('#pdfAuthor').value = '';
          body.querySelector('#pdfNums').checked = false;
        }
        for (const f of files) {
          log('[pdf] 读取 ' + f.name);
          const bytes = await f.arrayBuffer();
          let doc;
          try { doc = await PDFLib.PDFDocument.load(bytes); }
          catch (e) { BC.toast(f.name + ' 无法解析：' + (e.message || e)); continue; }
          const di = pdf.docs.length;
          pdf.docs.push({ doc, name: f.name });
          const n = doc.getPageCount();
          for (let i = 0; i < n; i++) pdf.pages.push({ d: di, i, rot: 0 });
          if (!pdf.name) pdf.name = f.name.replace(/\.pdf$/i, '');
        }
        renderPages();
        await refreshPreview();
        setStatus('PDF READY · ' + pdf.pages.length + ' 页', 'ok');
      } catch (e) {
        BC.toast('PDF 载入失败：' + e.message);
        setStatus('PDF FAILED', 'err');
      } finally {
        pdfBusy = false;
      }
    }

    function renderPages() {
      const has = pdf.pages.length > 0;
      body.querySelector('#pdfPreview').disabled = !has;
      body.querySelector('#pdfSave').disabled = !has;
      pdfEmpty.classList.toggle('hidden', has);
      pdfFrame.classList.toggle('hidden', !has);
      if (!has) {
        pdfPagesEl.innerHTML = '';
        pdfMeta.textContent = '尚未载入 PDF。';
        return;
      }
      pdfMeta.textContent = pdf.name + ' · ' + pdf.pages.length + ' 页 · ' + pdf.docs.length + ' 个源文件';
      pdfPagesEl.innerHTML = pdf.pages.map((p, i) =>
        '<div class="pdf-page-row">' +
          '<span class="pdf-pg-no">' + (i + 1) + '</span>' +
          '<span class="pdf-pg-src">p' + (p.i + 1) + ' · ' + p.rot + '°</span>' +
          '<span class="pdf-pg-btns">' +
            '<button title="上移" data-pg-up="' + i + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button title="下移" data-pg-down="' + i + '"' + (i === pdf.pages.length - 1 ? ' disabled' : '') + '>↓</button>' +
            '<button title="左转 90°" data-pg-rot="' + i + '">↺</button>' +
            '<button title="删除" data-pg-del="' + i + '">✕</button>' +
          '</span>' +
        '</div>'
      ).join('');
      pdfPagesEl.querySelectorAll('[data-pg-up]').forEach(b => b.addEventListener('click', () => move(Number(b.dataset.pgUp), -1)));
      pdfPagesEl.querySelectorAll('[data-pg-down]').forEach(b => b.addEventListener('click', () => move(Number(b.dataset.pgDown), 1)));
      pdfPagesEl.querySelectorAll('[data-pg-rot]').forEach(b => b.addEventListener('click', () => rotate(Number(b.dataset.pgRot))));
      pdfPagesEl.querySelectorAll('[data-pg-del]').forEach(b => b.addEventListener('click', () => del(Number(b.dataset.pgDel))));
    }

    function move(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= pdf.pages.length) return;
      const t = pdf.pages[i]; pdf.pages[i] = pdf.pages[j]; pdf.pages[j] = t;
      renderPages();
      refreshPreview();
    }
    function rotate(i) {
      pdf.pages[i].rot = (pdf.pages[i].rot + 90) % 360;
      renderPages();
      refreshPreview();
    }
    function del(i) {
      pdf.pages.splice(i, 1);
      if (!pdf.pages.length) {
        pdf.docs = []; pdf.name = '';
      }
      renderPages();
      if (pdf.pages.length) refreshPreview();
      else { if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ''; } pdfFrame.src = 'about:blank'; }
    }

    async function buildPdf() {
      if (!pdf.pages.length) throw new Error('没有页面');
      const { PDFDocument, StandardFonts, degrees, rgb } = PDFLib;
      const out = await PDFDocument.create();
      const font = await out.embedFont(StandardFonts.Helvetica);
      for (const p of pdf.pages) {
        const src = pdf.docs[p.d].doc;
        const [page] = await out.copyPages(src, [p.i]);
        const base = page.getRotation().angle || 0;
        page.setRotation(degrees(((base + p.rot) % 360 + 360) % 360));
        out.addPage(page);
        if (pdf.pageNum) {
          const text = String(out.getPageCount());
          const w = font.widthOfTextAtSize(text, 9);
          const size = page.getSize();
          page.drawText(text, { x: (size.width - w) / 2, y: 16, size: 9, font, color: rgb(0.35, 0.4, 0.45) });
        }
        if (pdf.wm) {
          const size = page.getSize();
          const tw = font.widthOfTextAtSize(pdf.wm, 28);
          page.drawText(pdf.wm, { x: size.width / 2 - tw / 2, y: size.height / 2 - 14, size: 28, font, color: rgb(0.6, 0.6, 0.6), opacity: 0.18, rotate: degrees(35) });
        }
      }
      out.setTitle(pdf.title || pdf.name || 'BATCAVE PDF');
      if (pdf.author) out.setAuthor(pdf.author);
      out.setProducer('BATCAVE OS PDF Toolkit');
      return out.save();
    }

    async function refreshPreview() {
      if (!pdf.pages.length) return;
      try {
        const bytes = await buildPdf();
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        pdfFrame.src = previewUrl;
      } catch (e) {
        BC.toast('预览失败：' + e.message);
      }
    }

    body.querySelector('#pdfPick').addEventListener('change', e => { addFiles(e.target.files, true); e.target.value = ''; });
    body.querySelector('#pdfMerge').addEventListener('change', e => { addFiles(e.target.files, false); e.target.value = ''; });
    body.querySelector('#pdfPreview').addEventListener('click', refreshPreview);
    body.querySelector('#pdfSave').addEventListener('click', async () => {
      if (!pdf.pages.length) return;
      setStatus('EXPORTING…', 'warn');
      try {
        const bytes = await buildPdf();
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = (pdf.name || 'document') + '-edited.pdf';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        setStatus('EXPORTED', 'ok');
        BC.toast('已导出 ' + a.download, { kind: 'ok' });
      } catch (e) {
        setStatus('EXPORT FAILED', 'err');
        BC.toast('导出失败：' + e.message);
      }
    });
    body.querySelector('#pdfClear').addEventListener('click', () => {
      pdf.docs = []; pdf.pages = []; pdf.name = ''; pdf.wm = ''; pdf.pageNum = false; pdf.title = ''; pdf.author = '';
      body.querySelector('#pdfWm').value = '';
      body.querySelector('#pdfTitle').value = '';
      body.querySelector('#pdfAuthor').value = '';
      body.querySelector('#pdfNums').checked = false;
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ''; }
      pdfFrame.src = 'about:blank';
      renderPages();
      setStatus('PDF CLEARED', 'ok');
    });
    body.querySelector('#pdfNums').addEventListener('change', e => { pdf.pageNum = e.target.checked; refreshPreview(); });
    body.querySelector('#pdfTitle').addEventListener('input', e => { pdf.title = e.target.value; });
    body.querySelector('#pdfAuthor').addEventListener('input', e => { pdf.author = e.target.value; });
    body.querySelector('#pdfWmApply').addEventListener('click', () => {
      const v = body.querySelector('#pdfWm').value.trim();
      if (/[^\x20-\x7E]/.test(v)) return BC.toast('水印暂只支持拉丁字符与数字');
      pdf.wm = v;
      refreshPreview();
    });

    win.setTitle('办公套件', 'DOC SUITE');
    load(false);
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (ctrl) { try { ctrl.abort(); } catch { } }
      pdfFrame.src = 'about:blank';
    };
  }

  BC.registerApp({
    id: 'office', name: '办公套件', en: 'DOC SUITE', icon: 'notes', color: '#9b8cff',
    width: 1120, height: 720, minWidth: 720, minHeight: 460, singleton: true,
    desc: '微信 · QQ · Office · PDF 浏览编辑',
    mount(body, win) { return createOffice(body, win); }
  });
})();