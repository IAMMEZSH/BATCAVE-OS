/* BATCAVE OS // forge, breach game, Chat-AI */
(function () {
  'use strict';
  const U = BC.util, A = BC.api;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const strip = s => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

  const LANGUAGES = [
    { id: 'javascript', name: 'JavaScript', file: 'main.js', hint: 'node', template: `// BATCAVE // JavaScript\nconsole.log('JavaScript runtime online');\nconsole.log('platform:', process.platform, process.arch);\nconsole.log('node:', process.version);\nfor (let i = 1; i <= 3; i++) console.log('patrol sector', i);\n` },
    { id: 'typescript', name: 'TypeScript', file: 'main.ts', hint: 'node', template: `// Node 24+ 可直接执行 TypeScript（类型擦除）\nconst operator: string = 'SENTINEL';\nconsole.log(\`TypeScript online · \${operator}\`);\n` },
    { id: 'python', name: 'Python', file: 'main.py', hint: 'python3', template: `# BATCAVE // Python\nimport platform\nprint("Python runtime online")\nprint("platform:", platform.platform())\nfor i in range(1, 4):\n    print(f"patrol sector {i:02d}")\n` },
    { id: 'c', name: 'C', file: 'main.c', hint: 'gcc', template: `#include <stdio.h>\nint main(void) {\n    puts("C toolchain online");\n    for (int i = 1; i <= 3; i++) printf("patrol sector %02d\\n", i);\n    return 0;\n}\n` },
    { id: 'cpp', name: 'C++', file: 'main.cpp', hint: 'g++', template: `#include <iostream>\nint main() {\n    std::cout << "C++ toolchain online\\n";\n    for (int i = 1; i <= 3; ++i) std::cout << "patrol sector " << i << "\\n";\n    return 0;\n}\n` },
    { id: 'asm', name: 'Assembly (GNU)', file: 'main.s', hint: 'gcc', templates: {
      win: `.text\n.globl main\nmain:\n  subq $40, %rsp\n  leaq msg(%rip), %rcx\n  call puts\n  xorl %eax, %eax\n  addq $40, %rsp\n  ret\n.section .rdata\nmsg:\n  .asciz "Assembly online // SENTINEL"\n`,
      unix: `.text\n.globl main\nmain:\n  subq $8, %rsp\n  leaq msg(%rip), %rdi\n  call puts\n  xorl %eax, %eax\n  addq $8, %rsp\n  ret\n.section .rodata\nmsg:\n  .asciz "Assembly online // SENTINEL"\n`
    }, template: `.text\n.globl main\nmain:\n  ret\n` },
    { id: 'ascii', name: 'ASCII / 编码', file: 'ascii.js', hint: 'node', template: `// ASCII / UTF-8 编码实验\nconst text = 'BATCAVE 74';\nconsole.log('TEXT:', text);\nconsole.log('ASCII:', [...text].map(c => c.charCodeAt(0)).join(' '));\nconsole.log('HEX:', Buffer.from(text, 'utf8').toString('hex').toUpperCase());\nconsole.log('BIN:', [...Buffer.from(text, 'utf8')].map(b => b.toString(2).padStart(8, '0')).join(' '));\n` },
    { id: 'rust', name: 'Rust', file: 'main.rs', hint: 'rustc', template: `fn main() {\n    println!("Rust toolchain online");\n    for i in 1..=3 {\n        println!("patrol sector {:02}", i);\n    }\n}\n` },
    { id: 'go', name: 'Go', file: 'main.go', hint: 'go', template: `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Go toolchain online")\n\tfor i := 1; i <= 3; i++ {\n\t\tfmt.Printf("patrol sector %02d\\n", i)\n\t}\n}\n` },
    { id: 'java', name: 'Java', file: 'Hello.java', hint: 'javac', template: `public class Hello {\n    public static void main(String[] args) {\n        System.out.println("JVM online");\n        for (int i = 1; i <= 3; i++) {\n            System.out.printf("patrol sector %02d%n", i);\n        }\n    }\n}\n` },
    { id: 'ruby', name: 'Ruby', file: 'main.rb', hint: 'ruby', template: `# BATCAVE // Ruby\nputs "Ruby runtime online"\n(1..3).each { |i| puts format("patrol sector %02d", i) }\n` },
    { id: 'php', name: 'PHP', file: 'main.php', hint: 'php', template: `<?php\necho "PHP runtime online\\n";\nfor ($i = 1; $i <= 3; $i++) printf("patrol sector %02d\\n", $i);\n` },
    { id: 'bash', name: 'Bash', file: 'main.sh', hint: 'bash', template: `#!/usr/bin/env bash\nset -euo pipefail\necho "Bash script online"\nfor i in 1 2 3; do printf 'patrol sector %02d\\n' "$i"; done\n` },
    { id: 'powershell', name: 'PowerShell', file: 'main.ps1', hint: 'pwsh', template: `Write-Output "PowerShell online"\n1..3 | ForEach-Object { "patrol sector {0:D2}" -f $_ }\n` },
    { id: 'html', name: 'HTML / CSS / JS', file: 'index.html', hint: null, preview: true, template: `<!doctype html>\n<html lang="zh">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>BATCAVE PREVIEW</title>\n<style>\n  html,body{margin:0;height:100%;background:#040a0e;color:#bff8ff;font-family:ui-monospace,Consolas,monospace}\n  .wrap{height:100%;display:grid;place-items:center;text-align:center}\n  h1{color:#5ffbf1;letter-spacing:.18em;font-size:26px;text-shadow:0 0 18px #5ffbf155}\n  p{color:#6d8f98;font-size:12px}\n  button{margin-top:12px;background:transparent;border:1px solid #5ffbf1;color:#5ffbf1;padding:9px 16px;cursor:pointer;letter-spacing:.1em}\n</style>\n</head>\n<body>\n<div class="wrap"><div>\n  <h1>GOTHAM NET</h1>\n  <p>Sandboxed preview · scripts enabled, same-origin disabled</p>\n  <button onclick="this.textContent='SIGNAL RECEIVED'">PING</button>\n</div></div>\n</body>\n</html>\n` },
    { id: 'css', name: 'CSS', file: 'style.css', hint: null, preview: true, previewKind: 'css', template: `/* BATCAVE // CSS 实时预览 */\n:root {\n  --acc: #5ffbf1;\n  --bg: #040a0e;\n  --ink: #bff8ff;\n}\n\nbody {\n  margin: 0;\n  min-height: 100vh;\n  display: grid;\n  place-items: center;\n  background: radial-gradient(circle at 50% 20%, #0b1d26, var(--bg) 70%);\n  color: var(--ink);\n  font-family: ui-monospace, Consolas, monospace;\n}\n\n.card {\n  padding: 28px 34px;\n  border: 1px solid #5ffbf155;\n  border-radius: 4px;\n  background: #071119cc;\n  box-shadow: 0 0 32px #5ffbf122;\n}\n\nh1 {\n  margin: 0 0 10px;\n  font-size: 24px;\n  letter-spacing: .18em;\n  color: var(--acc);\n}\n\nbutton {\n  margin-top: 14px;\n  padding: 9px 18px;\n  border: 1px solid var(--acc);\n  background: transparent;\n  color: var(--acc);\n  font: inherit;\n  letter-spacing: .1em;\n  cursor: pointer;\n}\n\nbutton:hover {\n  background: var(--acc);\n  color: var(--bg);\n}\n` },
    { id: 'custom', name: '自定义命令', file: 'main.txt', hint: null, custom: true, template: `# 自定义运行模式\n# 在下方“运行命令”中使用 {file} 作为文件名占位符。\n# 例如：lua {file}    perl {file}    Rscript {file}\n# 需要对应运行时已经安装并在 PATH 中。\n` }
  ];

  /* HTML/CSS 轻量静态诊断：定位到行，规则保持保守以避免误报 */
  function lineStartsOf(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    return starts;
  }
  function locateIn(text, starts, idx, baseLine) {
    let lo = 0, hi = starts.length - 1;
    idx = Math.max(0, Math.min(idx, text.length));
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return { line: lo + (baseLine || 1), col: idx - starts[lo] + 1 };
  }
  function validateCss(src, baseLine, fileName) {
    const text = String(src || '');
    const starts = lineStartsOf(text);
    const lines = text.split('\n');
    const base = baseLine || 1;
    const list = [];
    const add = (idx, severity, message) => {
      const p = locateIn(text, starts, idx, base);
      list.push({
        line: p.line, col: p.col, severity, message,
        file: fileName || 'style.css', source: (lines[p.line - base] || '').trim()
      });
    };
    let i = 0, depth = 0, paren = 0, segStart = 0;
    let mode = null, modeIdx = 0, quote = '';
    const blocks = [];
    const checkDecl = (raw, off) => {
      const decl = raw.trim();
      if (!decl || decl.startsWith('@')) return;
      const lead = raw.indexOf(decl);
      const ci = decl.indexOf(':');
      if (ci < 0) {
        add(off + lead, 'error', '声明缺少冒号: ' + decl.slice(0, 48));
        return;
      }
      const prop = decl.slice(0, ci).trim();
      const val = decl.slice(ci + 1).trim();
      if (!/^(--[\w-]+|-?[a-zA-Z][\w-]*)$/.test(prop)) add(off + lead, 'error', '属性名无效: ' + (prop.slice(0, 32) || '（空）'));
      if (!val) add(off + lead + ci + 1, 'warning', '属性 ' + prop + ' 缺少值');
    };
    while (i < text.length) {
      const c = text[i];
      if (mode === 'comment') {
        if (c === '*' && text[i + 1] === '/') { mode = null; i += 2; continue; }
        i++; continue;
      }
      if (mode === 'string') {
        if (c === '\\') { i += 2; continue; }
        if (c === quote) { mode = null; i++; continue; }
        if (c === '\n') { add(modeIdx, 'error', '字符串未闭合（缺少 ' + quote + '）'); mode = null; segStart = i + 1; i++; continue; }
        i++; continue;
      }
      if (c === '/' && text[i + 1] === '*') { mode = 'comment'; modeIdx = i; i += 2; continue; }
      if (c === '"' || c === "'") { mode = 'string'; quote = c; modeIdx = i; i++; continue; }
      if (c === '(') { paren++; i++; continue; }
      if (c === ')') { if (paren) paren--; else add(i, 'error', '多余的右括号 )'); i++; continue; }
      if (paren === 0 && c === '{') {
        if (!text.slice(segStart, i).trim()) add(i, 'error', '缺少选择器或 @ 规则');
        depth++; blocks.push(i); segStart = i + 1; i++; continue;
      }
      if (paren === 0 && c === '}') {
        checkDecl(text.slice(segStart, i), segStart);
        if (!depth) add(i, 'error', '多余的右花括号 }');
        else { depth--; blocks.pop(); }
        segStart = i + 1; i++; continue;
      }
      if (paren === 0 && c === ';') {
        checkDecl(text.slice(segStart, i), segStart);
        segStart = i + 1; i++; continue;
      }
      i++;
    }
    if (mode === 'comment') add(modeIdx, 'error', '注释 /* 未闭合');
    if (mode === 'string') add(modeIdx, 'error', '字符串未闭合（缺少 ' + quote + '）');
    if (paren) add(text.length, 'error', '圆括号未闭合（缺少 )');
    blocks.forEach(idx => add(idx, 'error', '规则块未闭合（缺少 }）'));
    return list;
  }
  function validateHtml(src, fileName) {
    const text = String(src || '');
    const starts = lineStartsOf(text);
    const lines = text.split('\n');
    const list = [];
    const add = (idx, severity, message) => {
      const p = locateIn(text, starts, idx, 1);
      list.push({ line: p.line, col: p.col, severity, message, file: fileName || 'index.html', source: (lines[p.line - 1] || '').trim() });
    };
    const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    const OPTIONAL = new Set(['p', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'option', 'html', 'head', 'body', 'thead', 'tbody', 'tfoot', 'colgroup', 'rt', 'rp']);
    const RAW = new Set(['script', 'style', 'textarea', 'title']);
    const BLOCK_CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'pre', 'section', 'table', 'ul']);
    const stack = [];
    const autoPop = pred => { while (stack.length && pred(stack[stack.length - 1].name)) stack.pop(); };
    let i = 0;
    while (i < text.length) {
      const lt = text.indexOf('<', i);
      if (lt < 0) break;
      if (text.startsWith('<!--', lt)) {
        const end = text.indexOf('-->', lt + 4);
        if (end < 0) { add(lt, 'error', '注释 <!-- 未闭合'); break; }
        i = end + 3; continue;
      }
      if (text.startsWith('<!', lt) || text.startsWith('<?', lt)) {
        const end = text.indexOf('>', lt + 2);
        if (end < 0) { add(lt, 'error', '声明未闭合（缺少 >）'); break; }
        i = end + 1; continue;
      }
      const after = text.charAt(lt + 1);
      if (!/[A-Za-z/]/.test(after)) { i = lt + 1; continue; }
      let j = lt + 1, quote = null, closed = -1;
      while (j < text.length) {
        const c = text[j];
        if (quote) { if (c === quote) quote = null; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '>') { closed = j; break; }
        j++;
      }
      if (closed < 0) {
        add(lt, 'error', quote ? '标签属性引号未闭合' : '标签未闭合（缺少 >）');
        break;
      }
      const raw = text.slice(lt + 1, closed);
      const m = /^\s*(\/)?\s*([A-Za-z][\w:.-]*)/.exec(raw);
      if (!m) { add(lt, 'error', '标签语法无效'); i = closed + 1; continue; }
      const closing = !!m[1];
      const name = m[2].toLowerCase();
      const selfClose = !closing && /\/\s*$/.test(raw);
      if (closing) {
        if (VOID.has(name)) { add(lt, 'warning', '空元素 <' + name + '> 不需要结束标签'); i = closed + 1; continue; }
        let idx = -1;
        for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === name) { idx = k; break; }
        if (idx < 0) add(lt, 'error', '多余的结束标签 </' + name + '>');
        else {
          for (let k = stack.length - 1; k > idx; k--) {
            const s = stack[k];
            if (!OPTIONAL.has(s.name)) add(s.idx, 'error', '标签 <' + s.name + '> 未闭合');
          }
          stack.length = idx;
        }
        i = closed + 1; continue;
      }
      const styleM = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(raw);
      if (styleM) {
        const css = styleM[1] != null ? styleM[1] : styleM[2];
        css.split(';').map(s => s.trim()).filter(Boolean).forEach(d => {
          if (!/^(--[\w-]+|-?[a-zA-Z][\w-]*)\s*:\s*.+$/.test(d)) add(lt, 'warning', '内联样式声明无效: ' + d.slice(0, 48));
        });
      }
      if (name === 'li') autoPop(n => n === 'li');
      else if (name === 'dt' || name === 'dd') autoPop(n => n === 'dt' || n === 'dd');
      else if (name === 'td' || name === 'th') autoPop(n => n === 'td' || n === 'th');
      else if (name === 'tr') { autoPop(n => n === 'td' || n === 'th'); autoPop(n => n === 'tr'); }
      else if (name === 'option') autoPop(n => n === 'option');
      if (BLOCK_CLOSES_P.has(name)) autoPop(n => n === 'p');
      if (RAW.has(name) && !selfClose) {
        const re = new RegExp('</\\s*' + name + '\\s*>', 'ig');
        re.lastIndex = closed + 1;
        const end = re.exec(text);
        if (!end) { add(lt, 'error', '<' + name + '> 未闭合'); break; }
        i = end.index + end[0].length; continue;
      }
      if (!VOID.has(name) && !selfClose) stack.push({ name, idx: lt });
      i = closed + 1;
    }
    stack.forEach(s => { if (!OPTIONAL.has(s.name)) add(s.idx, 'error', '标签 <' + s.name + '> 未闭合'); });
    return list;
  }
  function validateHtmlDoc(src, fileName) {
    const text = String(src || '');
    const list = validateHtml(text, fileName);
    const re = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
    let m;
    while ((m = re.exec(text))) {
      const openEnd = m.index + m[0].indexOf('>') + 1;
      const baseLine = text.slice(0, openEnd).split('\n').length;
      validateCss(m[1], baseLine, fileName).forEach(d => list.push(d));
    }
    list.sort((a, b) => a.line - b.line || a.col - b.col);
    return list;
  }

  /* ================================================================ CODE FORGE */
  function createForge(body, win) {
    const toolMode = (() => {
      const modes = (BC.BOOT.bridge && BC.BOOT.bridge.modes) || [];
      if (BC.BOOT.bridge && BC.BOOT.bridge.linuxAvailable) return BC.BOOT.platform === 'linux' ? 'bash' : 'linux';
      if (modes.some(m => m.id === 'gitbash' && m.available)) return 'gitbash';
      if (modes.some(m => m.id === 'powershell' && m.available)) return 'powershell';
      return null;
    })();
    const bashLike = toolMode === 'bash' || toolMode === 'linux' || toolMode === 'gitbash';
    const isWin = BC.BOOT.platform === 'windows';
    const exe = isWin ? '.exe' : '';

    body.innerHTML =
      '<div class="app forge-app">' +
        '<div class="app-toolbar wrap">' +
          '<span class="toolbar-title">Code Forge</span><span class="toolbar-sub">REAL COMPILER BRIDGE</span>' +
          '<select class="select" id="forgeLang" aria-label="语言" style="height:28px;font-size:10px;padding:0 7px;margin-left:4px"></select>' +
          '<span class="chip" id="forgeFile">main.js</span><span class="spacer"></span>' +
          '<span class="lang-status" id="forgeTools">检测工具链…</span>' +
          '<button class="btn" data-f="savecopy">' + U.icon('save') + ' 保存副本</button>' +
          '<button class="btn" data-f="editor">' + U.icon('editor') + ' 编辑器</button>' +
          '<button class="btn primary" data-f="run" id="forgeRun">' + U.icon('play') + ' 运行</button>' +
        '</div>' +
        '<div id="forgeCustom" style="display:none;padding:7px 11px;border-bottom:1px solid var(--line);gap:7px;align-items:center;flex:none">' +
          '<span style="font-family:var(--mono);font-size:8px;color:var(--dim);letter-spacing:.1em">FILE</span><input class="input" id="forgeCustomFile" value="main.txt" style="width:110px;height:27px;font-size:10px">' +
          '<span style="font-family:var(--mono);font-size:8px;color:var(--dim);letter-spacing:.1em">CMD</span><input class="input" id="forgeCustomCmd" placeholder="lua {file}    perl {file}    Rscript {file}" style="flex:1;height:27px;font-size:10px">' +
        '</div>' +
        '<div class="forge-split">' +
          '<div class="forge-editor"><textarea class="forge-code" id="forgeCode" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea></div>' +
          '<div class="forge-output" id="forgeOutput"><div class="forge-out-head"><span id="forgeOutHead">CONSOLE</span><span class="spacer"></span><span id="forgeOutStatus">IDLE</span><button class="icon-btn small" data-f="clear" title="清空输出">' + U.icon('trash') + '</button></div><div class="forge-diag" id="forgeDiag"></div><pre class="forge-out" id="forgeOut">// 运行代码后，真实进程的标准输出与错误会显示在这里。\n// 工具链缺失时不会伪造输出，只会给出真实错误。</pre><iframe class="forge-preview" id="forgePreview" sandbox="allow-scripts allow-modals" title="代码预览"></iframe></div>' +
        '</div>' +
        '<div class="app-status"><span class="ok" id="forgeStatus">READY</span><span id="forgeShell">' + U.esc(toolMode ? 'SHELL · ' + toolMode.toUpperCase() : 'NO UNIX SHELL') + '</span><span class="spacer"></span><span>WRITE → COMPILE → RUN</span></div>' +
      '</div>';
    const codeEl = $('#forgeCode', body), outEl = $('#forgeOut', body), outWrap = $('#forgeOutput', body), diagEl = $('#forgeDiag', body);
    let preview = $('#forgePreview', body);
    const langSel = $('#forgeLang', body), fileChip = $('#forgeFile', body), statusEl = $('#forgeStatus', body);
    const toolsEl = $('#forgeTools', body), runBtn = $('#forgeRun', body);
    let lang = LANGUAGES.find(l => l.id === BC.store.get('forge.lang', 'javascript')) || LANGUAGES[0];
    let running = false, ctrl = null, customFile = BC.store.get('forge.customFile', 'main.txt'), customCmd = BC.store.get('forge.customCmd', ''), toolState = null;

    langSel.innerHTML = LANGUAGES.map(l => '<option value="' + l.id + '">' + U.esc(l.name) + '</option>').join('');
    langSel.value = lang.id;

    const saveDraft = U.debounce(() => {
      BC.store.set('forge.draft.' + lang.id, codeEl.value);
      BC.store.set('forge.lang', lang.id);
    }, 400);
    function filename() {
      if (lang.custom) return sanitizeFile(customFile || 'main.txt');
      return lang.file;
    }
    function defaultTemplate(l) {
      if (l.templates) return l.templates[isWin ? 'win' : 'unix'] || l.template;
      return l.template;
    }
    function sanitizeFile(n) {
      const f = String(n || '').trim().replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '');
      return f || 'main.txt';
    }
    function shellQuote(f) { return '"' + f.replace(/["`$\\]/g, '\\$&') + '"'; }
    function commandFor() {
      const f = filename();
      if (lang.custom) {
        const t = (customCmd || '').trim();
        if (!t) return null;
        const c = t.replace(/\{file\}/g, f);
        return bashLike ? 'cd Projects/.forge && ' + c : 'Set-Location "Projects/.forge"; ' + c;
      }
      if (bashLike) {
        const pre = 'cd Projects/.forge && ';
        const py = 'if python3 -c "import sys" >/dev/null 2>&1; then python3 ' + shellQuote(f) + '; else python ' + shellQuote(f) + '; fi';
        const table = {
          javascript: 'node ' + shellQuote(f),
          typescript: 'node ' + shellQuote(f),
          python: py,
          ascii: 'node ' + shellQuote(f),
          c: 'gcc -g -O0 -Wall -Wextra ' + shellQuote(f) + ' -o bcout' + exe + ' && ./bcout' + exe,
          cpp: 'g++ -g -O0 -Wall -Wextra ' + shellQuote(f) + ' -o bcout' + exe + ' && ./bcout' + exe,
          asm: 'gcc -g -O0 ' + shellQuote(f) + ' -o bcout' + exe + ' && ./bcout' + exe,
          rust: 'rustc -g ' + shellQuote(f) + ' -o bcout' + exe + ' && ./bcout' + exe,
          go: 'go run ' + shellQuote(f),
          java: 'javac -g Hello.java && java Hello',
          ruby: 'ruby ' + shellQuote(f),
          php: 'php -d display_errors=1 -d error_reporting=E_ALL ' + shellQuote(f),
          bash: 'bash ' + shellQuote(f),
          powershell: 'pwsh -NoProfile -File ' + shellQuote(f) + ' 2>/dev/null || powershell.exe -NoProfile -ExecutionPolicy Bypass -File ' + shellQuote(f)
        };
        return pre + table[lang.id];
      }
      const table = {
        javascript: 'node "' + f + '"', typescript: 'node "' + f + '"',
        python: 'python "' + f + '"', ascii: 'node "' + f + '"',
        c: 'gcc -g -O0 -Wall -Wextra "' + f + '" -o bcout.exe; if ($LASTEXITCODE -eq 0) { ./bcout.exe }',
        cpp: 'g++ -g -O0 -Wall -Wextra "' + f + '" -o bcout.exe; if ($LASTEXITCODE -eq 0) { ./bcout.exe }',
        asm: 'gcc -g -O0 "' + f + '" -o bcout.exe; if ($LASTEXITCODE -eq 0) { ./bcout.exe }',
        rust: 'rustc -g "' + f + '" -o bcout.exe; if ($LASTEXITCODE -eq 0) { ./bcout.exe }',
        go: 'go run "' + f + '"', java: 'javac -g Hello.java; if ($LASTEXITCODE -eq 0) { java Hello }',
        ruby: 'ruby "' + f + '"', php: 'php "' + f + '"', bash: 'bash "' + f + '"',
        powershell: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + f + '"'
      };
      return 'Set-Location "Projects/.forge"; ' + table[lang.id];
    }
    function setOutput(text) { outEl.textContent = text; outEl.scrollTop = outEl.scrollHeight; }
    function clearDiag() { diagEl.classList.remove('show'); diagEl.innerHTML = ''; }
    function previewDiagnostics() {
      const file = filename();
      return lang.id === 'css' ? validateCss(codeEl.value, 1, file) : validateHtmlDoc(codeEl.value, file);
    }
    function previewDocument() {
      if (lang.id !== 'css') return codeEl.value;
      const css = codeEl.value.replace(/<\/style/gi, '<\\/style');
      return '<!doctype html>\n<html lang="zh">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>CSS PREVIEW</title>\n<style>\n' + css +
        '\n</style>\n</head>\n<body>\n<div class="card">\n  <h1>CSS PREVIEW</h1>\n  <p>编辑左侧样式，预览与诊断会实时更新。</p>\n  <button>HOVER TEST</button>\n</div>\n</body>\n</html>\n';
    }
    function previewStats(diags) {
      const errs = diags.filter(d => d.severity === 'error').length;
      const warns = diags.filter(d => d.severity === 'warning').length;
      return { errs, warns, code: errs ? 'LINT · ' + errs + ' ERR' : warns ? 'LINT · ' + warns + ' WARN' : 'LINT OK' };
    }
    function setPreview(html) {
      // Chromium 可能不重新加载已有的 srcdoc，重建 iframe 才能可靠刷新
      const old = $('#forgePreview', body);
      const on = old && old.classList.contains('on');
      const next = document.createElement('iframe');
      next.id = 'forgePreview';
      next.className = 'forge-preview' + (on ? ' on' : '');
      next.setAttribute('sandbox', 'allow-scripts allow-modals');
      next.title = '代码预览';
      next.srcdoc = html;
      old.replaceWith(next);
      preview = next;
    }
    const lintPreview = U.debounce(() => {
      if (!lang.preview) return;
      const diags = previewDiagnostics();
      renderDiagnostics(diags, 0);
      const st = previewStats(diags);
      $('#forgeOutStatus', body).textContent = st.code;
      if (preview.classList.contains('on')) setPreview(previewDocument());
    }, 500);
    function focusLine(line, col) {
      const lines = codeEl.value.split('\n');
      if (!line || line < 1 || line > lines.length) return;
      let start = 0;
      for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
      const end = start + lines[line - 1].length;
      const at = start + Math.min(Math.max((col || 1) - 1, 0), lines[line - 1].length);
      codeEl.focus();
      codeEl.setSelectionRange(at, end);
      codeEl.scrollTop = Math.max(0, (line - 1) * 18.6 - codeEl.clientHeight * 0.35);
      codeEl.classList.remove('diag-flash');
      void codeEl.offsetWidth;
      codeEl.classList.add('diag-flash');
      setTimeout(() => codeEl.classList.remove('diag-flash'), 1400);
    }
    function parseDiagnostics(text, langId, fileName) {
      const out = String(text || '');
      const base = String(fileName || filename()).replace(/\\/g, '/').split('/').pop().toLowerCase();
      const sameFile = p => {
        const got = String(p || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
        return !base || got === base;
      };
      const list = [], seen = new Set();
      const srcLines = codeEl.value.split('\n');
      const add = (line, col, severity, message) => {
        const ln = Number(line) || 0;
        if (!ln) return;
        const sev = /warn/i.test(String(severity)) ? 'warning' : /error|fatal/i.test(String(severity)) ? 'error' : 'note';
        if (sev === 'note') return;
        const msg = String(message || '').replace(/\s+/g, ' ').trim();
        if (!msg) return;
        const key = [ln, Number(col) || 0, sev, msg].join('|');
        if (seen.has(key)) return;
        seen.add(key);
        list.push({ line: ln, col: Math.max(0, Number(col) || 0), severity: sev, message: msg, file: base, source: (srcLines[ln - 1] || '').trim() });
      };

      const generic = /^(.+?):(\d+):(?:\s*(\d+):)?\s*(fatal error|error|warning|note):\s*(.*)$/gmi;
      let m;
      while ((m = generic.exec(out))) {
        if (!sameFile(m[1])) continue;
        add(m[2], m[3], m[4], m[5]);
      }

      const goRe = /^(.+?\.go):(\d+):(\d+):\s*(.+)$/gmi;
      while ((m = goRe.exec(out))) {
        if (sameFile(m[1])) add(m[2], m[3], 'error', m[4]);
      }
      const goPanic = /^(.+?\.go):(\d+)\s+\+0x[0-9a-f]+$/gmi;
      const panicMsg = /^(?:panic:\s*|fatal error:\s*)(.+)$/m.exec(out);
      while ((m = goPanic.exec(out))) {
        if (sameFile(m[1])) add(m[2], 0, 'error', panicMsg ? panicMsg[1] : 'Go runtime panic');
      }

      const rlines = out.split(/\r?\n/);
      for (let i = 0; i < rlines.length; i++) {
        const h = /^\s*(error|warning)(?:\[([A-Z]\d+)\])?:\s*(.+?)\s*$/.exec(rlines[i]);
        if (!h || /^aborting due to/.test(h[3])) continue;
        let loc = null;
        for (let j = i + 1; j < Math.min(i + 10, rlines.length); j++) {
          const lm = /^\s*-->\s*(.+?):(\d+):(\d+)/.exec(rlines[j]);
          if (lm) { loc = lm; break; }
        }
        if (loc && sameFile(loc[1])) add(loc[2], loc[3], h[1], (h[2] ? '[' + h[2] + '] ' : '') + h[3]);
      }

      const jex = /^(?:Exception in thread "[^"]*"\s*)?([\w.$]+(?:Exception|Error)):\s*(.*)$/m.exec(out);
      if (jex) {
        const jf = /at\s+[\w.$]+\(([^():]+\.java):(\d+)\)/g;
        while ((m = jf.exec(out))) {
          if (sameFile(m[1])) { add(m[2], 0, 'error', jex[1] + ': ' + jex[2]); break; }
        }
      }

      const frames = [];
      const fr = /^\s*File "([^"]+)", line (\d+)/gm;
      while ((m = fr.exec(out))) frames.push({ file: m[1], line: +m[2] });
      const pex = /^([A-Za-z_][\w.]*(?:Error|Exception|Interrupt|Exit|Warning)):\s*(.*)$/m.exec(out);
      if (pex && frames.length) {
        const f = frames.filter(x => sameFile(x.file)).pop();
        if (f) add(f.line, 0, /Warning$/.test(pex[1]) ? 'warning' : 'error', pex[1] + ': ' + pex[2]);
      }

      const nex = /^([A-Za-z_$][\w$]*(?:Error|Exception)):\s*(.*)$/m.exec(out);
      if (nex) {
        const nfs = [];
        const nf = /\(?([^()\s]+?):(\d+):(\d+)\)?/g;
        while ((m = nf.exec(out))) nfs.push({ file: m[1], line: +m[2], col: +m[3] });
        let f = nfs.find(x => sameFile(x.file));
        if (!f) {
          const nf2 = /^(.+?\.js):(\d+)\s*$/gm;
          while ((m = nf2.exec(out))) if (sameFile(m[1])) f = { file: m[1], line: +m[2], col: 0 };
        }
        if (f) add(f.line, f.col, 'error', nex[1] + ': ' + nex[2]);
      }

      const phpRe = /^PHP (Parse|Fatal|Warning|Notice|Deprecated) error:\s*(.*)$/gmi;
      while ((m = phpRe.exec(out))) {
        const loc = /\s+in\s+(.+?)(?::(\d+)|\s+on line\s+(\d+))\s*$/.exec(m[2]);
        if (!loc || !sameFile(loc[1])) continue;
        const msg = m[2].replace(/\s+in\s+.+$/, '').replace(/\s+/g, ' ').trim();
        add(loc[2] || loc[3], 0, /Parse|Fatal/.test(m[1]) ? 'error' : 'warning', m[1] + ' error: ' + msg);
      }

      const bashRe = /^(.+?): line (\d+):\s*(.*)$/gmi;
      while ((m = bashRe.exec(out))) {
        if (sameFile(m[1])) add(m[2], 0, 'error', m[3]);
      }

      return list;
    }
    function renderDiagnostics(list, exitCode) {
      const errors = list.filter(d => d.severity === 'error');
      const warnings = list.filter(d => d.severity === 'warning');
      if (!list.length) {
        if (exitCode !== 0) {
          diagEl.innerHTML = '<div class="forge-diag-head"><span class="bad">EXIT ' + exitCode + '</span><span>未能自动解析诊断，请查看上方原始错误输出。</span></div>';
          diagEl.classList.add('show');
        } else clearDiag();
        return;
      }
      const shown = list.slice(0, 80);
      const rows = shown.map((d, i) =>
        '<button class="forge-diag-row ' + d.severity + '" data-diag="' + i + '">' +
          '<span class="fdg-sev">' + (d.severity === 'error' ? '错误' : '警告') + '</span>' +
          '<span class="fdg-loc">' + U.esc(d.file) + ':' + d.line + (d.col ? ':' + d.col : '') + '</span>' +
          '<span class="fdg-msg">' + U.esc(d.message) + (d.source ? '<code>' + U.esc(d.source) + '</code>' : '') + '</span>' +
        '</button>'
      ).join('');
      const head = '<div class="forge-diag-head">' +
        (errors.length ? '<span class="bad">✕ ' + errors.length + ' 处错误</span>' : '<span class="good">✓ 无错误</span>') +
        (warnings.length ? '<span class="warn">⚠ ' + warnings.length + ' 处警告</span>' : '') +
        '<span class="spacer"></span><span class="hint">点击诊断跳转到源码</span>' +
      '</div>';
      diagEl.innerHTML = head + '<div class="forge-diag-list">' + rows + '</div>' +
        (list.length > shown.length ? '<div class="forge-diag-more">仅显示前 ' + shown.length + ' 条，共 ' + list.length + ' 条诊断。</div>' : '');
      diagEl.classList.add('show');
      diagEl.querySelectorAll('[data-diag]').forEach(btn => {
        btn.addEventListener('click', () => {
          const d = list[Number(btn.dataset.diag)];
          if (d) focusLine(d.line, d.col);
        });
      });
    }
    function stop() {
      if (ctrl) { try { ctrl.abort(); } catch { } }
      ctrl = null; running = false;
      runBtn.innerHTML = U.icon('play') + ' 运行';
      statusEl.textContent = 'STOPPED'; statusEl.className = 'warn';
    }
    function togglePreview(on) {
      outWrap.classList.toggle('preview', !!on);
      preview.classList.toggle('on', !!on);
      $('#forgeOutHead', body).textContent = on ? 'PREVIEW · SANDBOXED IFRAME' : 'CONSOLE';
    }
    async function run() {
      if (running) { stop(); return; }
      if (lang.preview) {
        const diags = previewDiagnostics();
        renderDiagnostics(diags, 0);
        setPreview(previewDocument());
        togglePreview(true);
        const st = previewStats(diags);
        $('#forgeOutStatus', body).textContent = st.code;
        statusEl.textContent = 'PREVIEW · SANDBOXED' + (st.errs ? ' · ' + st.errs + ' 处错误' : st.warns ? ' · ' + st.warns + ' 处警告' : '');
        statusEl.className = st.errs ? 'err' : st.warns ? 'warn' : 'ok';
        return;
      }
      if (!toolMode) { setOutput('没有可用的 Unix 风格 Shell。\nLinux Core 或 Git Bash 不可用，无法调用编译工具链。'); return; }
      const cmd = commandFor();
      if (!cmd) { setOutput('自定义运行模式需要在“CMD”中填写命令，并用 {file} 作为文件名占位。'); BC.toast('缺少自定义命令'); return; }
      const f = filename();
      setOutput('$ ' + cmd + '\n');
      clearDiag();
      togglePreview(false);
      running = true; runBtn.innerHTML = U.icon('pause') + ' 停止'; statusEl.textContent = 'RUNNING'; statusEl.className = 'warn';
      $('#forgeOutStatus', body).textContent = 'RUNNING';
      try {
        await A.fsWrite('/Projects/.forge/' + f, codeEl.value);
      } catch (e) {
        setOutput('写入工作区失败: ' + e.message);
        running = false; runBtn.innerHTML = U.icon('play') + ' 运行'; statusEl.textContent = 'WRITE FAILED'; statusEl.className = 'err';
        return;
      }
      let ended = false;
      try {
        const c = await A.execStream({ cmd, mode: toolMode, cwd: toolMode === 'linux' ? (BC.BOOT.homeUnix || BC.BOOT.home) : (BC.BOOT.homeUnix && BC.BOOT.platform !== 'windows' ? BC.BOOT.homeUnix : BC.BOOT.home) }, {
          onController: x => { ctrl = x; },
          onData: d => { setOutput(outEl.textContent + strip(d)); },
          onEnd: ev => {
            ended = true; running = false; ctrl = null;
            runBtn.innerHTML = U.icon('play') + ' 运行';
            const diags = parseDiagnostics(outEl.textContent, lang.id, f);
            const errs = diags.filter(d => d.severity === 'error').length;
            const warns = diags.filter(d => d.severity === 'warning').length;
            renderDiagnostics(diags, ev.code);
            statusEl.textContent = (ev.code === 0 ? 'EXIT 0' : 'EXIT ' + ev.code) +
              (errs ? ' · ' + errs + ' 处错误' : '') +
              (warns ? ' · ' + warns + ' 处警告' : '') +
              ' · ' + U.fmtDuration(ev.duration);
            statusEl.className = ev.code === 0 ? 'ok' : 'err';
            $('#forgeOutStatus', body).textContent = errs ? 'ERRORS · ' + errs : warns ? 'WARN · ' + warns : (ev.code === 0 ? 'DONE · 0' : 'EXIT ' + ev.code);
            if (ev.timedOut) setOutput(outEl.textContent + '\n[batcave] 执行超时。');
            if (ev.truncated) setOutput(outEl.textContent + '\n[batcave] 输出已截断。');
          }
        });
        ctrl = c;
      } catch (e) {
        if (e.aborted) { setOutput(outEl.textContent + '\n[batcave] 已停止。'); }
        else if (!ended) { setOutput(outEl.textContent + '\n[batcave] ' + e.message); statusEl.textContent = 'ERROR'; statusEl.className = 'err'; }
        running = false; ctrl = null; runBtn.innerHTML = U.icon('play') + ' 运行';
      }
    }
    function switchLang(id, force) {
      if (running) stop();
      BC.store.set('forge.draft.' + lang.id, codeEl.value);
      lang = LANGUAGES.find(l => l.id === id) || LANGUAGES[0];
      langSel.value = lang.id;
      fileChip.textContent = lang.file;
      $('#forgeCustom', body).style.display = lang.custom ? 'flex' : 'none';
      $('#forgeCustomFile', body).value = customFile;
      $('#forgeCustomCmd', body).value = customCmd;
      const draft = BC.store.get('forge.draft.' + lang.id, null);
      codeEl.value = (typeof draft === 'string' && draft.length) ? draft : defaultTemplate(lang);
      clearDiag();
      togglePreview(false);
      $('#forgeOutHead', body).textContent = 'CONSOLE';
      setOutput('// ' + lang.name + ' · 已载入。运行后显示真实进程输出。');
      $('#forgeOutStatus', body).textContent = 'IDLE';
      statusEl.textContent = 'READY'; statusEl.className = 'ok';
      BC.store.set('forge.lang', lang.id);
      saveToolsHint();
    }
    function saveToolsHint() {
      const map = { javascript: ['node'], typescript: ['node'], python: ['python3', 'python'], ascii: ['node'], c: ['gcc'], cpp: ['g++'], asm: ['gcc', 'as'], rust: ['rustc'], go: ['go'], java: ['javac'], ruby: ['ruby'], php: ['php'], bash: ['bash'], powershell: ['pwsh'], html: [], css: [], custom: [] };
      const list = map[lang.id] || [];
      if (!list.length) { toolsEl.textContent = lang.preview ? 'BROWSER SANDBOX' : 'ANY RUNTIME'; return; }
      if (!toolState) { toolsEl.textContent = list.map(x => x + ' · ?').join('  '); return; }
      toolsEl.textContent = list.map(x => x + (toolState.has(x) ? ' ✓' : ' ✗')).join('  ');
      toolsEl.style.color = list.some(x => toolState.has(x)) ? 'var(--ok)' : 'var(--warn)';
      toolsEl.title = '已检测: ' + Array.from(toolState).join(', ');
    }
    async function detectTools() {
      if (!bashLike) { toolsEl.textContent = 'TOOLCHAIN SCAN NEEDS BASH'; return; }
      const cmd = 'for c in node python3 python gcc g++ as nasm rustc go javac ruby php pwsh; do if command -v "$c" >/dev/null 2>&1; then echo "OK $c"; else echo "MISS $c"; fi; done';
      let out = '';
      try {
        await A.execStream({ cmd, mode: toolMode, cwd: BC.BOOT.homeUnix || BC.BOOT.home }, { onData: d => { out += strip(d); } });
        toolState = new Set(out.split(/\r?\n/).filter(l => l.startsWith('OK ')).map(l => l.slice(3).trim()));
        saveToolsHint();
      } catch (e) { toolsEl.textContent = 'TOOLCHAIN SCAN FAILED'; toolsEl.title = e.message; }
    }
    async function saveCopy() {
      const name = await BC.ui.prompt('保存源码副本', '将写入真实主目录 Projects/。文件名：', { value: filename(), placeholder: filename() });
      if (!name) return;
      const f = sanitizeFile(name);
      try {
        await A.fsWrite('/Projects/' + f, codeEl.value);
        BC.toast('已保存到 /Projects/' + f);
        BC.notify('源码已保存', '/Projects/' + f + ' · ' + U.fmtBytes(codeEl.value.length), { icon: 'save', kind: 'ok' });
      } catch (e) { BC.toast('保存失败: ' + e.message); }
    }
    async function openEditor() {
      try {
        await A.fsWrite('/Projects/.forge/' + filename(), codeEl.value);
        BC.openApp('editor', { path: '/Projects/.forge/' + filename() });
      } catch (e) { BC.toast('打开失败: ' + e.message); }
    }
    langSel.addEventListener('change', () => switchLang(langSel.value));
    codeEl.addEventListener('input', () => { saveDraft(); if (lang.preview) lintPreview(); });
    codeEl.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const a = codeEl.selectionStart, b = codeEl.selectionEnd;
        codeEl.value = codeEl.value.slice(0, a) + '  ' + codeEl.value.slice(b);
        codeEl.selectionStart = codeEl.selectionEnd = a + 2;
        saveDraft();
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
    });
    runBtn.addEventListener('click', run);
    $('[data-f="clear"]', body).addEventListener('click', () => { setOutput('// 输出已清空。'); clearDiag(); togglePreview(false); });
    $('[data-f="savecopy"]', body).addEventListener('click', saveCopy);
    $('[data-f="editor"]', body).addEventListener('click', openEditor);
    $('#forgeCustomFile', body).addEventListener('input', e => { customFile = e.target.value; BC.store.set('forge.customFile', customFile); fileChip.textContent = filename(); });
    $('#forgeCustomCmd', body).addEventListener('input', e => { customCmd = e.target.value; BC.store.set('forge.customCmd', customCmd); });
    switchLang(lang.id);
    detectTools();
    return () => { if (running && ctrl) { try { ctrl.abort(); } catch { } } BC.store.set('forge.draft.' + lang.id, codeEl.value); };
  }

  /* ================================================================ BREACH GAME */
  function createBreach(body, win) {
    body.innerHTML =
      '<div class="app game-app">' +
        '<div class="app-toolbar"><span class="toolbar-title">暗网入侵模拟</span><span class="toolbar-sub">LOGIC TRAINING · NO REAL SYSTEMS</span><span class="spacer"></span>' +
          '<button class="btn" data-bg="new">' + U.icon('refresh') + ' 新一局</button>' +
        '</div>' +
        '<div class="game-body">' +
          '<aside class="game-side"><div class="game-stats">' +
            '<div class="gstat"><span>PROBES LEFT</span><b id="bgProbes">22</b></div>' +
            '<div class="gstat"><span>NODES FOUND</span><b id="bgFound">0/6</b></div>' +
            '<div class="gstat"><span>TIME</span><b id="bgTime">0s</b></div>' +
            '<div class="gstat"><span>BEST</span><b id="bgBest">—</b></div>' +
          '</div>' +
          '<p>在 6×6 网格中定位 6 个隐藏节点。点击单元格探测；数字表示相邻节点的数量，<span style="color:var(--acc2)">橙色</span>表示附近有节点。</p>' +
          '<p>共有 22 次探测机会。找到全部节点即成功。这里不连接任何真实系统。</p>' +
          '<div style="margin-top:auto;font-family:var(--mono);font-size:8px;color:var(--dim);line-height:1.7">SIMULATION ONLY<br>NO NETWORK TRAFFIC</div></aside>' +
          '<div class="breach-grid" id="breachGrid"></div>' +
        '</div>' +
        '<div class="app-status"><span class="ok" id="bgStatus">STANDBY</span><span class="spacer"></span><span>6 × 6 GRID</span></div>' +
      '</div>';
    const grid = $('#breachGrid', body);
    const N = 36, NODES = 6, MAX_PROBES = 22;
    let nodes = new Set(), probed = new Set(), found = 0, probes = MAX_PROBES, active = true, startAt = 0, timer = null;
    let best = BC.store.get('breach.best', null);
    const pos = i => [i % 6, Math.floor(i / 6)];
    function neighbors(i) {
      const [x, y] = pos(i), out = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < 6 && ny >= 0 && ny < 6) out.push(ny * 6 + nx);
      }
      return out;
    }
    function bestText() { return best ? best + 's' : '—'; }
    function stats() {
      $('#bgProbes', body).textContent = probes;
      $('#bgFound', body).textContent = found + '/6';
      $('#bgBest', body).textContent = bestText();
    }
    function tickTime() {
      if (!active) return;
      $('#bgTime', body).textContent = Math.floor((Date.now() - startAt) / 1000) + 's';
    }
    function end(winFlag) {
      active = false; clearInterval(timer); timer = null;
      const elapsed = Math.max(1, Math.round((Date.now() - startAt) / 1000));
      if (winFlag) {
        $('#bgStatus', body).textContent = 'BREACH COMPLETE'; $('#bgStatus', body).className = 'ok';
        if (!best || elapsed < best) { best = elapsed; BC.store.set('breach.best', best); }
        BC.notify('入侵完成', '全部 6 个节点已定位 · ' + elapsed + ' 秒', { kind: 'ok', icon: 'game' });
      } else {
        $('#bgStatus', body).textContent = 'OUT OF PROBES'; $('#bgStatus', body).className = 'err';
      }
      stats();
      const overlay = document.createElement('div');
      overlay.className = 'game-overlay';
      overlay.innerHTML = '<h3 style="color:' + (winFlag ? 'var(--ok)' : 'var(--danger)') + '">' + (winFlag ? 'GRID BREACHED' : 'SIGNAL EXPIRED') + '</h3>' +
        '<p>' + (winFlag ? '全部节点已定位。用时 ' + elapsed + ' 秒。' : '探测次数已用尽。网格已重置，可再试一次。') + '</p>' +
        '<button class="btn primary" data-again>再试一次</button>';
      body.querySelector('.game-body').appendChild(overlay);
      overlay.querySelector('[data-again]').addEventListener('click', newGame);
    }
    function clickCell(i) {
      if (!active || probed.has(i)) return;
      probed.add(i); probes--;
      const cell = grid.children[i];
      if (nodes.has(i)) {
        found++; cell.className = 'breach-cell node'; cell.textContent = '◆';
        BC.sound.tap(880);
        if (found === NODES) return end(true);
      } else {
        const count = neighbors(i).filter(n => nodes.has(n)).length;
        cell.className = 'breach-cell probed' + (count ? ' hot' : ' miss');
        cell.textContent = count ? String(count) : '·';
        if (!count) BC.sound.tap(280, .03);
      }
      stats();
      if (probes <= 0) end(false);
    }
    function newGame() {
      const old = body.querySelector('.game-overlay'); if (old) old.remove();
      nodes = new Set();
      while (nodes.size < NODES) nodes.add(Math.floor(Math.random() * N));
      probed = new Set(); found = 0; probes = MAX_PROBES; active = true;
      startAt = Date.now(); clearInterval(timer); timer = setInterval(tickTime, 500);
      $('#bgTime', body).textContent = '0s';
      $('#bgStatus', body).textContent = 'SCANNING'; $('#bgStatus', body).className = 'warn';
      grid.innerHTML = Array.from({ length: N }, (_, i) => '<button class="breach-cell" data-cell="' + i + '">?</button>').join('');
      stats();
    }
    grid.addEventListener('click', e => { const b = e.target.closest('[data-cell]'); if (b) clickCell(Number(b.dataset.cell)); });
    $('[data-bg="new"]', body).addEventListener('click', newGame);
    newGame();
    return () => clearInterval(timer);
  }

  /* ================================================================ CHAT-AI */
  function createChatAI(body, win) {
    body.innerHTML =
      '<div class="app alfred-app">' +
        '<div class="chat-scroll" id="chatScroll"></div>' +
        '<div class="chat-suggest" id="chatSuggest">' +
          ['系统状态', '打开浏览器', '搜索 Gotham', '现在几点', 'Linux Core', '帮助'].map(t => '<button data-sug="' + U.esc(t) + '">' + U.esc(t) + '</button>').join('') +
        '</div>' +
        '<div class="chat-bar"><input id="chatInput" placeholder="向 Chat-AI 下达本地指令…" autocomplete="off"><button class="btn primary" id="chatSend" style="width:38px;height:34px;padding:0;display:grid;place-items:center">' + U.icon('send') + '</button></div>' +
        '<div class="chat-note">LOCAL RULE ENGINE · 不是云端 AI · 不会伪造系统输出 · 危险命令仍需在终端确认</div>' +
      '</div>';
    const scroll = $('#chatScroll', body), input = $('#chatInput', body);
    const APP_ALIAS = [
      ['terminal', '终端', '命令行', 'terminal'],
      ['files', '文件', '文件管理器', 'files'],
      ['browser', '浏览器', '网页', 'browser'],
      ['forge', '代码', '编程', 'forge', 'code'],
      ['monitor', '监视器', '性能', 'monitor'],
      ['settings', '设置', 'settings'],
      ['notes', '笔记', 'notes'],
      ['vault', '保险库', '密码', 'vault'],
      ['music', '音乐', '电台', 'music'],
      ['gallery', '图库', '壁纸', 'gallery'],
      ['weather', '天气', '气象', 'weather'],
      ['map', '地图', 'map'],
      ['security', '安全', 'security'],
      ['breach', '游戏', '入侵模拟', 'breach'],
      ['calc', '计算器', 'calc'],
      ['calendar', '日历', 'calendar'],
      ['taskmgr', '任务管理器', '进程', 'taskmgr'],
      ['editor', '编辑器', 'editor'],
      ['alfred', 'chat-ai', 'chat ai', 'alfred', '对话助手']
    ];
    function time() { return new Date().toLocaleTimeString(); }
    function add(role, text) {
      const div = document.createElement('div');
      div.className = 'msg' + (role === 'me' ? ' me' : '');
      div.innerHTML =
        '<span class="msg-avatar">' + U.icon(role === 'me' ? 'user' : 'alfred') + '</span>' +
        '<div><div class="msg-bubble">' + U.esc(text) + '</div><div class="msg-time">' + (role === 'me' ? 'OPERATOR' : 'CHAT-AI') + ' · ' + time() + '</div></div>';
      scroll.appendChild(div);
      scroll.scrollTop = scroll.scrollHeight;
      BC.sound.tap(role === 'me' ? 620 : 480, .025);
    }
    function findApp(text) {
      const low = String(text || '').toLowerCase();
      for (const row of APP_ALIAS) {
        const id = row[0];
        for (let i = 1; i < row.length; i++) if (low.includes(row[i].toLowerCase())) return id;
      }
      return null;
    }
    async function respond(raw) {
      const text = String(raw || '').trim();
      if (!text) return;
      add('me', text);
      const low = text.toLowerCase();
      if (/^(你好|嗨|hi|hello|chat-ai|chat|ai|alfred|阿尔弗雷德)/i.test(text)) {
        add('alfred', '我在。' + (BC.settings().account || 'BRUCE') + '。我是 Chat-AI，这里是一个本地规则引擎：我可以打开应用、查询真实系统状态、打开网页或把命令交给终端。需要我的能力清单，输入「帮助」。');
        return;
      }
      if (/帮助|能做什么|help|指令/.test(low)) {
        add('alfred', '可用指令：\n• 系统状态 / 现在几点 / 日期\n• 打开终端 / 文件 / 浏览器 / 保险库…\n• 搜索 <关键词> 或 打开 https://…\n• Linux Core / 工具链\n• 运行 <命令>（确认后交给真实终端）\n• 清空聊天\n我不模拟 AI 编造答案；未知指令会直接说明。');
        return;
      }
      if (/清空|clear/.test(low)) {
        scroll.innerHTML = '';
        add('alfred', '会话记录已清空。');
        return;
      }
      if (/几点|时间/.test(text)) { add('alfred', '本机时间：' + new Date().toLocaleString() + '。'); return; }
      if (/日期|几号|星期/.test(text)) { add('alfred', '今天是 ' + new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) + '。'); return; }
      if (/linux core|linux|apt|homebrew|brew/.test(low)) {
        add('alfred', '正在查询 Linux Core…');
        try { const st = await A.linuxStatus(); add('alfred', st.available ? ('Linux Core 在线。引擎：' + (st.engine || '') + (st.distro ? ' · ' + st.distro : '') + '。sudo、apt-get 与 Homebrew 可用（具体取决于发行版配置）。') : ('Linux Core 当前离线。' + (st.note || '') + '\n可以先用 Git Bash 的 Unix 工具，或运行终端命令「linux-core」查看安装说明。')); }
        catch (e) { add('alfred', '查询失败：' + e.message); }
        return;
      }
      if (/工具链|编译器|编程语言|language/.test(low)) {
        add('alfred', 'Code Forge 使用真实编译器/解释器，不伪造执行结果。内置 JavaScript、TypeScript、Python、C、C++、Rust、Go、Java、Ruby、PHP、Bash、PowerShell、HTML 预览，以及“自定义命令”模式（任意已安装运行时）。打开 Code Forge 查看工具链扫描。');
        BC.openApp('forge');
        return;
      }
      if (/系统状态|状态|性能|cpu|内存|memory|system/.test(low)) {
        add('alfred', '正在从本机服务读取真实遥测…');
        try {
          const s = await A.stats();
          add('alfred', 'HOST ' + s.hostname + '\nCPU ' + Math.round(s.cpu.usage) + '% · ' + s.cpu.count + ' 线程\nMEM ' + U.fmtBytes(s.mem.used) + ' / ' + U.fmtBytes(s.mem.total) + '\nUPTIME ' + U.fmtDuration(s.uptime * 1000) + '\nSHELLS ' + (s.bridge.modes || []).filter(m => m.available).map(m => m.label).join(' / '));
        } catch (e) { add('alfred', '读取遥测失败：' + e.message); }
        return;
      }
      const runMatch = text.match(/^(?:运行|执行|命令)\s*[:：]?\s*([\s\S]+)$/);
      if (runMatch) {
        const cmd = runMatch[1].trim();
        if (!cmd) return;
        const ok = await BC.ui.confirm('交给终端执行', 'Chat-AI 将把以下命令发送到真实终端并立即执行：<br><code>' + U.esc(cmd) + '</code><br>危险命令还会在终端中再次要求确认。', { okText: '发送并执行' });
        if (!ok) { add('alfred', '已取消，未执行任何命令。'); return; }
        BC.runInTerminal(cmd);
        add('alfred', '命令已交给终端：' + cmd + '\n请在终端查看真实输出。');
        return;
      }
      const searchMatch = text.match(/^(?:搜索|查找|上网搜|search)\s*[:：]?\s*(.+)$/i);
      if (searchMatch) {
        const q = searchMatch[1].trim();
        const url = 'https://www.bing.com/search?q=' + encodeURIComponent(q);
        BC.openApp('browser', { url });
        add('alfred', '已把搜索交给沙箱浏览器：' + q + '\n复杂站点可能无法完整渲染；如需登录或完整功能，可在浏览器工具栏点“外部打开”。');
        return;
      }
      const urlMatch = text.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) {
        BC.openApp('browser', { url: urlMatch[0] });
        add('alfred', '正在沙箱浏览器中打开 ' + urlMatch[0] + '。');
        return;
      }
      if (/打开|启动|open/.test(low)) {
        const id = findApp(text);
        if (id) { BC.openApp(id); add('alfred', '已打开：' + BC.apps.get(id).name + '。'); }
        else add('alfred', '没有匹配的应用。可以试试：终端、文件、浏览器、Code Forge、监视器、保险库、音乐、天气、地图、安全中心、任务管理器。');
        return;
      }
      if (/你是谁|介绍|about/.test(low)) { add('alfred', '我是 Chat-AI，BATCAVE 的本地命令助手，不是云端大模型。我的回复来自固定规则和正在运行的本机服务；没有联网生成内容，也不会编造命令输出。'); return; }
      const id = findApp(text);
      if (id) { BC.openApp(id); add('alfred', '应用名匹配：' + BC.apps.get(id).name + '。已打开。'); return; }
      add('alfred', '这条指令不在本地规则表内。我不会假装理解或编造回答。\n试试「帮助」查看可用指令，或用「运行 <命令>」把真实命令交给终端。');
    }
    function send(text) {
      const v = (text !== undefined ? text : input.value).trim();
      if (!v) return;
      input.value = '';
      respond(v);
    }
    $('#chatSend', body).addEventListener('click', () => send());
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    $('#chatSuggest', body).addEventListener('click', e => { const b = e.target.closest('[data-sug]'); if (b) send(b.dataset.sug); });
    add('alfred', '晚上好，' + (BC.settings().account || 'BRUCE') + '。我是 Chat-AI —— 这里的本地规则助手，而不是云端 AI。\n可以让我打开应用、读取真实系统状态、搜索网络，或把命令交给终端。输入「帮助」查看能力；未知的请求我会直接说明，不会编造。');
  }

  BC.registerApp({ id: 'forge', name: 'Code Forge', en: 'COMPILER', icon: 'forge', color: '#5ffbf1', width: 980, height: 620, desc: '真实编译器与多语言运行', mount: createForge });
  BC.registerApp({ id: 'breach', name: '暗网入侵模拟', en: 'BREACH GAME', icon: 'game', color: '#ff4f6d', width: 760, height: 520, desc: '6×6 本地逻辑训练', mount: createBreach });
  BC.registerApp({ id: 'alfred', name: 'Chat-AI', en: 'CHAT-AI', icon: 'alfred', color: '#8bd66b', width: 600, height: 560, desc: '本地规则对话助手', mount: createChatAI });
})();