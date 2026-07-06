/* split: docked split view — deck left, panel right, draggable divider with a persisted width */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;

  /* --- docked / split view ------------------------------------------------------------ */

  try { S.splitPref = localStorage.getItem('rv-ed-split') === '1'; } catch (e) {}

  function applyLayout() {
    var on = S.splitPref && S.on;
    document.body.classList.toggle('rv-split', on);
    var div = document.getElementById('rv-ed-divider');
    if (on && !div) {
      div = document.createElement('div');
      div.id = 'rv-ed-divider';
      document.body.appendChild(div);
      div.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        function mv(e2) {
          var w = Math.min(Math.max(window.innerWidth - e2.clientX, 240), window.innerWidth * 0.6);
          document.documentElement.style.setProperty('--rv-pw', w + 'px');
          try { localStorage.setItem('rv-ed-pw', String(w)); } catch (e3) {}
          relayout();
        }
        function up() {
          document.removeEventListener('pointermove', mv, true);
          document.removeEventListener('pointerup', up, true);
        }
        document.addEventListener('pointermove', mv, true);
        document.addEventListener('pointerup', up, true);
      });
    }
    if (div) div.style.display = on ? 'block' : 'none';
    var btn = document.querySelector('#rv-ed-toolbar .rv-tb-view');
    if (btn) btn.classList.toggle('rv-active', S.splitPref);
    relayout();
  }

  var relayoutRaf = null;
  function relayout() {
    if (relayoutRaf) return;
    relayoutRaf = requestAnimationFrame(function () {
      relayoutRaf = null;
      if (window.Reveal && Reveal.layout) Reveal.layout();
      var cur = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
      if (cur && typeof window.fitSlide === 'function') window.fitSlide(cur);
      F.syncChrome();
    });
  }

  try {
    var pw = parseInt(localStorage.getItem('rv-ed-pw') || '', 10);
    if (pw) document.documentElement.style.setProperty('--rv-pw', pw + 'px');
  } catch (e) {}

  // exports (what other editor/ modules call):
  F.applyLayout = applyLayout;
  RV.onChange('on', applyLayout);
  RV.onChange('splitPref', applyLayout);
})();
