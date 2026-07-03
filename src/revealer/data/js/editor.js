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
  var TOKEN = window.__RV_DEV__.token;

  /* --- position-preserving reload ---------------------------------------- */

  var RESTORE_KEY = 'rv-dev-restore';

  function saveStateAndReload() {
    try {
      var idx = (window.Reveal && Reveal.getIndices) ? Reveal.getIndices() : {};
      sessionStorage.setItem(RESTORE_KEY, JSON.stringify({
        h: idx.h || 0, v: idx.v || 0, f: (idx.f === undefined ? -1 : idx.f)
      }));
    } catch (e) { /* sessionStorage unavailable — hash restore still works */ }
    location.reload();
  }

  function restoreState() {
    var raw = null;
    try { raw = sessionStorage.getItem(RESTORE_KEY); } catch (e) {}
    if (!raw) return;
    try { sessionStorage.removeItem(RESTORE_KEY); } catch (e) {}
    try {
      var s = JSON.parse(raw);
      // `hash: true` usually restores the slide already; this also restores
      // the fragment when fragmentInURL is off, and wins over a stale hash.
      Reveal.slide(s.h, s.v, s.f === -1 ? undefined : s.f);
    } catch (e) {}
  }

  if (window.Reveal && Reveal.on) {
    if (Reveal.isReady && Reveal.isReady()) restoreState();
    else Reveal.on('ready', restoreState);
  }

  /* --- build-error overlay ------------------------------------------------ */

  function errorOverlay() {
    var el = document.getElementById('rv-dev-error');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rv-dev-error';
      el.innerHTML =
        '<div class="rv-dev-error-box">' +
        '<div class="rv-dev-error-title">Build failed</div>' +
        '<pre class="rv-dev-error-msg"></pre>' +
        '<pre class="rv-dev-error-tb"></pre>' +
        '<div class="rv-dev-error-actions">' +
        '<button class="rv-dev-open">Open in editor</button>' +
        '<span class="rv-dev-hint">fix + save to dismiss</span>' +
        '</div></div>';
      document.body.appendChild(el);
      el.querySelector('.rv-dev-open').addEventListener('click', function () {
        var line = el.getAttribute('data-line') || '1';
        fetch('/__rv__/open?line=' + encodeURIComponent(line), {
          headers: { 'X-RV-Token': TOKEN }
        });
      });
    }
    return el;
  }

  function showError(ev) {
    var el = errorOverlay();
    el.querySelector('.rv-dev-error-msg').textContent = ev.message || '';
    el.querySelector('.rv-dev-error-tb').textContent = ev.traceback || '';
    el.setAttribute('data-line', ev.line == null ? '1' : String(ev.line));
    el.style.display = 'flex';
  }

  function hideError() {
    var el = document.getElementById('rv-dev-error');
    if (el) el.style.display = 'none';
  }

  /* --- SSE ----------------------------------------------------------------- */

  // The server bakes an active build error into the bootstrap, so a page
  // opened while the build is broken shows the overlay immediately.
  if (window.__RV_DEV__.buildError) {
    if (document.body) showError(window.__RV_DEV__.buildError);
    else document.addEventListener('DOMContentLoaded', function () {
      showError(window.__RV_DEV__.buildError);
    });
  }

  /* --- inspector: edit mode, picking, breadcrumb --------------------------- */

  var edit = {
    on: false,
    sel: null,          // selected [data-rv-src] element
    hover: null,        // hovered [data-rv-src] element
    keyboardWas: null,  // reveal keyboard config to restore
  };

  function layer() {
    var el = document.getElementById('rv-editor-layer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rv-editor-layer';
      el.innerHTML =
        '<div class="rv-ed-outline rv-ed-hover" hidden></div>' +
        '<div class="rv-ed-outline rv-ed-select" hidden></div>' +
        '<div class="rv-ed-bar" hidden>' +
        '<span class="rv-ed-kind"></span>' +
        '<span class="rv-ed-line"></span>' +
        '<button class="rv-ed-open" title="Open the .pres at this line">Open in editor</button>' +
        '<span class="rv-ed-hint">click: select · Esc: parent / exit · E: exit</span>' +
        '</div>';
      document.body.appendChild(el);
      el.querySelector('.rv-ed-open').addEventListener('click', function () {
        if (!edit.sel) return;
        fetch('/__rv__/open?line=' + encodeURIComponent(edit.sel.getAttribute('data-rv-src')),
              { headers: { 'X-RV-Token': TOKEN } });
      });
    }
    return el;
  }

  // Friendly names for the DSL constructs, from their emitted classes.
  var KINDS = [
    ['rv-pin', 'pin'], ['rv-stack', 'stack'], ['rv-layer', 'layer'],
    ['rv-grid-wrap', 'grid'], ['rv-card', 'card'], ['rv-cell', 'card (plain)'],
    ['box-info', 'info box'], ['box-warn', 'warn box'], ['box-good', 'good box'],
    ['math-box', 'equation'], ['rv-table-wrap', 'table'], ['rv-table-cell', 'table cell'],
    ['rv-fig', 'figure'], ['rv-media-fill', 'media'], ['rv-media', 'media'],
    ['region', 'column'], ['row', 'row'], ['rv-paragraph', 'paragraph'],
    ['column', 'text column'], ['fragment', 'fragment'],
  ];

  function kindOf(el) {
    var cls = ' ' + el.className + ' ';
    for (var i = 0; i < KINDS.length; i++) {
      if (cls.indexOf(' ' + KINDS[i][0] + ' ') !== -1 || cls.indexOf(' ' + KINDS[i][0]) !== -1) {
        return KINDS[i][1];
      }
    }
    return el.tagName === 'SECTION' ? 'slide' : el.tagName.toLowerCase();
  }

  function placeOutline(box, el) {
    if (!el || !document.contains(el)) { box.hidden = true; return; }
    var r = el.getBoundingClientRect();
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    box.hidden = false;
  }

  function syncChrome() {
    if (!edit.on) return;
    var el = layer();
    placeOutline(el.querySelector('.rv-ed-hover'), edit.hover !== edit.sel ? edit.hover : null);
    placeOutline(el.querySelector('.rv-ed-select'), edit.sel);
    var bar = el.querySelector('.rv-ed-bar');
    if (edit.sel && document.contains(edit.sel)) {
      var s = edit.sel.getAttribute('data-rv-src');
      var e = edit.sel.getAttribute('data-rv-src-end');
      el.querySelector('.rv-ed-kind').textContent = kindOf(edit.sel);
      el.querySelector('.rv-ed-line').textContent =
        '.pres:' + s + (e ? '–' + e : '');
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
  }

  function pickable(target) {
    if (!target || !target.closest) return null;
    var el = target.closest('[data-rv-src]');
    var slide = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
    if (el && slide && !slide.contains(el) && el.tagName !== 'SECTION') return null;
    return el;
  }

  function onMove(ev) {
    edit.hover = pickable(ev.target);
    syncChrome();
  }

  function onClick(ev) {
    var el = pickable(ev.target);
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();
    edit.sel = el;
    syncChrome();
  }

  function selectParent() {
    if (!edit.sel) { setEdit(false); return; }
    var parent = edit.sel.parentElement && edit.sel.parentElement.closest('[data-rv-src]');
    edit.sel = parent || null;
    syncChrome();
  }

  function setEdit(on) {
    if (on === edit.on) return;
    edit.on = on;
    var el = layer();
    document.documentElement.classList.toggle('rv-edit', on);
    if (on) {
      if (window.Reveal && Reveal.getConfig) {
        edit.keyboardWas = Reveal.getConfig().keyboard;
        Reveal.configure({ keyboard: false });
      }
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
    } else {
      if (window.Reveal && edit.keyboardWas !== null) {
        Reveal.configure({ keyboard: edit.keyboardWas });
        edit.keyboardWas = null;
      }
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      edit.sel = edit.hover = null;
      el.querySelectorAll('.rv-ed-outline').forEach(function (b) { b.hidden = true; });
      el.querySelector('.rv-ed-bar').hidden = true;
    }
    syncChrome();
  }

  document.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (ev.key === 'e' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      setEdit(!edit.on);
      ev.preventDefault();
    } else if (edit.on && ev.key === 'Escape') {
      selectParent();
      ev.preventDefault();
      ev.stopPropagation();
    }
  }, true);

  // Keep the chrome glued to its targets across fits, slides and resizes.
  function hookFit() {
    if (typeof window.fitSlide === 'function' && !window.fitSlide.__rvWrapped) {
      var orig = window.fitSlide;
      var wrapped = function (s) { orig(s); syncChrome(); };
      wrapped.__rvWrapped = true;
      window.fitSlide = wrapped;
    }
  }
  hookFit();
  window.addEventListener('load', hookFit);
  window.addEventListener('resize', syncChrome);
  if (window.Reveal && Reveal.on) {
    Reveal.on('slidechanged', function () { edit.sel = edit.hover = null; syncChrome(); });
  }

  // Debug/testing hook: ?rv-edit=1 auto-enters edit mode (and selects the
  // first annotated element on the current slide with ?rv-select=1).
  var params = new URLSearchParams(location.search);
  if (params.get('rv-edit') === '1') {
    var arm = function () {
      setEdit(true);
      if (params.get('rv-select') === '1') {
        var slide = Reveal.getCurrentSlide();
        edit.sel = slide && slide.querySelector('[data-rv-src]');
        syncChrome();
      }
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
      if (ev.type === 'reload') { hideError(); saveStateAndReload(); }
      else if (ev.type === 'build-error') { showError(ev); }
    };
    // EventSource reconnects on its own; nothing else to do.
  }

  connect();
})();
