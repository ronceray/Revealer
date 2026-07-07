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
    if (on && !document.getElementById('rv-ed-stage')) {
      var stage = document.createElement('div');
      stage.id = 'rv-ed-stage';
      document.body.appendChild(stage);
    }
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

  // The stage insets carve the reveal area out of the window: toolbar strip
  // above, hint bar below, editor gap left, panel + gap right.
  var STAGE = { top: 58, left: 10, bottom: 48, gapRight: 10 };

  // Shrink .reveal to the largest deck-aspect box that fits the stage,
  // centred, and size the gray backdrop to the whole stage. Called before
  // Reveal.layout() so reveal scales the slide to fill the box (no internal
  // letterbox); the gray shows only outside the box.
  function fitStage() {
    var reveal = document.querySelector('.reveal');
    if (!reveal) return;
    var stage = document.getElementById('rv-ed-stage');
    if (!(S.splitPref && S.on)) {
      ['top', 'left', 'width', 'height'].forEach(function (p) {
        reveal.style.removeProperty(p);
      });
      return;
    }
    var pw = parseInt(getComputedStyle(document.documentElement)
      .getPropertyValue('--rv-pw'), 10) || 320;
    var sx = STAGE.left, sy = STAGE.top;
    var sw = Math.max(40, window.innerWidth - pw - STAGE.left - STAGE.gapRight);
    var sh = Math.max(40, window.innerHeight - STAGE.top - STAGE.bottom);
    if (stage) {
      stage.style.left = sx + 'px';
      stage.style.top = sy + 'px';
      stage.style.width = sw + 'px';
      stage.style.height = sh + 'px';
    }
    var cfg = (window.Reveal && Reveal.getConfig) ? Reveal.getConfig() : {};
    var ar = (cfg.width || 960) / (cfg.height || 700);
    // Fit inside a small inset so there is always a visible gray gutter
    // around the slide (the letterbox reads as intentional even when the
    // stage aspect nearly matches the deck).
    var pad = 16;
    var boxW = Math.min(sw - pad * 2, (sh - pad * 2) * ar);
    var boxH = boxW / ar;
    reveal.style.setProperty('top', (sy + (sh - boxH) / 2) + 'px', 'important');
    reveal.style.setProperty('left', (sx + (sw - boxW) / 2) + 'px', 'important');
    reveal.style.setProperty('width', boxW + 'px', 'important');
    reveal.style.setProperty('height', boxH + 'px', 'important');
  }

  var relayoutRaf = null;
  function relayout() {
    if (relayoutRaf) return;
    relayoutRaf = requestAnimationFrame(function () {
      relayoutRaf = null;
      fitStage();
      if (window.Reveal && Reveal.layout) Reveal.layout();
      var cur = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
      if (cur && typeof window.fitSlide === 'function') window.fitSlide(cur);
      F.syncChrome();
    });
  }

  window.addEventListener('resize', relayout);

  try {
    var pw = parseInt(localStorage.getItem('rv-ed-pw') || '', 10);
    if (pw) document.documentElement.style.setProperty('--rv-pw', pw + 'px');
  } catch (e) {}

  // exports (what other editor/ modules call):
  F.applyLayout = applyLayout;
  RV.onChange('on', applyLayout);
  RV.onChange('splitPref', applyLayout);
})();
