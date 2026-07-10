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
      var frame = document.createElement('div');
      frame.id = 'rv-ed-frame';
      document.body.appendChild(frame);
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
          document.removeEventListener('pointercancel', up, true);
        }
        document.addEventListener('pointermove', mv, true);
        document.addEventListener('pointerup', up, true);
        document.addEventListener('pointercancel', up, true);
      });
    }
    if (div) div.style.display = on ? 'block' : 'none';
    relayout();
  }

  // The stage insets carve the reveal area out of the window: toolbar strip
  // above, hint bar below, editor gap left, panel + gap right.
  var STAGE = { top: 58, left: 10, bottom: 48, gapRight: 10 };

  // The whole deck unit — the reveal element AND the window-absolute fixed
  // chrome (header / footer / logos, which are sized in vh and would
  // otherwise stay stranded at the window edge) — is scaled uniformly into a
  // centred box over the gray stage. Scaling everything by the same
  // window->box map keeps the title glued to its slide, a faithful
  // scaled-down preview.
  function chromeEls() {
    var els = [document.querySelector('.reveal')];
    ['body > header', 'body > footer', '#hlogos'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) els.push(el);
    });
    return els.filter(Boolean);
  }

  function clearStage() {
    chromeEls().forEach(function (el) {
      el.style.removeProperty('transform');
      el.style.removeProperty('transform-origin');
      el.style.removeProperty('z-index');
    });
    var frame = document.getElementById('rv-ed-frame');
    if (frame) frame.style.display = 'none';
  }

  // Reserved top strip for the command band (matches #rv-ed-toolbar height in
  // editor.css). The deck is bottom-docked below it in edit mode.
  var STRIP = 44;

  // Map the whole window uniformly into a box within [sx,sy,sw,sh], bottom-
  // aligned so all vertical slack collects at the top (reclaimed for the band +
  // filmstrip), and optionally size the gray frame to match.
  function stageTransform(sx, sy, sw, sh, pad, frame) {
    var W = window.innerWidth, H = window.innerHeight;
    var f = Math.min((sw - pad * 2) / W, (sh - pad * 2) / H);
    var boxW = W * f, boxH = H * f;
    var tx = sx + (sw - boxW) / 2, ty = sy + (sh - boxH) - pad;   // bottom-aligned
    // Measure untransformed positions first, then map each element uniformly
    // (window point p -> box point t + f*p).
    var els = chromeEls();
    els.forEach(function (el) { el.style.removeProperty('transform'); });
    void els[0].offsetWidth;  // reflow so the rects below are untransformed
    els.forEach(function (el) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('transform-origin', '0 0', 'important');
      el.style.setProperty('transform',
        'translate(' + (tx - r.left * (1 - f)) + 'px,' +
        (ty - r.top * (1 - f)) + 'px) scale(' + f + ')', 'important');
      // above the white #rv-ed-frame (z 0), which would otherwise hide the
      // header / footer / logos (they sit at the deck's own z-index).
      el.style.setProperty('z-index', '1', 'important');
    });
    if (frame) {
      frame.style.display = 'block';
      frame.style.left = tx + 'px'; frame.style.top = ty + 'px';
      frame.style.width = boxW + 'px'; frame.style.height = boxH + 'px';
    }
  }

  function fitStage() {
    if (!document.querySelector('.reveal')) return;
    if (!S.on) { clearStage(); return; }         // preview: plain centered reveal.js
    if (S.splitPref) {
      var pw = parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue('--rv-pw'), 10) || 320;
      var sw = Math.max(40, window.innerWidth - pw - STAGE.left - STAGE.gapRight);
      var sh = Math.max(40, window.innerHeight - STAGE.top - STAGE.bottom);
      var stage = document.getElementById('rv-ed-stage');
      if (stage) {
        stage.style.left = STAGE.left + 'px'; stage.style.top = STAGE.top + 'px';
        stage.style.width = sw + 'px'; stage.style.height = sh + 'px';
      }
      stageTransform(STAGE.left, STAGE.top, sw, sh, 16, document.getElementById('rv-ed-frame'));
    } else {
      // docked edit: full-width stage below the band, no gray frame.
      var fr = document.getElementById('rv-ed-frame');
      if (fr) fr.style.display = 'none';        // clear a frame left over from split
      stageTransform(0, STRIP, window.innerWidth,
                     Math.max(40, window.innerHeight - STRIP), 0, null);
    }
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
