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
        h: idx.h || 0, v: idx.v || 0, f: (idx.f === undefined ? -1 : idx.f),
        editOn: !!edit.on,
        selSrc: (edit.sel && edit.sel.getAttribute) ? edit.sel.getAttribute('data-rv-src') : null,
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
        setEdit(true);
        if (s.selSrc) {
          var slide = Reveal.getCurrentSlide();
          var el = slide && slide.querySelector('[data-rv-src="' + s.selSrc + '"]');
          if (el) { edit.sel = el; }
          syncChrome();
        }
        if (s.drawer) toggleDrawer();
      }
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
        '<button class="rv-dev-open">Open in text editor</button>' +
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
        '<span class="rv-ed-hint">click: select · Esc: parent / exit · Del: delete · E: exit</span>' +
        '</div>';
      document.body.appendChild(el);
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
    if (typeof rvRenderHandles === 'function') rvRenderHandles();
    if (typeof rvPanelSync === 'function') rvPanelSync();
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
      var tag = document.getElementById('rv-ed-hovertag');
      if (tag) tag.style.display = 'none';
    }
    var tbBtn = document.querySelector('#rv-ed-toolbar .rv-tb-edit');
    if (tbBtn) tbBtn.classList.toggle('rv-active', on);
    if (typeof rvPanelSync === 'function') rvPanelSync();
    if (typeof applyLayout === 'function') applyLayout();
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
    } else if (edit.on && edit.sel && (ev.key === 'Delete' || ev.key === 'Backspace')) {
      deleteSelected(edit.sel);
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

  /* --- editing machinery: POST plumbing, toasts, undo ----------------------- */

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

  var postPending = false;

  function rvPostEdit(edits) {
    if (postPending) return Promise.resolve(false);
    postPending = true;
    if (typeof rvStatus === 'function') rvStatus('saving', 'Saving to ' + PRES_NAME + '…');
    return fetch('/__rv__/edit', {
      method: 'POST',
      headers: { 'X-RV-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha256: curSha(), edits: edits }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        postPending = false;
        if (!r.ok) {
          if (typeof rvStatus === 'function') rvStatus('error', 'Not saved ✗');
          try { sessionStorage.removeItem('rv-ed-lastsave'); } catch (e2) {}
          toast(j.error === 'sha_mismatch'
            ? 'Deck changed on disk — resyncing'
            : 'Edit rejected: ' + (j.error || r.status));
          if (j.error === 'sha_mismatch') saveStateAndReload();
          return false;
        }
        return true;  // the rebuild's SSE reload will refresh everything
      });
    }).catch(function () { postPending = false; toast('Edit failed: server unreachable'); return false; });
  }

  function rvUndoRedo(which) {
    fetch('/__rv__/' + which, { method: 'POST', headers: { 'X-RV-Token': TOKEN } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) toast(j.error === 'external_edit'
          ? 'File changed outside the editor — use your editor’s undo'
          : 'Nothing to ' + which);
      }); });
  }

  document.addEventListener('keydown', function (ev) {
    if (!edit.on) return;
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'z' || ev.key === 'Z')) {
      rvUndoRedo(ev.shiftKey ? 'redo' : 'undo');
      ev.preventDefault();
    }
  }, true);

  /* --- construct model -------------------------------------------------------- */

  function hasCls(el, c) { return el.classList && el.classList.contains(c); }

  function constructOf(el) {
    if (!el) return null;
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

  function rvScale() {
    var slides = document.querySelector('.reveal .slides');
    if (!slides || !window.Reveal) return 1;
    var r = slides.getBoundingClientRect();
    var s = r.height / Reveal.getConfig().height;
    return (isFinite(s) && s > 0) ? s : 1;
  }

  /* --- drag handles ------------------------------------------------------------ */

  var drag = null;  // active drag state

  function mkGrip(cls, cursor, title) {
    var g = document.createElement('div');
    g.className = 'rv-ed-grip ' + cls;
    g.style.cursor = cursor;
    if (title) g.title = title;
    g.style.pointerEvents = 'auto';
    return g;
  }

  function clearHandles() {
    var el = layer();
    el.querySelectorAll('.rv-ed-grip, .rv-ed-dragzone').forEach(function (g) { g.remove(); });
  }

  function rvRenderHandles() {
    clearHandles();
    if (!edit.on || !edit.sel || !document.contains(edit.sel) || drag) return;
    var host = layer();
    var el = edit.sel;
    var kind = constructOf(el);
    var r = el.getBoundingClientRect();

    function place(g, x, y) {
      g.style.left = (x - 6) + 'px';
      g.style.top = (y - 6) + 'px';
      host.appendChild(g);
    }

    if (kind === 'pin') {
      var zone = document.createElement('div');
      zone.className = 'rv-ed-dragzone';
      zone.style.cssText = 'position:fixed;pointer-events:auto;cursor:grab;' +
        'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;';
      zone.addEventListener('pointerdown', function (ev) { startDrag(ev, 'pin-move', el); });
      host.appendChild(zone);
      var wg = mkGrip('rv-ed-e', 'ew-resize', 'width');
      wg.addEventListener('pointerdown', function (ev) { startDrag(ev, 'pin-width', el); });
      place(wg, r.right, r.top + r.height / 2);
    } else if (kind === 'media') {
      var mg = mkGrip('rv-ed-se', 'nwse-resize', 'resize (writes h=)');
      mg.addEventListener('pointerdown', function (ev) { startDrag(ev, 'media-size', el); });
      place(mg, r.right, r.bottom);
    } else if (kind === 'row' || kind === 'stack') {
      var hg = mkGrip('rv-ed-s', 'ns-resize', 'height (writes h=)');
      hg.addEventListener('pointerdown', function (ev) { startDrag(ev, kind + '-height', el); });
      place(hg, r.left + r.width / 2, r.bottom);
    } else if (kind === 'region') {
      var next = el.nextElementSibling;
      if (next && hasCls(next, 'region')) {
        if (el.hasAttribute('data-rv-implicit') || next.hasAttribute('data-rv-implicit')) {
          // no `> col` line to edit — surfaced in the breadcrumb instead
        } else if (el.hasAttribute('data-rv-src') && next.hasAttribute('data-rv-src')) {
          var bg = mkGrip('rv-ed-e rv-ed-col', 'col-resize', 'column split');
          bg.addEventListener('pointerdown', function (ev) { startDrag(ev, 'col-split', el, { next: next }); });
          place(bg, r.right, r.top + r.height / 2);
        }
      }
    }

    // Block-move grip for movable constructs with a full source span.
    if (MOVABLE[kind] && el.hasAttribute('data-rv-src')) {
      var mv = mkGrip('rv-ed-move', 'grab', 'move to another column');
      mv.addEventListener('pointerdown', function (ev) { startDrag(ev, 'block-move', el); });
      place(mv, r.left, r.top);
    }
  }

  /* --- drag state machine -------------------------------------------------------- */

  function startDrag(ev, kind, el, extra) {
    ev.preventDefault();
    ev.stopPropagation();
    var r = el.getBoundingClientRect();
    drag = Object.assign({
      kind: kind, el: el, x0: ev.clientX, y0: ev.clientY,
      r0: r, scale: rvScale(),
    }, extra || {});
    if (kind === 'col-split') {
      drag.rNext0 = drag.next.getBoundingClientRect();
      drag.g0 = parseFloat(getComputedStyle(el).flexGrow) || 1;
      drag.g1 = parseFloat(getComputedStyle(drag.next).flexGrow) || 1;
    }
    if (kind === 'block-move') buildDropTargets(el);
    document.addEventListener('pointermove', onDragMove, true);
    document.addEventListener('pointerup', onDragUp, true);
    clearHandles();
  }

  function onDragMove(ev) {
    if (!drag) return;
    var dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
    var el = drag.el, r0 = drag.r0;

    if (drag.kind === 'pin-move') {
      // preview via transform on top of the base translate(-50%,-50%)
      el.style.transform = 'translate(-50%, -50%) translate(' + dx + 'px,' + dy + 'px)';
    } else if (drag.kind === 'pin-width') {
      var w0 = r0.width;
      el.style.width = Math.max(20, w0 + dx) + 'px';
    } else if (drag.kind === 'media-size') {
      var target = el.tagName === 'FIGURE' ? el.querySelector('img,video') : el;
      if (target) { target.style.height = Math.max(16, r0.height + dy) + 'px'; target.style.width = 'auto'; }
    } else if (drag.kind === 'row-height' || drag.kind === 'stack-height') {
      var h = Math.max(24, r0.height + dy);
      el.style.flex = '0 0 ' + h + 'px';
      el.style.height = h + 'px';
    } else if (drag.kind === 'col-split') {
      var total = drag.g0 + drag.g1;
      var wPair = r0.width + drag.rNext0.width;
      var ratio = Math.min(0.92, Math.max(0.08, (r0.width + dx) / wPair));
      el.style.flexGrow = (total * ratio).toFixed(4);
      drag.next.style.flexGrow = (total * (1 - ratio)).toFixed(4);
      drag.ratio = ratio;
    } else if (drag.kind === 'block-move') {
      moveGhost(ev);
      pickDropSlot(ev);
    }
    syncChrome();
  }

  function onDragUp(ev) {
    document.removeEventListener('pointermove', onDragMove, true);
    document.removeEventListener('pointerup', onDragUp, true);
    var d = drag;
    drag = null;
    if (!d) return;
    var el = d.el, line = srcOf(el);

    if (d.kind === 'pin-move' || d.kind === 'pin-width') {
      var parent = el.offsetParent || el.parentElement;
      var pr = parent.getBoundingClientRect();
      var r = el.getBoundingClientRect();
      var cx = (r.left + r.width / 2 - pr.left) / pr.width * 100;
      var cy = (r.top + r.height / 2 - pr.top) / pr.height * 100;
      cx = Math.round(cx * 2) / 2; cy = Math.round(cy * 2) / 2;
      var op = { op: 'set_pin', line: line, x: cx + '%', y: cy + '%' };
      var w = el.style.width;
      if (d.kind === 'pin-width') {
        op.w = (Math.round(r.width / pr.width * 200) / 2) + '%';
      } else if (w && w.indexOf('%') !== -1) {
        op.w = w;
      }
      rvPostEdit([op]);
    } else if (d.kind === 'media-size') {
      var target = el.tagName === 'FIGURE' ? el.querySelector('img,video') : el;
      var hpx = Math.round(target.getBoundingClientRect().height / d.scale);
      rvPostEdit([{ op: 'set_media_size', line: line, dim: 'h', value: hpx + 'px' }]);
    } else if (d.kind === 'row-height' || d.kind === 'stack-height') {
      var hh = Math.round(el.getBoundingClientRect().height / d.scale);
      rvPostEdit([{ op: (d.kind === 'row-height' ? 'set_row_height' : 'set_stack_height'),
                    line: line, value: hh }]);
    } else if (d.kind === 'col-split') {
      commitColSplit(d);
    } else if (d.kind === 'block-move') {
      commitBlockMove(d, ev);
    }
    syncChrome();
  }

  /* --- column split commit --------------------------------------------------------- */

  var SNAPS = [
    [1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 5], [2, 5], [3, 5], [4, 5],
    [1, 12], [5, 12], [7, 12], [11, 12],
  ];

  function commitColSplit(d) {
    var row = d.el.parentElement;
    var regions = Array.prototype.filter.call(row.children, function (c) { return hasCls(c, 'region'); });
    var ratio = d.ratio;
    if (ratio === undefined) return;
    var lineA = srcOf(d.el), lineB = srcOf(d.next);
    var opA, opB;

    if (regions.length === 2) {
      // Fine-grained: snap to pretty fractions, else /20 pair.
      var best = null;
      var rowRect = row.getBoundingClientRect();
      SNAPS.forEach(function (nd) {
        var f = nd[0] / nd[1];
        var distPx = Math.abs(f - ratio) * rowRect.width;
        if (distPx < 10 && (!best || distPx < best.d)) best = { n: nd[0], den: nd[1], d: distPx };
      });
      if (best) {
        opA = best.n + '/' + best.den;
        opB = (best.den - best.n) + '/' + best.den;
      } else {
        var a = Math.min(19, Math.max(1, Math.round(ratio * 20)));
        opA = a + '/20';
        opB = (20 - a) + '/20';
      }
    } else {
      // Coarse: redistribute integer weights within the pair, preserving their sum.
      var S = Math.round(d.g0 + d.g1);
      if (S < 2 || Math.abs(S - (d.g0 + d.g1)) > 0.01) {
        toast('These columns use sizes I can’t redistribute — edit the source');
        saveStateAndReload();
        return;
      }
      var ai = Math.min(S - 1, Math.max(1, Math.round(ratio * S)));
      opA = String(ai);
      opB = String(S - ai);
    }
    rvPostEdit([
      { op: 'set_col_size', line: lineA, new: opA },
      { op: 'set_col_size', line: lineB, new: opB },
    ]);
  }

  /* --- keyboard nudging --------------------------------------------------------------- */

  var nudgeTimer = null;

  document.addEventListener('keydown', function (ev) {
    if (!edit.on || !edit.sel) return;
    var arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    var v = arrows[ev.key];
    if (!v) return;
    var el = edit.sel, kind = constructOf(el);
    ev.preventDefault();
    ev.stopPropagation();
    var mult = ev.shiftKey ? 4 : 1;

    if (kind === 'pin') {
      var parent = el.offsetParent || el.parentElement;
      var pr = parent.getBoundingClientRect();
      el._nx = (el._nx === undefined ? 0 : el._nx) + v[0] * mult * pr.width / 100;
      el._ny = (el._ny === undefined ? 0 : el._ny) + v[1] * mult * pr.height / 100;
      el.style.transform = 'translate(-50%, -50%) translate(' + el._nx + 'px,' + el._ny + 'px)';
      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(function () {
        var r = el.getBoundingClientRect();
        var cx = Math.round((r.left + r.width / 2 - pr.left) / pr.width * 200) / 2;
        var cy = Math.round((r.top + r.height / 2 - pr.top) / pr.height * 200) / 2;
        var op = { op: 'set_pin', line: srcOf(el), x: cx + '%', y: cy + '%' };
        if (el.style.width && el.style.width.indexOf('%') !== -1) op.w = el.style.width;
        rvPostEdit([op]);
      }, 450);
    } else if (kind === 'media' || kind === 'row' || kind === 'stack') {
      var target = (kind === 'media' && el.tagName === 'FIGURE') ? el.querySelector('img,video') : el;
      if (!target) return;
      var h = target.getBoundingClientRect().height + v[1] * 5 * mult * rvScale();
      if (v[1] === 0) return;
      if (kind === 'media') { target.style.height = h + 'px'; target.style.width = 'auto'; }
      else { el.style.flex = '0 0 ' + h + 'px'; el.style.height = h + 'px'; }
      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(function () {
        var hpx = Math.round(target.getBoundingClientRect().height / rvScale());
        rvPostEdit([kind === 'media'
          ? { op: 'set_media_size', line: srcOf(el), dim: 'h', value: hpx + 'px' }
          : { op: (kind === 'row' ? 'set_row_height' : 'set_stack_height'), line: srcOf(el), value: hpx }]);
      }, 450);
    }
    syncChrome();
  }, true);

  /* --- block move: ghost, drop targets, commit ------------------------------------------ */

  var dropState = null;  // {targets: [{el, slots: [{line, y}]}], active: {el, slot}}

  function mappedChildren(container) {
    return Array.prototype.filter.call(container.children, function (c) {
      return c.hasAttribute && c.hasAttribute('data-rv-src');
    });
  }

  function buildDropTargets(exclude) {
    var slide = Reveal.getCurrentSlide();
    if (!slide) return;
    var targets = [];
    slide.querySelectorAll('.region[data-rv-src], .column[data-rv-src]').forEach(function (c) {
      if (c === exclude || c.contains(exclude) || exclude.contains(c)) return;
      var kids = mappedChildren(c).filter(function (k) { return k !== exclude; });
      var slots = kids.map(function (k) {
        return { line: srcOf(k), y: k.getBoundingClientRect().top };
      });
      slots.push({ line: srcEndOf(c) + 1, y: c.getBoundingClientRect().bottom });
      targets.push({ el: c, slots: slots,
                     kind: hasCls(c, 'column') ? 'column' : 'col' });
      c.classList.add('rv-ed-droptarget');
    });
    dropState = { targets: targets, active: null };
  }

  function clearDropTargets() {
    document.querySelectorAll('.rv-ed-droptarget').forEach(function (c) {
      c.classList.remove('rv-ed-droptarget');
    });
    var bar = document.getElementById('rv-ed-slotbar');
    if (bar) bar.remove();
    var ghost = document.getElementById('rv-ed-ghost');
    if (ghost) ghost.remove();
    dropState = null;
  }

  function moveGhost(ev) {
    var g = document.getElementById('rv-ed-ghost');
    if (!g) {
      g = document.createElement('div');
      g.id = 'rv-ed-ghost';
      g.textContent = kindOf(drag.el);
      document.body.appendChild(g);
    }
    g.style.left = (ev.clientX + 12) + 'px';
    g.style.top = (ev.clientY + 12) + 'px';
  }

  function pickDropSlot(ev) {
    if (!dropState) return;
    var hit = null;
    dropState.targets.forEach(function (t) {
      var r = t.el.getBoundingClientRect();
      if (ev.clientX >= r.left && ev.clientX <= r.right &&
          ev.clientY >= r.top - 8 && ev.clientY <= r.bottom + 8) hit = t;
    });
    var bar = document.getElementById('rv-ed-slotbar');
    if (!hit) { if (bar) bar.remove(); dropState.active = null; return; }
    var slot = hit.slots[0], dist = Infinity;
    hit.slots.forEach(function (s) {
      var d = Math.abs(ev.clientY - s.y);
      if (d < dist) { dist = d; slot = s; }
    });
    dropState.active = { target: hit, slot: slot };
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'rv-ed-slotbar';
      document.body.appendChild(bar);
    }
    var rr = hit.el.getBoundingClientRect();
    bar.style.left = rr.left + 'px';
    bar.style.width = rr.width + 'px';
    bar.style.top = (slot.y - 2) + 'px';
  }

  function commitBlockMove(d, ev) {
    var choice = dropState && dropState.active;
    var el = d.el;
    clearDropTargets();
    if (!choice) { syncChrome(); return; }
    var construct = constructOf(el);
    if (construct === 'region') construct = 'paragraph';
    rvPostEdit([{
      op: 'move_block',
      src: [srcOf(el), srcEndOf(el)],
      construct: MOVABLE[construct] ? construct : 'paragraph',
      dest: {
        insert_before: choice.slot.line,
        container: [srcOf(choice.target.el), srcEndOf(choice.target.el)],
        container_kind: choice.target.kind,
      },
    }]);
  }

  /* --- fragment drawer -------------------------------------------------------------------- */

  function fragmentsOnSlide() {
    var slide = Reveal.getCurrentSlide();
    if (!slide) return [];
    var els = Array.prototype.slice.call(slide.querySelectorAll('.fragment'));
    els.sort(function (a, b) {
      var ia = parseInt(a.getAttribute('data-fragment-index') || '9999', 10);
      var ib = parseInt(b.getAttribute('data-fragment-index') || '9999', 10);
      return ia - ib;
    });
    return els;
  }

  function fragConstruct(el) {
    var k = constructOf(el);
    if (k === 'region') return 'col';
    if (k === 'media') return 'media';
    if (k === 'layer') return 'layer';
    if (k === 'card') return 'card';
    if (k === 'box') return 'box';
    if (k === 'eq') return 'eq';
    if (k === 'pin') return 'pin';
    if (k === 'row') return 'row';
    return 'frag';
  }

  function toggleDrawer() {
    var dw = document.getElementById('rv-ed-drawer');
    if (dw) { dw.remove(); return; }
    dw = document.createElement('div');
    dw.id = 'rv-ed-drawer';
    dw.innerHTML = '<div class="rv-ed-drawer-title">Fragments (reveal order)</div>' +
      '<div class="rv-ed-drawer-list"></div>' +
      '<div class="rv-ed-drawer-foot">↑↓ reorder · writes explicit +1..+n</div>';
    document.body.appendChild(dw);
    renderDrawer();
  }

  function renderDrawer() {
    var dw = document.getElementById('rv-ed-drawer');
    if (!dw) return;
    var list = dw.querySelector('.rv-ed-drawer-list');
    list.innerHTML = '';
    var frags = fragmentsOnSlide();
    frags.forEach(function (el, i) {
      var row = document.createElement('div');
      row.className = 'rv-ed-drawer-item';
      var mapped = el.hasAttribute('data-rv-src');
      var label = kindOf(el) + (mapped ? ' · :' + el.getAttribute('data-rv-src') : ' · (unmapped)');
      row.innerHTML = '<span>' + (i + 1) + '. ' + label + '</span>' +
        (mapped ? '<span class="rv-ed-updown"><button data-d="-1">↑</button>' +
                  '<button data-d="1">↓</button></span>' : '');
      row.addEventListener('mouseenter', function () { edit.hover = el; syncChrome(); });
      row.addEventListener('mouseleave', function () { edit.hover = null; syncChrome(); });
      row.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          reorderFragment(frags, i, parseInt(b.getAttribute('data-d'), 10));
        });
      });
      list.appendChild(row);
    });
    if (!frags.length) list.innerHTML = '<div class="rv-ed-drawer-item">no fragments on this slide</div>';
  }

  function reorderFragment(frags, i, delta) {
    var j = i + delta;
    if (j < 0 || j >= frags.length) return;
    var order = frags.slice();
    var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    var mapped = order.filter(function (el) { return el.hasAttribute('data-rv-src'); });
    if (mapped.length !== order.length) {
      toast('Some fragments are raw HTML — their order can’t be rewritten');
    }
    rvPostEdit([{
      op: 'reorder_fragments',
      order: mapped.map(function (el) {
        return { line: srcOf(el), construct: fragConstruct(el) };
      }),
    }]);
  }

  document.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (edit.on && ev.key === 'f' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      toggleDrawer();
      ev.preventDefault();
    }
  }, true);

  /* --- OS file drag-drop --------------------------------------------------------------------- */

  window.addEventListener('dragover', function (ev) {
    if (!edit.on) return;
    if (!ev.dataTransfer || Array.prototype.indexOf.call(ev.dataTransfer.types, 'Files') === -1) return;
    ev.preventDefault();
    if (!dropState) buildDropTargets(document.createElement('div'));
    pickDropSlot(ev);
  });

  window.addEventListener('drop', function (ev) {
    if (!edit.on || !ev.dataTransfer || !ev.dataTransfer.files.length) return;
    ev.preventDefault();
    var choice = dropState && dropState.active;
    var file = ev.dataTransfer.files[0];
    clearDropTargets();
    if (!choice) { toast('Drop inside a column to insert media'); return; }
    var isVideo = /^video\//.test(file.type) || /\.(mp4|webm|ogv|mov)$/i.test(file.name);
    fetch('/__rv__/upload?name=' + encodeURIComponent(file.name), {
      method: 'PUT', headers: { 'X-RV-Token': TOKEN }, body: file,
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { toast('Upload rejected: ' + (j.error || '?')); return; }
      rvPostEdit([{
        op: 'insert_media',
        at: { insert_before: choice.slot.line,
              container: [srcOf(choice.target.el), srcEndOf(choice.target.el)],
              container_kind: choice.target.kind },
        kind: isVideo ? 'video' : 'img',
        path: j.path,
        flags: choice.target.kind === 'col' ? ['fill'] : [],
      }]);
    }).catch(function () { toast('Upload failed'); });
  });

  window.addEventListener('dragleave', function (ev) {
    if (edit.on && !ev.relatedTarget && dropState && !drag) clearDropTargets();
  });


  // Debug/testing hook: ?rv-edit=1 auto-enters edit mode (and selects the
  // first annotated element on the current slide with ?rv-select=1).
  /* --- editor shell: toolbar, status chip, side panel ------------------------ */

  var PRES_NAME = (function () {
    var m = document.querySelector('meta[name="rv-src-file"]');
    return m ? m.getAttribute('content') : 'the .pres file';
  })();

  function rvStatus(state, msg) {
    var chip = document.querySelector('#rv-ed-toolbar .rv-tb-status');
    if (!chip) return;
    chip.className = 'rv-tb-status rv-st-' + state;
    chip.textContent = msg;
    try {
      if (state === 'saving') sessionStorage.setItem('rv-ed-lastsave', 'pending');
    } catch (e) {}
  }

  function buildToolbar() {
    if (document.getElementById('rv-ed-toolbar')) return;
    var tb = document.createElement('div');
    tb.id = 'rv-ed-toolbar';
    tb.innerHTML =
      '<button class="rv-tb-edit" title="Toggle edit mode (E)">✏ Edit</button>' +
      '<button class="rv-tb-undo" title="Undo (Ctrl+Z)">↶</button>' +
      '<button class="rv-tb-redo" title="Redo (Ctrl+Shift+Z)">↷</button>' +
      '<button class="rv-tb-frag" title="Fragments (F)">☰</button>' +
      '<button class="rv-tb-media" title="Import an image / movie into Media/">＋ Media</button>' +
      '<button class="rv-tb-view" title="Toggle split view">⇔</button>' +
      '<span class="rv-tb-status rv-st-idle">' + PRES_NAME + '</span>' +
      '<button class="rv-tb-help" title="Help">?</button>';
    document.body.appendChild(tb);
    tb.querySelector('.rv-tb-edit').addEventListener('click', function () { setEdit(!edit.on); });
    tb.querySelector('.rv-tb-undo').addEventListener('click', function () { rvUndoRedo('undo'); });
    tb.querySelector('.rv-tb-redo').addEventListener('click', function () { rvUndoRedo('redo'); });
    tb.querySelector('.rv-tb-frag').addEventListener('click', function () {
      if (!edit.on) setEdit(true);
      toggleDrawer();
    });
    tb.querySelector('.rv-tb-help').addEventListener('click', toggleHelp);
    tb.querySelector('.rv-tb-media').addEventListener('click', function () {
      if (!edit.on) setEdit(true);
      importMedia();
    });
    tb.querySelector('.rv-tb-view').addEventListener('click', function () {
      splitPref = !splitPref;
      try { localStorage.setItem('rv-ed-split', splitPref ? '1' : '0'); } catch (e) {}
      if (!edit.on && splitPref) setEdit(true);
      applyLayout();
    });
    try {
      if (sessionStorage.getItem('rv-ed-lastsave') === 'pending') {
        sessionStorage.removeItem('rv-ed-lastsave');
        rvStatus('saved', 'Saved to ' + PRES_NAME + ' ✓');
        setTimeout(function () { rvStatus('idle', PRES_NAME); }, 2500);
      }
    } catch (e) {}
  }

  function toggleHelp() {
    var h = document.getElementById('rv-ed-help');
    if (h) { h.remove(); return; }
    h = document.createElement('div');
    h.id = 'rv-ed-help';
    h.innerHTML =
      '<b>How editing works</b>' +
      '<p>You are editing <code>' + PRES_NAME + '</code> — the source text file, ' +
      'not the HTML. Every change is written to it immediately as a minimal ' +
      'edit, the deck rebuilds, and this preview reloads in place. There is ' +
      'no separate save step.</p>' +
      '<ul>' +
      '<li><b>✏ Edit / E</b> — toggle edit mode; click any element to select it</li>' +
      '<li><b>Panel</b> — edit the selection\'s parameters, move it, edit its source lines, or the whole slide when nothing is selected</li>' +
      '<li><b>⇔</b> — split view (deck left, panel right, draggable divider)</li>' +
      '<li><b>＋ Media</b> — pick a file: it is copied into Media/ and inserted</li>' +
      '<li><b>Del</b> — delete the selected block (undo with Ctrl+Z)</li>' +
      '<li><b>Drag</b> — blue handles resize/move; the square grip drags a block to another column</li>' +
      '<li><b>↶ ↷ / Ctrl+Z</b> — undo/redo edits made here</li>' +
      '<li><b>☰ / F</b> — reorder the slide\'s fragments</li>' +
      '<li><b>Drop a file</b> — insert an image/movie into a column</li>' +
      '</ul><button class="rv-help-close">Close</button>';
    document.body.appendChild(h);
    h.querySelector('.rv-help-close').addEventListener('click', function () { h.remove(); });
  }

  /* --- side panel ---------------------------------------------------------------- */

  var panelFor = null;  // element the panel currently shows

  function panelEl() {
    var p = document.getElementById('rv-ed-panel');
    if (!p) {
      p = document.createElement('div');
      p.id = 'rv-ed-panel';
      document.body.appendChild(p);
    }
    return p;
  }

  function rvPanelSync() {
    var p = panelEl();
    p.style.display = edit.on ? 'flex' : 'none';
    if (!edit.on) { panelFor = null; return; }
    var sec = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
    var key = edit.sel || sec;
    if (key === panelFor) return;
    panelFor = key;
    renderPanel();
  }

  function crumbChain(el) {
    var chain = [];
    var cur = el;
    while (cur && cur.tagName !== 'BODY') {
      if (cur.hasAttribute && cur.hasAttribute('data-rv-src')) chain.unshift(cur);
      cur = cur.parentElement;
    }
    return chain;
  }

  function renderPanel() {
    var p = panelEl();
    var el = edit.sel;
    if (!el || !document.contains(el)) {
      var sec = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
      if (sec && sec.hasAttribute('data-rv-src')) {
        renderSlideSource(p, sec);
      } else {
        p.innerHTML =
          '<div class="rv-pn-head">Nothing selected</div>' +
          '<div class="rv-pn-hint">Click an element in the slide to inspect and edit it.</div>';
        appendCheatsheet(p);
      }
      return;
    }
    var kind = constructOf(el) || 'element';
    var s = srcOf(el), e = srcEndOf(el);

    var crumbs = crumbChain(el).map(function (c) {
      var label = c === el ? '<b>' + kindOf(c) + '</b>' : kindOf(c);
      return '<span class="rv-pn-crumb" data-src="' + c.getAttribute('data-rv-src') + '">' + label + '</span>';
    }).join(' ▸ ');

    p.innerHTML =
      '<div class="rv-pn-head">' + crumbs + '</div>' +
      '<div class="rv-pn-sub">' + PRES_NAME + ' : ' + s + (e !== s ? '–' + e : '') + '</div>' +
      '<div class="rv-pn-fields"></div>' +
      '<div class="rv-pn-actions">' +
      '<button class="rv-pn-up" title="Move before the previous sibling">▲ Up</button>' +
      '<button class="rv-pn-down" title="Move after the next sibling">▼ Down</button>' +
      '<button class="rv-pn-del" title="Delete this block from the .pres (Del)">🗑 Delete</button>' +
      '</div>' +
      '<div class="rv-pn-srctitle">Source (editable)</div>' +
      '<textarea class="rv-pn-src" spellcheck="false"></textarea>' +
      '<button class="rv-pn-apply">Apply source</button>' +
      '<div class="rv-pn-foot">Changes save automatically to the .pres — no save button needed.</div>';
    appendCheatsheet(p);

    p.querySelectorAll('.rv-pn-crumb').forEach(function (c) {
      c.addEventListener('click', function () {
        var slide = Reveal.getCurrentSlide();
        var t = (slide && slide.querySelector('[data-rv-src="' + c.getAttribute('data-src') + '"]')) ||
                document.querySelector('section[data-rv-src="' + c.getAttribute('data-src') + '"]');
        if (t) { edit.sel = t; syncChrome(); }
      });
    });
    p.querySelector('.rv-pn-up').addEventListener('click', function () { moveSibling(el, -1); });
    p.querySelector('.rv-pn-down').addEventListener('click', function () { moveSibling(el, 1); });
    p.querySelector('.rv-pn-del').addEventListener('click', function () { deleteSelected(el); });

    // Source box + parameter fields need the actual .pres lines.
    fetch('/__rv__/src?start=' + s + '&end=' + e + '&token=' + encodeURIComponent(TOKEN))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.lines) return;
        var ta = p.querySelector('.rv-pn-src');
        if (ta) ta.value = j.lines.join('\n');
        buildFields(p.querySelector('.rv-pn-fields'), kind, el, j.lines, s, e);
      });

    p.querySelector('.rv-pn-apply').addEventListener('click', function () {
      var ta = p.querySelector('.rv-pn-src');
      rvPostEdit([{ op: 'replace_lines', start: s, end: e, text: ta.value.split('\n') }]);
    });
  }

  function renderSlideSource(p, sec) {
    var s0 = srcOf(sec), e0 = srcEndOf(sec);
    p.innerHTML =
      '<div class="rv-pn-head"><b>' + (kindOf(sec) === 'slide' ? 'This slide' : kindOf(sec)) + '</b>' +
      ' <span class="rv-pn-sub">' + PRES_NAME + ' : ' + s0 + '–' + e0 + '</span></div>' +
      '<div class="rv-pn-hint">Click an element for its parameters, or edit the whole slide here.</div>' +
      '<div class="rv-pn-srctitle">Slide source (editable)</div>' +
      '<textarea class="rv-pn-src rv-pn-src-slide" spellcheck="false"></textarea>' +
      '<button class="rv-pn-apply">Apply source</button>' +
      '<div class="rv-pn-foot">Changes save automatically to the .pres — no save button needed.</div>';
    fetch('/__rv__/src?start=' + s0 + '&end=' + e0 + '&token=' + encodeURIComponent(TOKEN))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var ta = p.querySelector('.rv-pn-src');
        if (j.lines && ta) ta.value = j.lines.join('\n');
      });
    p.querySelector('.rv-pn-apply').addEventListener('click', function () {
      var ta = p.querySelector('.rv-pn-src');
      rvPostEdit([{ op: 'replace_lines', start: s0, end: e0, text: ta.value.split('\n') }]);
    });
    appendCheatsheet(p);
  }

  var CHEATSHEET = [
    ['Slides', ['=== Slide title', '--- vertical sub-slide', '%%% Section divider',
                '>>> first: Deck title', '>>> biblio']],
    ['Layout', ['> fill', '> row h=400 24px', '> col 2/5 center', '> end: row',
                '|| 40%   (text columns)', '| 55%', '||']],
    ['Media', ['! img.png fill h=200px +2 | caption', '!! movie.mp4 loop',
               'flags: fill contain cover top h= w= + +N']],
    ['Components', ['> info Title … > end: info', '> warn / > good', '> eq +  … > end: eq',
                    '> grid(2,2) compact / > card +', '> stack h=300 / > layer + clear',
                    '> pin: 50% 50% 20% +', '> frag 2 … > end: frag', '> table(2,3)']],
    ['Text & math', ['* bullet (2 spaces = nested)', '[ highlighted line ]',
                     '$inline$  $$display$$', '@@ python … @@']],
  ];

  function appendCheatsheet(p) {
    var d = document.createElement('details');
    d.className = 'rv-pn-cheat';
    d.innerHTML = '<summary>📖 Command cheatsheet</summary>' +
      CHEATSHEET.map(function (sec) {
        return '<div class="rv-cs-sec"><b>' + sec[0] + '</b><pre>' +
          sec[1].join('\n') + '</pre></div>';
      }).join('');
    try { d.open = localStorage.getItem('rv-ed-cheat') === '1'; } catch (e) {}
    d.addEventListener('toggle', function () {
      try { localStorage.setItem('rv-ed-cheat', d.open ? '1' : '0'); } catch (e) {}
    });
    p.appendChild(d);
  }

  /* --- media import (file picker) -------------------------------------------------- */

  function importMedia() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*,audio/*,.pdf,.svg';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (file) uploadAndInsert(file);
    });
    input.click();
  }

  function uploadAndInsert(file) {
    var isVideo = /^video\//.test(file.type) || /\.(mp4|webm|ogv|mov)$/i.test(file.name);
    fetch('/__rv__/upload?name=' + encodeURIComponent(file.name), {
      method: 'PUT', headers: { 'X-RV-Token': TOKEN }, body: file,
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { toast('Upload rejected: ' + (j.error || '?')); return; }
      var sel = edit.sel, at = null, flags = [];
      var sec = window.Reveal && Reveal.getCurrentSlide();
      function spanDest(container, kind) {
        return { insert_before: srcEndOf(container) + 1,
                 container: [srcOf(container), srcEndOf(container)],
                 container_kind: kind };
      }
      if (sel && sel.hasAttribute('data-rv-src') &&
          (hasCls(sel, 'region') || hasCls(sel, 'rv-card') || hasCls(sel, 'rv-cell') ||
           hasCls(sel, 'rv-layer') || hasCls(sel, 'column'))) {
        at = spanDest(sel, hasCls(sel, 'column') ? 'column' : 'col');
        flags = hasCls(sel, 'column') ? [] : ['fill'];
      } else if (sel && sel.hasAttribute('data-rv-src') && sel.tagName !== 'SECTION') {
        var cont = containerOf(sel) || sec;
        at = { insert_before: srcEndOf(sel) + 1,
               container: [srcOf(cont), srcEndOf(cont)],
               container_kind: hasCls(cont, 'column') ? 'column' :
                               (cont.tagName === 'SECTION' ? 'slide' : 'col') };
        flags = cont.tagName === 'SECTION' || hasCls(cont, 'column') ? [] : ['fill'];
      } else if (sec && sec.hasAttribute('data-rv-src')) {
        at = spanDest(sec, 'slide');
      }
      if (!at) { toast('Uploaded to ' + j.path + ' — add a “! ' + j.path + '” line'); return; }
      rvPostEdit([{ op: 'insert_media', at: at, kind: isVideo ? 'video' : 'img',
                    path: j.path, flags: flags }]);
    }).catch(function () { toast('Upload failed'); });
  }

  /* --- docked / split view ------------------------------------------------------------ */

  var splitPref = false;
  try { splitPref = localStorage.getItem('rv-ed-split') === '1'; } catch (e) {}

  function applyLayout() {
    var on = splitPref && edit.on;
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
    if (btn) btn.classList.toggle('rv-active', splitPref);
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
      syncChrome();
    });
  }

  try {
    var pw = parseInt(localStorage.getItem('rv-ed-pw') || '', 10);
    if (pw) document.documentElement.style.setProperty('--rv-pw', pw + 'px');
  } catch (e) {}

  /* --- parameter fields -------------------------------------------------------------- */

  function fld(label, value, hint) {
    return '<label class="rv-pn-fld"><span>' + label + '</span>' +
      '<input type="text" value="' + (value == null ? '' : String(value).replace(/"/g, '&quot;')) + '"' +
      (hint ? ' placeholder="' + hint + '"' : '') + '></label>';
  }

  function tokensOf(line, headRe) {
    var m = line.match(headRe);
    return m ? m[1].trim().split(/\s+/).filter(Boolean) : [];
  }

  function findToken(tokens, re) {
    for (var i = 0; i < tokens.length; i++) {
      var m = tokens[i].match(re);
      if (m) return m;
    }
    return null;
  }

  function buildFields(box, kind, el, lines, s, e) {
    if (!box) return;
    var line0 = lines[0] || '';
    var defs = [];  // {label, value, apply(newValue) -> op or null}

    function fragDef(construct) {
      var toks = tokensOf(line0, /^\s*>?\s*\S+(.*)$/) ;
      var fm = findToken(toks, /^\+(\d+)?$/);
      defs.push({
        label: 'fragment #', value: fm ? (fm[1] || '+') : '',
        apply: function (v) {
          if (v === '') return null;
          return { op: 'set_fragment_index', line: s, construct: construct,
                   index: v === '+' ? null : parseInt(v, 10) };
        },
      });
    }

    if (kind === 'pin') {
      var nums = (line0.match(/pin\s*:\s*(.*)$/) || ['', ''])[1]
        .replace('+', ' ').trim().split(/\s+/).filter(Boolean);
      defs.push({ label: 'x', value: nums[0] || '50%', apply: pinApply(0, nums, s) });
      defs.push({ label: 'y', value: nums[1] || '50%', apply: pinApply(1, nums, s) });
      defs.push({ label: 'width', value: nums[2] || '', apply: pinApply(2, nums, s) });
    } else if (kind === 'media') {
      var toks = tokensOf(line0, /^\s*!{1,2}\s+\S+(.*?)(?:\|.*)?$/);
      var h = findToken(toks, /^h=(.+)$/i), w = findToken(toks, /^w=(.+)$/i);
      defs.push({ label: 'height', value: h ? h[1] : '',
        apply: function (v) { return { op: 'set_media_size', line: s, dim: 'h', value: v || null }; } });
      defs.push({ label: 'width', value: w ? w[1] : '',
        apply: function (v) { return { op: 'set_media_size', line: s, dim: 'w', value: v || null }; } });
      fragDef('media');
    } else if (kind === 'row') {
      var toks2 = tokensOf(line0, /^\s*>\s*row\b(.*)$/);
      var h2 = findToken(toks2, /^h=(\d+)/i);
      var gap = toks2.filter(function (t) { return !/^h=/i.test(t) && !/^\+\d*$/.test(t); })[0];
      defs.push({ label: 'height px', value: h2 ? h2[1] : '',
        apply: function (v) { return { op: 'set_row_height', line: s, value: v ? parseInt(v, 10) : null }; } });
      defs.push({ label: 'gap', value: gap || '',
        apply: function (v) { return v ? { op: 'set_row_gap', line: s, value: v } : null; } });
    } else if (kind === 'stack') {
      var h3 = findToken(tokensOf(line0, /^\s*>\s*stack\b(.*)$/), /^h=(\d+)/i);
      defs.push({ label: 'height px', value: h3 ? h3[1] : '',
        apply: function (v) { return { op: 'set_stack_height', line: s, value: v ? parseInt(v, 10) : null }; } });
    } else if (kind === 'region') {
      var toks3 = tokensOf(line0, /^\s*>\s*col\b(.*)$/);
      var size = toks3.filter(function (t) {
        return !/^\+\d*$/.test(t) && ['center', 'relative', 'clip'].indexOf(t.toLowerCase()) === -1;
      })[0];
      defs.push({ label: 'size (2/5, 40%, 300px)', value: size || '',
        apply: function (v) { return { op: 'set_col_size', line: s, new: v || null }; } });
      fragDef('col');
    } else if (kind === 'grid') {
      var gapLine = null;
      for (var i = 1; i < lines.length; i++) {
        var gm = lines[i].match(/^\s*>\s*gap\s*:\s*(.*)$/);
        if (gm) { gapLine = gm[1]; break; }
      }
      defs.push({ label: 'gap', value: gapLine || '',
        apply: function (v) { return v ? { op: 'set_grid_gap', line: s, end: e, value: v } : null; } });
    } else if (kind === 'card') {
      fragDef('card');
    } else if (kind === 'layer') {
      fragDef('layer');
    } else if (kind === 'box') {
      fragDef('box');
    } else if (kind === 'eq') {
      fragDef('eq');
    } else if (kind === 'frag') {
      fragDef('frag');
    } else if (kind === 'column') {
      var wm = line0.match(/^\s*\|{1,2}\s*(.*)$/);
      defs.push({ label: 'width', value: wm ? wm[1] : '',
        apply: function (v) { return { op: 'set_block_width', line: s, new: v || null }; } });
    }

    box.innerHTML = defs.length
      ? defs.map(function (d, i) { return fld(d.label, d.value).replace('<label', '<label data-i="' + i + '"'); }).join('')
      : '<div class="rv-pn-hint">No quick parameters for this element — edit its source below.</div>';

    box.querySelectorAll('.rv-pn-fld input').forEach(function (input) {
      var def = defs[parseInt(input.parentElement.getAttribute('data-i'), 10)];
      function commit() {
        var op = def.apply(input.value.trim());
        if (op) rvPostEdit([op]);
      }
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { commit(); ev.preventDefault(); }
        ev.stopPropagation();
      });
      input.addEventListener('change', commit);
    });
  }

  function pinApply(idx, nums, line) {
    return function (v) {
      var parts = nums.slice();
      parts[idx] = v;
      var op = { op: 'set_pin', line: line, x: parts[0] || '50%', y: parts[1] || '50%' };
      if (parts[2]) op.w = parts[2];
      return op;
    };
  }

  /* --- sibling move / delete ------------------------------------------------------------ */

  function containerOf(el) {
    var cur = el.parentElement;
    while (cur && cur.tagName !== 'SECTION') {
      if (cur.hasAttribute && cur.hasAttribute('data-rv-src') &&
          (hasCls(cur, 'region') || hasCls(cur, 'column') || hasCls(cur, 'rv-card') ||
           hasCls(cur, 'rv-cell') || hasCls(cur, 'rv-layer'))) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function moveSibling(el, dir) {
    var parent = el.parentElement;
    var mine = mappedChildren(parent);
    var i = mine.indexOf(el);
    var target = mine[i + dir];
    if (!target) { toast('Already at the ' + (dir < 0 ? 'top' : 'bottom')); return; }
    var container = containerOf(el);
    var cSpan = container ? [srcOf(container), srcEndOf(container)]
                          : [srcOf(el), srcEndOf(target)];
    var kindC = container && hasCls(container, 'column') ? 'column' : 'col';
    var construct = constructOf(el);
    rvPostEdit([{
      op: 'move_block',
      src: [srcOf(el), srcEndOf(el)],
      construct: MOVABLE[construct] ? construct : 'paragraph',
      dest: {
        insert_before: dir < 0 ? srcOf(target) : srcEndOf(target) + 1,
        container: cSpan,
        container_kind: kindC,
      },
    }]);
  }

  function deleteSelected(el) {
    var construct = constructOf(el);
    if (!el.hasAttribute('data-rv-src') || el.tagName === 'SECTION') {
      toast('Select a block inside the slide to delete it');
      return;
    }
    toast('Deleted ' + kindOf(el) + ' — Ctrl+Z to undo');
    edit.sel = null;
    rvPostEdit([{
      op: 'delete_block',
      src: [srcOf(el), srcEndOf(el)],
      construct: MOVABLE[construct] ? construct : 'paragraph',
    }]);
  }

  /* --- hover kind tag --------------------------------------------------------------------- */

  function hoverTag(ev) {
    var tag = document.getElementById('rv-ed-hovertag');
    if (!edit.on || !edit.hover || edit.hover === edit.sel || drag) {
      if (tag) tag.style.display = 'none';
      return;
    }
    if (!tag) {
      tag = document.createElement('div');
      tag.id = 'rv-ed-hovertag';
      document.body.appendChild(tag);
    }
    tag.textContent = kindOf(edit.hover);
    tag.style.display = 'block';
    tag.style.left = (ev.clientX + 14) + 'px';
    tag.style.top = (ev.clientY + 16) + 'px';
  }

  document.addEventListener('mousemove', function (ev) {
    if (edit.on) hoverTag(ev);
  }, true);

  buildToolbar();

  var params = new URLSearchParams(location.search);
  if (params.get('rv-test-edit')) {
    // Headless smoke hook: POST the given ops through the real pipeline.
    var testArm = function () {
      setTimeout(function () {
        try { rvPostEdit(JSON.parse(params.get('rv-test-edit'))); }
        catch (e) { toast('bad rv-test-edit'); }
      }, 200);
    };
    if (Reveal.isReady && Reveal.isReady()) testArm();
    else Reveal.on('ready', testArm);
  }
  if (params.get('rv-split') === '1') splitPref = true;
  if (params.get('rv-edit') === '1') {
    var arm = function () {
      setEdit(true);
      var selParam = params.get('rv-select');
      if (selParam) {
        var slide = Reveal.getCurrentSlide();
        edit.sel = slide && (selParam === '1'
          ? slide.querySelector('[data-rv-src]')
          : slide.querySelector('[data-rv-src="' + selParam + '"]'));
        syncChrome();
      }
      if (params.get('rv-drawer') === '1') toggleDrawer();
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
