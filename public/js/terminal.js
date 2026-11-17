/* BATCAVE OS // terminal — real streaming shell */
(function () {
  'use strict';
  const U = BC.util, A = BC.api, BOOT = BC.BOOT || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const PALETTE = ['#56636b', '#ff6b7e', '#5ff0a8', '#ffd166', '#78a9ff', '#e08cff', '#6ffbf3', '#e9f7fa'];
  const BRIGHT = ['#8a9aa2', '#ff9aaa', '#8affc8', '#ffe39a', '#a9c8ff', '#efb5ff', '#a5fdf8', '#ffffff'];
  const BG = ['#3a464d', '#7a2635', '#1e5a3c', '#6b5318', '#233e6b', '#55276b', '#155a5a', '#8b9ba2'];

  function color256(n) {
    n = Number(n);
    if (isNaN(n)) return null;
    if (n < 16) return (n < 8 ? PALETTE : BRIGHT)[n % 8];
    if (n < 232) {
      const v = [0, 95, 135, 175, 215, 255];
      const q = n - 16;
      return 'rgb(' + v[Math.floor(q / 36)] + ',' + v[Math.floor(q % 36 / 6)] + ',' + v[q % 6] + ')';
    }
    const g = 8 + (n - 232) * 10;
    return 'rgb(' + g + ',' + g + ',' + g + ')';
  }

  function applySgr(st, body) {
    const parts = String(body || '').split(';');
    if (!parts.length) parts[0] = '0';
    for (let i = 0; i < parts.length; i++) {
      const n = parseInt(parts[i] || '0', 10);
      if (isNaN(n)) continue;
      if (n === 0) { st.bold = st.dim = st.italic = st.underline = st.inverse = false; st.fg = st.bg = st.fgClass = st.bgClass = null; }
      else if (n === 1) st.bold = true;
      else if (n === 2) st.dim = true;
      else if (n === 3) st.italic = true;
      else if (n === 4) st.underline = true;
      else if (n === 7) st.inverse = true;
      else if (n === 22) { st.bold = false; st.dim = false; }
      else if (n === 23) st.italic = false;
      else if (n === 24) st.underline = false;
      else if (n === 27) st.inverse = false;
      else if (n >= 30 && n <= 37) { st.fgClass = 't-' + ['dark', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'][n - 30]; st.fg = null; }
      else if (n >= 90 && n <= 97) { st.fg = BRIGHT[n - 90]; st.fgClass = null; }
      else if (n === 39) { st.fg = null; st.fgClass = null; }
      else if (n >= 40 && n <= 47) { st.bg = BG[n - 40]; st.bgClass = null; }
      else if (n >= 100 && n <= 107) { st.bg = '#59666c'; st.bgClass = null; }
      else if (n === 49) st.bg = null;
      else if ((n === 38 || n === 48) && parts[i + 1] === '5') {
        const col = color256(parts[i + 2]); i += 2;
        if (col) { if (n === 38) { st.fg = col; st.fgClass = null; } else { st.bg = col; st.bgClass = null; } }
      } else if ((n === 38 || n === 48) && parts[i + 1] === '2') {
        const r = U.clamp(parseInt(parts[i + 2] || 0, 10) || 0, 0, 255);
        const g = U.clamp(parseInt(parts[i + 3] || 0, 10) || 0, 0, 255);
        const b = U.clamp(parseInt(parts[i + 4] || 0, 10) || 0, 0, 255);
        i += 4;
        const col = 'rgb(' + r + ',' + g + ',' + b + ')';
        if (n === 38) { st.fg = col; st.fgClass = null; } else { st.bg = col; st.bgClass = null; }
      }
    }
  }
  function wrapSpan(text, st) {
    if (!text) return '';
    const cls = [];
    if (st.bold) cls.push('t-bold');
    if (st.dim) cls.push('t-dim');
    if (st.italic) cls.push('t-italic');
    if (st.underline) cls.push('t-underline');
    if (st.inverse) cls.push('t-inverse');
    if (st.fgClass) cls.push(st.fgClass);
    if (st.bgClass) cls.push(st.bgClass);
    let style = '';
    if (st.fg) style += 'color:' + st.fg + ';';
    if (st.bg) style += 'background:' + st.bg + ';';
    return '<span' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + (style ? ' style="' + style + '"' : '') + '>' + U.esc(text) + '</span>';
  }
  function ansiToHtml(input) {
    let text = String(input == null ? '' : input);
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    text = text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');
    text = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, m => m.endsWith('m') ? m : '');
    text = text.replace(/\x1b[()][A-Za-z0-9]/g, '').replace(/\x1b[=>]/g, '');
    let out = '', last = 0;
    const st = { bold: false, dim: false, italic: false, underline: false, inverse: false, fg: null, bg: null, fgClass: null, bgClass: null };
    const re = /\x1b\[([0-9;]*)m/g;
    let m;
    while ((m = re.exec(text))) {
      out += wrapSpan(text.slice(last, m.index), st);
      applySgr(st, m[1]);
      last = re.lastIndex;
    }
    out += wrapSpan(text.slice(last), st);
    return out;
  }
  BC.util.ansi = ansiToHtml;

  const COMMANDS = ['help', 'neofetch', 'about', 'mode', 'linux-core', 'brew-setup', 'theme', 'wall', 'open', 'matrix', 'gotham', 'apps', 'lock', 'logout', 'reboot', 'poweroff', 'clear', 'cd', 'pwd', 'history', 'exit', 'sudo', 'apt', 'apt-get', 'git', 'node', 'npm', 'python', 'pip', 'gcc', 'cargo', 'go', 'javac', 'docker', 'ssh', 'curl', 'wget'];

  function createTerminal(body, win) {
    const modes = (BOOT.bridge && BOOT.bridge.modes) || [{ id: 'powershell', label: 'POWERSHELL', available: true, kind: 'windows' }];
    let mode = BC.store.get('termMode', BOOT.bridge && BOOT.bridge.defaultMode || modes[0].id);
    if (!modes.some(m => m.id === mode && m.available)) {
      mode = (modes.find(m => m.available) || modes[0]).id;
    }
    let cwd = defaultCwd(mode);
    let busy = false, currentCtrl = null, runToken = 0;
    let history = BC.store.get('termHistory', []);
    if (!Array.isArray(history)) history = [];
    let histIndex = history.length;
    let suggestCycle = -1, suggestions = [];
    let cmdCount = 0;

    body.innerHTML =
      '<div class="term-top">' +
        '<div class="term-modes"><span class="term-mode-label">SHELL</span>' +
          '<select class="term-select" aria-label="Shell 模式">' +
            modes.map(m => '<option value="' + m.id + '" ' + (m.id === mode ? 'selected' : '') + (m.available ? '' : ' disabled') + '>' + U.esc(m.label) + (m.available ? '' : ' — offline') + '</option>').join('') +
          '</select>' +
          '<span class="term-badge" id="linuxBadge"></span>' +
        '</div>' +
        '<div class="term-actions">' +
          '<button class="icon-btn" data-term="kill" title="终止当前进程 (Ctrl+C)" disabled>' + U.icon('close') + '</button>' +
          '<button class="icon-btn" data-term="copy" title="复制全部输出">' + U.icon('copy') + '</button>' +
          '<button class="icon-btn" data-term="clear" title="清屏 (Ctrl+L)">' + U.icon('trash') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="term-screen" tabindex="0">' +
        '<div class="term-welcome">' +
          '<div><span class="hl">BATCAVE SHELL</span> // <span class="rose">REAL EXECUTION BRIDGE</span> ' + U.esc(BOOT.version || '3.0') + '</div>' +
          '<div>交互输出来自真实进程。系统不会伪造命令结果。</div>' +
          '<div class="dim">Ctrl+C 终止 · TAB 补全 · ↑↓ 历史 · 右键复制/粘贴</div>' +
          (BOOT.bridge && BOOT.bridge.linuxAvailable ? '' : '<div style="color:var(--warn);margin-top:5px">LINUX CORE 离线：sudo / apt-get / brew 会给出明确说明，需 WSL2 或 Batcave ISO。</div>') +
        '</div>' +
        '<div id="termOut"></div>' +
        '<div class="term-promptline"><span class="prompt-text" id="termPrompt"></span><div class="term-input-wrap"><input class="term-input" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="命令输入"><div class="term-suggest"></div></div></div>' +
      '</div>' +
      '<div class="app-status"><span id="termStatus" class="ok">READY</span><span>真实 SHELL</span><span class="spacer" style="flex:1"></span><span id="termCwd"></span></div>';

    const screen = $('.term-screen', body);
    const out = $('#termOut', body);
    const input = $('.term-input', body);
    const promptEl = $('#termPrompt', body);
    const statusEl = $('#termStatus', body);
    const cwdEl = $('#termCwd', body);
    const badge = $('#linuxBadge', body);
    const select = $('.term-select', body);
    const killBtn = $('[data-term="kill"]', body);
    const suggestEl = $('.term-suggest', body);

    function defaultCwd(m) { return m === 'linux' ? (BOOT.homeUnix || BOOT.home || '~') : (BOOT.home || '~'); }
    function modeInfo() { return modes.find(m => m.id === mode) || modes[0]; }
    function displayCwd() {
      const home = mode === 'linux' ? (BOOT.homeUnix || BOOT.home) : BOOT.home;
      let p = String(cwd || '');
      if (home && p.startsWith(home)) p = '~' + p.slice(home.length);
      p = p.replace(/\\/g, '/');
      return p || '~';
    }
    function promptHtml() {
      const user = (BC.settings().account || 'bruce').toLowerCase().replace(/\s+/g, '');
      return '<span class="p-user">' + U.esc(user) + '@sentinel</span>:<span class="p-path">' + U.esc(displayCwd()) + '</span> <span style="color:var(--acc)">›</span>';
    }
    function updateChrome() {
      promptEl.innerHTML = promptHtml();
      cwdEl.textContent = displayCwd();
      const mi = modeInfo();
      select.value = mode;
      badge.textContent = mi.kind === 'linux' ? 'LINUX CORE' : mi.kind === 'unix' ? 'UNIX TOOLS' : 'WIN NATIVE';
      badge.className = 'term-badge ' + (mi.kind === 'linux' ? ((BOOT.bridge && BOOT.bridge.linuxAvailable) ? 'ok' : 'off') : '');
      win.setSub('REAL SHELL · ' + (mi.label || mode.toUpperCase()));
      if (!busy) statusEl.textContent = 'READY';
    }
    function isNearBottom() {
      return screen.scrollHeight - screen.scrollTop - screen.clientHeight < 90;
    }
    function scroll(force) {
      if (force || isNearBottom()) screen.scrollTop = screen.scrollHeight;
    }
    function addLocal(text, cls) {
      const div = document.createElement('pre');
      div.className = 'term-output' + (cls ? ' ' + cls : '');
      div.textContent = text;
      out.appendChild(div);
      scroll();
    }
    function makeMeta(text, cls) {
      const m = document.createElement('div');
      m.className = 'term-meta' + (cls ? ' ' + cls : '');
      m.textContent = text;
      return m;
    }
    function echoCommand(cmd) {
      const block = document.createElement('div');
      block.className = 'term-block';
      const line = document.createElement('div');
      line.className = 'term-command';
      line.innerHTML = '<span class="tc-prompt">' + promptHtml() + '</span><span class="tc-cmd">' + U.esc(cmd) + '</span>';
      const pre = document.createElement('pre');
      pre.className = 'term-output';
      block.appendChild(line);
      block.appendChild(pre);
      out.appendChild(block);
      scroll(true);
      return { block, pre, raw: '', pending: false };
    }
    function renderRaw(entry) {
      entry.pending = false;
      entry.pre.innerHTML = ansiToHtml(entry.raw);
      scroll();
    }
    function appendData(entry, d) {
      entry.raw += d;
      if (!entry.pending) {
        entry.pending = true;
        requestAnimationFrame(() => renderRaw(entry));
      }
    }
    function setBusy(on) {
      busy = on;
      killBtn.disabled = !on;
      input.readOnly = on;
      input.placeholder = on ? '命令运行中 — Ctrl+C 终止' : '';
      statusEl.textContent = on ? 'EXECUTING' : 'READY';
      statusEl.className = on ? 'warn' : 'ok';
      if (on) win.setSub('RUNNING · ' + (modeInfo().label || mode));
      else win.setSub('REAL SHELL · ' + (modeInfo().label || mode));
    }
    function remember(cmd) {
      if (!cmd) return;
      if (history[history.length - 1] !== cmd) history.push(cmd);
      if (history.length > 200) history = history.slice(-200);
      BC.store.set('termHistory', history);
      histIndex = history.length;
    }
    function hideSuggest() { suggestEl.classList.remove('on'); suggestEl.innerHTML = ''; suggestCycle = -1; suggestions = []; }
    function showSuggestions(items, word) {
      suggestions = items;
      suggestCycle = 0;
      suggestEl.innerHTML = items.map((it, i) => '<button data-i="' + i + '" class="' + (i === 0 ? 'sel' : '') + '">' + U.esc(it) + '</button>').join('');
      suggestEl.classList.add('on');
      $$('button', suggestEl).forEach(b => b.addEventListener('click', () => {
        completeWord(items[Number(b.dataset.i)]);
        hideSuggest();
        input.focus();
      }));
    }
    function currentWord() {
      const val = input.value;
      const i = val.lastIndexOf(' ');
      return { before: i >= 0 ? val.slice(0, i + 1) : '', word: i >= 0 ? val.slice(i + 1) : val };
    }
    function completeWord(w) {
      const { before } = currentWord();
      input.value = before + w;
      input.focus();
    }
    function complete() {
      const { before, word } = currentWord();
      if (!word || before.trim()) { hideSuggest(); return; }
      let pool = COMMANDS.concat(Array.from(BC.apps.keys()));
      pool = Array.from(new Set(pool)).filter(c => c.startsWith(word.toLowerCase()));
      if (!pool.length) { soundError(); return; }
      if (pool.length === 1) { completeWord(pool[0] + (pool[0] === 'cd' ? ' ' : '')); hideSuggest(); soundTap(); return; }
      const common = pool.reduce((a, b) => {
        let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
        return a.slice(0, i);
      });
      if (common.length > word.length) input.value = before + common;
      showSuggestions(pool, word);
      soundTap();
    }
    function soundTap() { BC.sound.tap(700); }
    function soundError() { BC.sound.error(); }

    async function localCommand(cmd, entry) {
      const parts = cmd.trim().split(/\s+/);
      const base = (parts[0] || '').toLowerCase();
      const say = (text, cls) => {
        entry.pre.className = 'term-output' + (cls ? ' ' + cls : '');
        entry.pre.textContent += (entry.pre.textContent ? '\n' : '') + text;
        scroll();
      };
      if (['clear', 'cls', 'clean'].includes(base) && parts.length === 1) {
        out.innerHTML = '';
        scroll(true);
        return true;
      }
      if (base === 'exit' && parts.length === 1) {
        say('会话结束。终端窗口关闭。');
        setTimeout(() => win.close(), 280);
        return true;
      }
      if (base === 'pwd' && parts.length === 1) {
        say(cwd);
        return true;
      }
      if (base === 'history' && parts.length === 1) {
        say(history.map((h, i) => String(i + 1).padStart(3, ' ') + '  ' + h).join('\n') || '（历史为空）');
        return true;
      }
      if (base === 'cd') {
        const target = cmd.replace(/^cd\s*/i, '').trim();
        try {
          const r = await A.cd(mode, cwd, target || '~');
          cwd = r.cwd;
          updateChrome();
          say('→ ' + displayCwd());
        } catch (e) {
          say('cd: ' + e.message, 'err');
        }
        return true;
      }
      if (base === 'open' && parts.length === 1) {
        say('用法: open <app|file|url>  或使用底部开始菜单', 'err');
        return true;
      }
      return false;
    }

    async function execute(cmd, opts) {
      cmd = String(cmd || '').trim();
      if (!cmd) { return; }
      if (busy) { BC.toast('已有命令在执行，Ctrl+C 可终止'); return; }
      hideSuggest();
      const entry = echoCommand(cmd);
      const local = await localCommand(cmd, entry);
      if (local) {
        remember(cmd);
        const m = document.createElement('div');
        m.className = 'term-meta';
        m.textContent = 'BUILT-IN';
        entry.block.appendChild(m);
        input.focus();
        return;
      }
      remember(cmd);
      if (!A.online) {
        entry.pre.className = 'term-output err';
        entry.pre.textContent = 'batcave: 未检测到本地服务令牌。请运行 node server.js 并通过显示出的地址打开。';
        return;
      }
      const block = entry;
      setBusy(true);
      cmdCount++;
      let confirmed = !!(opts && opts.confirmed);
      const startedAt = Date.now();
      let endInfo = null;
      currentCtrl = null;
      const token = ++runToken;

      const handlers = {
        onController(c) { currentCtrl = c; },
        onData(d) { if (token === runToken) appendData(block, d); },
        onBegin(ev) {
          if (ev && ev.mode) mode = ev.mode;
          updateChrome();
        },
        onEnd(ev) {
          endInfo = ev || null;
          if (ev && ev.cwd) cwd = ev.cwd;
          updateChrome();
        },
        onAction(action) {
          if (!action) return;
          if (action.type === 'clear') { out.innerHTML = ''; scroll(true); return; }
          try { BC.actions.handle(action); } catch (e) { }
        }
      };

      try {
        await A.execStream({ cmd, mode, cwd, confirm: confirmed }, handlers);
        if (token !== runToken) return;
        if (block.pending) renderRaw(block);
        const code = endInfo ? endInfo.code : 0;
        const dur = endInfo && typeof endInfo.duration === 'number' ? endInfo.duration : Date.now() - startedAt;
        const meta = document.createElement('div');
        meta.className = 'term-meta';
        const ok = code === 0;
        meta.innerHTML = '<span class="' + (ok ? 'ok' : 'err') + '">EXIT ' + U.esc(code) + '</span><span>' + U.esc(U.fmtDuration(dur)) + '</span><span>' + U.esc((modeInfo().label || mode)) + '</span>' + (endInfo && endInfo.truncated ? '<span class="warn">输出已截断</span>' : '');
        block.block.appendChild(meta);
        scroll();
      } catch (e) {
        if (e.risky) {
          setBusy(false);
          const reason = (e.data && (e.data.reason || e.data.error)) || '该命令可能修改或删除数据';
          const ok = await BC.ui.confirm('危险命令确认', '即将在 <code>' + U.esc(modeInfo().label || mode) + '</code> 中执行：<br><br><code>' + U.esc(cmd) + '</code><br><br>风险检测：' + U.esc(reason) + '<br><br>确认只在你了解后果时继续。', { okText: '仍然执行', cancelText: '取消', danger: true, icon: 'alert' });
          if (ok) {
            setBusy(true);
            try {
              await A.execStream({ cmd, mode, cwd, confirm: true }, handlers);
              if (token !== runToken) return;
              const code = endInfo ? endInfo.code : 0;
              const meta = document.createElement('div');
              meta.className = 'term-meta';
              meta.innerHTML = '<span class="' + (code === 0 ? 'ok' : 'err') + '">EXIT ' + U.esc(code) + '</span><span>' + U.esc(U.fmtDuration(endInfo && endInfo.duration || 0)) + '</span><span>' + U.esc(modeInfo().label || mode) + '</span>';
              block.block.appendChild(meta);
              scroll();
            } catch (err2) {
              if (err2.aborted) {
                block.block.appendChild(makeMeta('已终止 · EXIT 130', ''));
              } else {
                appendData(block, '\nbatcave: ' + err2.message + '\n');
              }
            } finally { setBusy(false); currentCtrl = null; input.focus(); }
          } else {
            block.block.appendChild(makeMeta('已取消 · 未执行', ''));
          }
          return;
        }
        if (e.aborted) {
          block.block.appendChild(makeMeta('已终止 · EXIT 130', ''));
        } else {
          appendData(block, '\nbatcave: ' + e.message + '\n');
          soundError();
        }
      } finally {
        setBusy(false);
        currentCtrl = null;
        input.focus();
        scroll();
      }
    }

    function setMode(next) {
      const m = modes.find(x => x.id === next);
      if (!m || !m.available) { BC.toast('该 SHELL 模式当前不可用'); return; }
      if (busy && currentCtrl) { try { currentCtrl.abort(); } catch (e) { } }
      mode = next;
      BC.store.set('termMode', mode);
      cwd = defaultCwd(mode);
      updateChrome();
      const line = document.createElement('div');
      line.className = 'term-meta';
      line.textContent = 'MODE → ' + m.label + (m.note ? ' · ' + m.note : '');
      out.appendChild(line);
      scroll(true);
      input.focus();
    }

    select.addEventListener('change', () => setMode(select.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (busy) return;
        const v = input.value;
        input.value = '';
        hideSuggest();
        execute(v);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (!busy) complete();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!history.length) return;
        histIndex = Math.max(0, histIndex - 1);
        input.value = history[histIndex] || '';
        setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!history.length) return;
        histIndex = Math.min(history.length, histIndex + 1);
        input.value = history[histIndex] || '';
      } else if (e.key === 'Escape') {
        hideSuggest();
      } else if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        if (busy && currentCtrl) {
          try { currentCtrl.abort(); } catch (err) { }
          BC.toast('终止信号已发送');
        } else {
          addLocal('^C');
          input.value = '';
        }
      } else if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        out.innerHTML = '';
        scroll(true);
      }
    });
    input.addEventListener('input', () => { if (suggestEl.classList.contains('on')) hideSuggest(); });
    screen.addEventListener('pointerdown', e => {
      if (window.getSelection && String(window.getSelection()).length) return;
      if (e.target.closest('button, a, select, input')) return;
      setTimeout(() => input.focus(), 0);
    });
    screen.addEventListener('contextmenu', e => {
      e.preventDefault();
      BC.ui.contextMenu(e.clientX, e.clientY, [
        { label: '复制选中文本', icon: 'copy', action: async () => { const s = String(window.getSelection() || ''); if (s) { await U.copy(s); BC.toast('已复制'); } } },
        { label: '粘贴', icon: 'file', action: async () => { try { const t = await navigator.clipboard.readText(); input.value += t; input.focus(); } catch (err) { BC.toast('浏览器拒绝读取剪贴板'); } } },
        { sep: true },
        { label: '终止当前进程', icon: 'close', danger: true, action: () => { if (busy && currentCtrl) currentCtrl.abort(); } },
        { label: '清屏', icon: 'trash', action: () => { out.innerHTML = ''; } }
      ]);
    });
    $('[data-term="clear"]', body).addEventListener('click', () => { out.innerHTML = ''; input.focus(); });
    $('[data-term="copy"]', body).addEventListener('click', async () => {
      const text = screen.innerText;
      if (await U.copy(text)) BC.toast('终端内容已复制');
    });
    killBtn.addEventListener('click', () => { if (busy && currentCtrl) { currentCtrl.abort(); BC.toast('终止信号已发送'); } });

    updateChrome();
    setTimeout(() => input.focus(), 100);
    input.focus();

    win.terminalApi = {
      run(cmd, nextMode) {
        if (nextMode && nextMode !== mode) setMode(nextMode);
        input.value = cmd;
        execute(cmd).finally(() => { input.value = ''; input.focus(); });
      },
      setMode,
      get cwd() { return cwd; }
    };

    return () => {
      runToken++;
      if (busy && currentCtrl) { try { currentCtrl.abort(); } catch (e) { } }
    };
  }

  BC.registerApp({
    id: 'terminal', name: '终端', en: 'TERMINAL', icon: 'terminal', color: '#5ffbf1',
    width: 860, height: 580, minWidth: 380, minHeight: 280, singleton: true,
    desc: '真实多模式 Shell · 流式输出 · Ctrl+C',
    mount(body, win) { return createTerminal(body, win); }
  });

  BC.runTerminalCommand = function (cmd, mode) {
    const list = BC.getWindows().filter(w => w.appId === 'terminal');
    const w = list[list.length - 1];
    if (w && w.terminalApi) { w.terminalApi.run(cmd, mode); BC.focusWindow(w); }
    else { BC.toast('终端尚未就绪，请重试'); }
  };
})();