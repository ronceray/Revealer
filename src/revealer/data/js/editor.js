/* Revealer dev-mode client — served ONLY by `revealer serve` (never copied
 * into decks: excluded in assets.inject_revealer_assets).
 *
 * Stage A: live-reload over SSE, position-preserving reloads, and a build
 * error overlay. The layout-editing overlay builds on top of this file in
 * later stages.
 */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;
  var TOKEN = RV.token;


  // Debug/testing hook: ?rv-edit=1 auto-enters edit mode (and selects the
  // first annotated element on the current slide with ?rv-select=1).


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


  F.buildToolbar();

  var params = new URLSearchParams(location.search);
  if (params.get('rv-test-edit')) {
    // Headless smoke hook: POST the given ops through the real pipeline.
    var testArm = function () {
      setTimeout(function () {
        try { F.rvPostEdit(JSON.parse(params.get('rv-test-edit'))); }
        catch (e) { F.toast('bad rv-test-edit'); }
      }, 200);
    };
    if (Reveal.isReady && Reveal.isReady()) testArm();
    else Reveal.on('ready', testArm);
  }
  if (params.get('rv-split') === '1') S.splitPref = true;
  if (params.get('rv-edit') === '1') {
    var arm = function () {
      F.setEdit(true);
      var selParam = params.get('rv-select');
      if (selParam) {
        var slide = Reveal.getCurrentSlide();
        S.sel = slide && (selParam === '1'
          ? slide.querySelector('[data-rv-src]')
          : slide.querySelector('[data-rv-src="' + selParam + '"]'));
        F.syncChrome();
      }
      if (params.get('rv-drawer') === '1') F.toggleDrawer();
    };
    if (window.Reveal && Reveal.on) {
      if (Reveal.isReady && Reveal.isReady()) setTimeout(arm, 100);
      else Reveal.on('ready', function () { setTimeout(arm, 100); });
    }
  }

  function connect() {
    var es = new EventSource('/__rv__/events?token=' + encodeURIComponent(TOKEN));
    es.onmessage = function (msg) {
      var ev;
      try { ev = JSON.parse(msg.data); } catch (e) { return; }
      if (ev.type === 'reload') { F.scheduleReload(); }
      else if (ev.type === 'build-error') { F.showError(ev); }
    };
    // EventSource reconnects on its own; nothing else to do.
  }

  connect();

  /* transitional exports — still-unextracted functions consumed by
     already-extracted modules; each moves out as the split proceeds. */
  F.applyLayout = applyLayout;
})();
