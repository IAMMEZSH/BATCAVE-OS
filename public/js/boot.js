/* BATCAVE OS // launch */
(function () {
  'use strict';
  function launch() {
    try {
      if (!window.BC || typeof BC.start !== 'function') throw new Error('BC kernel failed to load');
      BC.start();
    } catch (e) {
      const root = document.getElementById('boot') || document.body;
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:#04090d;color:#ff8da0;font:12px/1.7 ui-monospace,Consolas,monospace;text-align:center;padding:30px';
      box.innerHTML = '<div><div style="color:#5ffbf1;letter-spacing:.2em;margin-bottom:10px">BATCAVE KERNEL PANIC</div>' + String(e && e.stack || e) + '</div>';
      root.appendChild(box);
      console.error(e);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', launch, { once: true });
  else launch();
})();