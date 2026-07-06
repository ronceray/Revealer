/* Revealer dev-mode editor, core module: served ONLY by `revealer serve`
 * (never copied into decks: excluded in assets.inject_revealer_assets).
 * Creates window.RV — shared state, ui.box widget factory, the RV.fn
 * cross-module namespace — plus position-preserving reloads, toasts and
 * the DOM/construct helpers used by every other editor/ module. */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var TOKEN = window.__RV_DEV__.token;

  /* --- shared editor state: window.RV, explicit ownership --------------------
     S is THE mutable editor state; RV.ui hosts shared widget helpers. The
     12-file split shares state through RV rather than closure capture. */
  var RV = window.RV = {};
  var S = RV.state = {
    on: false,          // edit mode armed
    sel: null,          // selected [data-rv-src] element
    hover: null,        // hovered [data-rv-src] element
    keyboardWas: null,  // reveal keyboard config to restore on exit
    drag: null,         // active drag (kind, el, x0/y0, r0, scale, extras)
    dropState: null,    // block-move / OS-file drop targets + active slot
    splitPref: false,   // split-view preference (seeded from localStorage below)
    nudgeFlush: null,   // pending nudge commit fn (flushNudge runs it early)
    panelFor: null,     // element the side panel currently renders
    nudgeTimer: null,   // debounce timer for arrow-key nudges
  };
  RV.ui = {};
  RV.fn = {};          // shared cross-module function namespace
  RV.token = TOKEN;
  var F = RV.fn;

  function escapeHtml(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  RV.esc = escapeHtml;

  /* Floating box with a shared header row (title, action buttons, ✕).
     Toggle semantics: calling again while the box exists removes it and
     returns null (replace: true recreates instead). closes: [ids] removes
     sibling boxes that would overlap. Returns {box, body}. */
  RV.ui.box = function (opts) {
    var existing = document.getElementById(opts.id);
    if (existing) {
      existing.remove();
      if (!opts.replace) return null;
    }
    (opts.closes || []).forEach(function (otherId) {
      var o = document.getElementById(otherId);
      if (o) o.remove();
    });
    var box = document.createElement('div');
    box.id = opts.id;
    var head = document.createElement('div');
    head.className = 'rv-box-head' + (opts.headCls ? ' ' + opts.headCls : '');
    var title = document.createElement('b');
    title.textContent = opts.title;
    head.appendChild(title);
    if (opts.hint) {
      var hint = document.createElement('span');
      hint.className = 'rv-box-hint';
      hint.textContent = opts.hint;
      head.appendChild(hint);
    }
    (opts.buttons || []).forEach(function (b) {
      var btn = document.createElement('button');
      btn.textContent = b.label;
      if (b.cls) btn.className = b.cls;
      if (b.title) btn.title = b.title;
      btn.addEventListener('click', b.onClick);
      head.appendChild(btn);
    });
    if (opts.close !== false) {
      var x = document.createElement('button');
      x.className = 'rv-box-close';
      x.textContent = '✕';
      x.title = 'Close';
      x.addEventListener('click', function () { box.remove(); });
      head.appendChild(x);
    }
    box.appendChild(head);
    var body = document.createElement('div');
    body.className = 'rv-box-body';
    box.appendChild(body);
    document.body.appendChild(box);
    return { box: box, body: body };
  };

  /* --- position-preserving reload ---------------------------------------- */

  var RESTORE_KEY = 'rv-dev-restore';

  function saveStateAndReload() {
    try {
      var idx = (window.Reveal && Reveal.getIndices) ? Reveal.getIndices() : {};
      sessionStorage.setItem(RESTORE_KEY, JSON.stringify({
        h: idx.h || 0, v: idx.v || 0, f: (idx.f === undefined ? -1 : idx.f),
        editOn: !!S.on,
        selSrc: (S.sel && S.sel.getAttribute) ? S.sel.getAttribute('data-rv-src') : null,
        drawer: !!document.getElementById('rv-ed-drawer')
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
      // An editing session survives the save-rebuild-reload cycle: re-enter
      // edit mode and re-select the same source element when possible.
      if (s.editOn) {
        F.setEdit(true);
        if (s.selSrc) {
          var slide = Reveal.getCurrentSlide();
          var el = slide && slide.querySelector('[data-rv-src="' + s.selSrc + '"]');
          if (el) { S.sel = el; }
          F.syncChrome();
        }
        if (s.drawer) F.toggleDrawer();
      }
    } catch (e) {}
  }

  if (window.Reveal && Reveal.on) {
    if (Reveal.isReady && Reveal.isReady()) restoreState();
    else Reveal.on('ready', restoreState);
  }

  function curSha() {
    var m = document.querySelector('meta[name="rv-src-sha"]');
    return m ? m.getAttribute('content') : '';
  }

  function toast(msg, ms) {
    var el = document.getElementById('rv-ed-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rv-ed-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('rv-on');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('rv-on'); }, ms || 2600);
  }

  // Friendly names for the DSL constructs, from their emitted classes.
  var KINDS = [
    ['revealer-svg', 'svg drawing'],
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

  /* --- construct model -------------------------------------------------------- */

  function hasCls(el, c) { return el.classList && el.classList.contains(c); }

  function constructOf(el) {
    if (!el) return null;
    if (hasCls(el, 'revealer-svg')) return 'svg';
    if (hasCls(el, 'rv-pin')) return 'pin';
    if (hasCls(el, 'rv-fig') || hasCls(el, 'rv-media') || hasCls(el, 'rv-media-fill')) return 'media';
    if (hasCls(el, 'rv-stack')) return 'stack';
    if (hasCls(el, 'rv-layer')) return 'layer';
    if (hasCls(el, 'rv-grid-wrap')) return 'grid';
    if (hasCls(el, 'rv-card') || hasCls(el, 'rv-cell')) return 'card';
    if (hasCls(el, 'rv-table-wrap')) return 'table';
    if (hasCls(el, 'box-info') || hasCls(el, 'box-warn') || hasCls(el, 'box-good')) return 'box';
    if (hasCls(el, 'math-box')) return 'eq';
    if (hasCls(el, 'region')) return 'region';
    if (hasCls(el, 'row')) return 'row';
    if (hasCls(el, 'rv-paragraph')) return 'paragraph';
    if (hasCls(el, 'fragment')) return 'frag';
    return null;
  }

  // Constructs the block-move drag supports (movable text spans).
  var MOVABLE = { pin: 1, media: 1, stack: 1, grid: 1, table: 1, box: 1, eq: 1, frag: 1, row: 1, paragraph: 1 };

  function srcOf(el) { return parseInt(el.getAttribute('data-rv-src'), 10); }
  function srcEndOf(el) {
    var e = el.getAttribute('data-rv-src-end');
    return e ? parseInt(e, 10) : srcOf(el);
  }

  // exports (what other editor/ modules call):
  F.escapeHtml = escapeHtml;
  F.saveStateAndReload = saveStateAndReload;
  F.curSha = curSha;
  F.toast = toast;
  F.kindOf = kindOf;
  F.hasCls = hasCls;
  F.constructOf = constructOf;
  F.srcOf = srcOf;
  F.srcEndOf = srcEndOf;
  RV.MOVABLE = MOVABLE;
})();
