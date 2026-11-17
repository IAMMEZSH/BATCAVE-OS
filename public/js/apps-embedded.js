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
          '<span class="spacer" style="flex:1"></span>' +
          '<button class="btn small primary" data-eb="start">启动</button>' +
          '<button class="btn small" data-eb="stop">停止</button>' +
          '<button class="btn small" data-eb="reload">重载</button>' +
          '<button class="btn small" data-eb="external">新窗口</button>' +
        '</div>' +
        '<div class="embedded-stage">' +
          '<div class="embedded-splash" data-eb-splash>' +
            '<div class="term-spinner"></div>' +
            '<b>' + U.esc(cfg.name) + '</b>' +
            '<p>' + U.esc(cfg.desc) + '</p>' +
            '<span class="embedded-hint">首次启动会拉起本机子进程；数据存放于 BATCAVE 数据目录。</span>' +
          '</div>' +
          '<iframe class="embedded-frame hidden" title="' + U.esc(cfg.name) + '" allow="clipboard-read; clipboard-write"></iframe>' +
        '</div>' +
        '<div class="embedded-foot">' + U.esc(cfg.footNote || '') + '</div>' +
        '<div class="app-status"><span data-eb-status class="ok">IDLE</span><span>' + U.esc(cfg.en) + ' · EMBEDDED</span><span class="spacer" style="flex:1"></span><span data-eb-url>—</span></div>' +
      '</div>';

    const frame = body.querySelector('.embedded-frame');
    const splash = body.querySelector('[data-eb-splash]');
    const statusEl = body.querySelector('[data-eb-status]');
    const urlEl = body.querySelector('[data-eb-url]');
    let started = false;

    function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = cls || ''; }
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
          return;
        }
        started = true;
        setStatus('RUNNING', 'ok');
        showFrame(r.url || ('http://127.0.0.1:' + cfg.port + (cfg.path || '/')));
      } catch (e) {
        setStatus('FAILED', 'err');
        showSplash('<b style="color:#ff8fa6">启动失败</b><p>' + U.esc(e.message) + '</p>');
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

    win.setTitle(cfg.name, cfg.en);
    start();
    return () => { frame.src = 'about:blank'; };
  }

  BC.registerApp({
    id: 'tensaint', name: 'TenSaint73OS', en: 'COMMAND NEXUS', icon: 'forge', color: '#63e6be',
    width: 1080, height: 700, minWidth: 640, minHeight: 420, singleton: true,
    desc: '自带社区系统 · 论坛/文件/会员 · 单管理员',
    mount(body, win) {
      return createEmbedded({
        id: 'tensaint', name: 'TenSaint73OS', en: 'COMMAND NEXUS', port: 7781,
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
        id: 'reading', name: '环球报阁', en: 'GLOBAL READING ROOM', port: 7782,
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
        id: 'codeforge', name: 'CodeForge AI', en: 'CODEFORGE AI 1.0.4', port: 7790,
        path: '/console/',
        desc: 'AI 编程中枢：项目浏览、编译运行、诊断与自修复。',
        footNote: '优先复用本机桌面 CodeForge-AI 安装（含模型与配置）；未检测到则运行发行包自带的精简版。'
      }, body, win);
    }
  });
})();