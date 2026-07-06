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
    if (!S.on) return;
    var el = layer();
    placeOutline(el.querySelector('.rv-ed-hover'), S.hover !== S.sel ? S.hover : null);
    placeOutline(el.querySelector('.rv-ed-select'), S.sel);
    if (typeof rvRenderHandles === 'function') rvRenderHandles();
    if (typeof rvPanelSync === 'function') rvPanelSync();
    var bar = el.querySelector('.rv-ed-bar');
    if (S.sel && document.contains(S.sel)) {
      var s = S.sel.getAttribute('data-rv-src');
      var e = S.sel.getAttribute('data-rv-src-end');
      el.querySelector('.rv-ed-kind').textContent = F.kindOf(S.sel);
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
    S.hover = pickable(ev.target);
    syncChrome();
  }

  function onClick(ev) {
    var el = pickable(ev.target);
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (el !== S.sel) flushNudge();
    S.sel = el;
    syncChrome();
  }

  function selectParent() {
    if (!S.sel) { setEdit(false); return; }
    var parent = S.sel.parentElement && S.sel.parentElement.closest('[data-rv-src]');
    S.sel = parent || null;
    syncChrome();
  }

  function setEdit(on) {
    if (on === S.on) return;
    S.on = on;
    var el = layer();
    document.documentElement.classList.toggle('rv-edit', on);
    if (on) {
      if (window.Reveal && Reveal.getConfig) {
        S.keyboardWas = Reveal.getConfig().keyboard;
        Reveal.configure({ keyboard: false });
      }
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
    } else {
      if (window.Reveal && S.keyboardWas !== null) {
        Reveal.configure({ keyboard: S.keyboardWas });
        S.keyboardWas = null;
      }
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      S.sel = S.hover = null;
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

  /* ONE document-level keydown handler for all editor shortcuts. A single
     typing guard keeps every shortcut away from inputs/textareas — arrows
     must not nudge and Ctrl+Z must stay the field's own undo. */
  function isTypingTarget(t) {
    return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
  }

  document.addEventListener('keydown', function (ev) {
    if (isTypingTarget(ev.target)) return;
    if (ev.ctrlKey || ev.metaKey) {
      if (S.on && !ev.altKey && (ev.key === 'z' || ev.key === 'Z')) {
        rvUndoRedo(ev.shiftKey ? 'redo' : 'undo');
        ev.preventDefault();
      }
      return;
    }
    if (ev.altKey) return;
    if (ev.key === 'e') {
      setEdit(!S.on);
      ev.preventDefault();
    } else if (S.on && ev.key === 'f') {
      toggleDrawer();
      ev.preventDefault();
    } else if (S.on && ev.key === 'Escape') {
      selectParent();
      ev.preventDefault();
      ev.stopPropagation();
    } else if (S.on && S.sel && (ev.key === 'Delete' || ev.key === 'Backspace')) {
      flushNudge();
      deleteSelected(S.sel);
      ev.preventDefault();
      ev.stopPropagation();
    } else if (S.on && S.sel && NUDGE_ARROWS[ev.key]) {
      nudgeSelected(ev);
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
    Reveal.on('slidechanged', function () {
      flushNudge();
      S.sel = S.hover = null;
      syncChrome();
    });
  }

  /* --- editing machinery: POST plumbing, toasts, undo ----------------------- */


  /* --- edit POST plumbing: a FIFO queue for line-preserving ops --------------
     Rapid line-preserving edits (drag + nudge storms) queue and chain on the
     previous response's sha — nothing is silently dropped. Structural ops
     renumber lines, so they never queue behind anything: issuing one drops
     whatever is still waiting (with a toast) and runs next. Any rejected
     edit clears the queue: the deck state is the truth, resync to it. */
  var STRUCTURAL_OPS = { move_block: 1, delete_block: 1, insert_media: 1,
                         replace_lines: 1, set_grid_gap: 1 };
  var editQueue = [];        // waiting line-preserving batches
  var nextStructural = null; // at most one structural batch, runs next
  var editInFlight = false;
  var freshSha = null;       // sha from the last response (meta lags until reload)

  function editsBusy() {
    return editInFlight || editQueue.length > 0 || nextStructural !== null;
  }

  function clearEditQueue() {
    editQueue.length = 0;
    nextStructural = null;
    freshSha = null;
  }

  function rvPostEdit(edits) {
    var structural = edits.some(function (e) { return STRUCTURAL_OPS[e.op] === 1; });
    if (!editsBusy()) return sendEdit(edits);
    if (structural) {
      if (editQueue.length) F.toast('Dropped ' + editQueue.length + ' pending edit(s) — layout changed');
      editQueue.length = 0;
      nextStructural = edits;
    } else if (nextStructural) {
      F.toast('Edit dropped — the layout is about to change');
    } else {
      editQueue.push(edits);
    }
    return Promise.resolve(true);
  }

  function sendEdit(edits) {
    editInFlight = true;
    if (typeof rvStatus === 'function') rvStatus('saving', 'Saving to ' + PRES_NAME + '…');
    return fetch('/__rv__/edit', {
      method: 'POST',
      headers: { 'X-RV-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha256: freshSha || F.curSha(), edits: edits }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        editInFlight = false;
        if (!r.ok) {
          clearEditQueue();
          if (typeof rvStatus === 'function') rvStatus('error', 'Not saved ✗');
          try { sessionStorage.removeItem('rv-ed-lastsave'); } catch (e2) {}
          F.toast(j.error === 'sha_mismatch'
            ? 'Deck changed on disk — resyncing'
            : 'Edit rejected: ' + (j.error || r.status));
          if (j.error === 'sha_mismatch') F.saveStateAndReload();
          else maybeReload();  // a deferred reload must not stay stuck
          return false;
        }
        freshSha = j.sha256 || null;
        var next = nextStructural || editQueue.shift() || null;
        nextStructural = (next === nextStructural) ? null : nextStructural;
        if (next) sendEdit(next);
        else maybeReload();
        return true;  // the rebuild's SSE reload refreshes everything
      });
    }).catch(function () {
      editInFlight = false;
      clearEditQueue();
      F.toast('Edit failed: server unreachable');
      maybeReload();
      return false;
    });
  }

  /* --- reload deferral: never yank the DOM mid-interaction -------------------
     SSE reloads wait for the edit queue and any active drag/drop to finish,
     with a 5 s force-fire so a wedged state can't suppress reloads forever. */
  var pendingReload = false;
  var reloadForceTimer = null;

  function maybeReload() {
    if (!pendingReload) return;
    if (editsBusy() || S.drag || S.dropState) return;
    pendingReload = false;
    if (reloadForceTimer) { clearTimeout(reloadForceTimer); reloadForceTimer = null; }
    hideError();
    F.saveStateAndReload();
  }

  function scheduleReload() {
    flushNudge();  // an uncommitted nudge would be lost by the reload
    pendingReload = true;
    if (!reloadForceTimer) {
      reloadForceTimer = setTimeout(function () {
        reloadForceTimer = null;
        if (pendingReload) { pendingReload = false; hideError(); F.saveStateAndReload(); }
      }, 5000);
    }
    maybeReload();
  }

  function rvUndoRedo(which) {
    fetch('/__rv__/' + which, { method: 'POST', headers: { 'X-RV-Token': TOKEN } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) F.toast(j.error === 'external_edit'
          ? 'File changed outside the editor — use your editor’s undo'
          : 'Nothing to ' + which);
      }); });
  }


  function rvScale() {
    var slides = document.querySelector('.reveal .slides');
    if (!slides || !window.Reveal) return 1;
    var r = slides.getBoundingClientRect();
    var s = r.height / Reveal.getConfig().height;
    return (isFinite(s) && s > 0) ? s : 1;
  }

  /* --- drag handles ------------------------------------------------------------ */


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
    if (!S.on || !S.sel || !document.contains(S.sel) || S.drag) return;
    var host = layer();
    var el = S.sel;
    var kind = F.constructOf(el);
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
      if (next && F.hasCls(next, 'region')) {
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
    if (RV.MOVABLE[kind] && el.hasAttribute('data-rv-src')) {
      var mv = mkGrip('rv-ed-move', 'grab', 'move to another column');
      mv.addEventListener('pointerdown', function (ev) { startDrag(ev, 'block-move', el); });
      place(mv, r.left, r.top);
    }
  }

  /* --- drag state machine -------------------------------------------------------- */

  function startDrag(ev, kind, el, extra) {
    ev.preventDefault();
    ev.stopPropagation();
    flushNudge();
    var r = el.getBoundingClientRect();
    S.drag = Object.assign({
      kind: kind, el: el, x0: ev.clientX, y0: ev.clientY,
      r0: r, scale: rvScale(),
    }, extra || {});
    if (kind === 'col-split') {
      S.drag.rNext0 = S.drag.next.getBoundingClientRect();
      S.drag.g0 = parseFloat(getComputedStyle(el).flexGrow) || 1;
      S.drag.g1 = parseFloat(getComputedStyle(S.drag.next).flexGrow) || 1;
    }
    if (kind === 'block-move') buildDropTargets(el);
    document.addEventListener('pointermove', onDragMove, true);
    document.addEventListener('pointerup', onDragUp, true);
    clearHandles();
  }

  function onDragMove(ev) {
    if (!S.drag) return;
    var dx = ev.clientX - S.drag.x0, dy = ev.clientY - S.drag.y0;
    var el = S.drag.el, r0 = S.drag.r0;

    if (S.drag.kind === 'pin-move') {
      // preview via transform on top of the base translate(-50%,-50%)
      el.style.transform = 'translate(-50%, -50%) translate(' + dx + 'px,' + dy + 'px)';
    } else if (S.drag.kind === 'pin-width') {
      var w0 = r0.width;
      el.style.width = Math.max(20, w0 + dx) + 'px';
    } else if (S.drag.kind === 'media-size') {
      var target = el.tagName === 'FIGURE' ? el.querySelector('img,video') : el;
      if (target) { target.style.height = Math.max(16, r0.height + dy) + 'px'; target.style.width = 'auto'; }
    } else if (S.drag.kind === 'row-height' || S.drag.kind === 'stack-height') {
      var h = Math.max(24, r0.height + dy);
      el.style.flex = '0 0 ' + h + 'px';
      el.style.height = h + 'px';
    } else if (S.drag.kind === 'col-split') {
      var total = S.drag.g0 + S.drag.g1;
      var wPair = r0.width + S.drag.rNext0.width;
      var ratio = Math.min(0.92, Math.max(0.08, (r0.width + dx) / wPair));
      el.style.flexGrow = (total * ratio).toFixed(4);
      S.drag.next.style.flexGrow = (total * (1 - ratio)).toFixed(4);
      S.drag.ratio = ratio;
    } else if (S.drag.kind === 'block-move') {
      moveGhost(ev);
      pickDropSlot(ev);
    }
    syncChrome();
  }

  function onDragUp(ev) {
    document.removeEventListener('pointermove', onDragMove, true);
    document.removeEventListener('pointerup', onDragUp, true);
    var d = S.drag;
    S.drag = null;
    if (!d) return;
    var el = d.el, line = F.srcOf(el);

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
    maybeReload();
  }

  /* --- column split commit --------------------------------------------------------- */

  var SNAPS = [
    [1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 5], [2, 5], [3, 5], [4, 5],
    [1, 12], [5, 12], [7, 12], [11, 12],
  ];

  function commitColSplit(d) {
    var row = d.el.parentElement;
    var regions = Array.prototype.filter.call(row.children, function (c) { return F.hasCls(c, 'region'); });
    var ratio = d.ratio;
    if (ratio === undefined) return;
    var lineA = F.srcOf(d.el), lineB = F.srcOf(d.next);
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
      var sum = Math.round(d.g0 + d.g1);
      if (sum < 2 || Math.abs(sum - (d.g0 + d.g1)) > 0.01) {
        F.toast('These columns use sizes I can’t redistribute — edit the source');
        F.saveStateAndReload();
        return;
      }
      var ai = Math.min(sum - 1, Math.max(1, Math.round(ratio * sum)));
      opA = String(ai);
      opB = String(sum - ai);
    }
    rvPostEdit([
      { op: 'set_col_size', line: lineA, new: opA },
      { op: 'set_col_size', line: lineB, new: opB },
    ]);
  }

  /* --- keyboard nudging --------------------------------------------------------------- */

  // Arrow nudges debounce their POST; anything that retargets, drags,
  // deletes, or reloads must flush the pending commit first so it is
  // neither lost nor applied to the wrong element.
  function queueNudge(fn) {
    clearTimeout(S.nudgeTimer);
    S.nudgeFlush = fn;
    S.nudgeTimer = setTimeout(function () {
      S.nudgeTimer = null;
      S.nudgeFlush = null;
      fn();
    }, 450);
  }

  function flushNudge() {
    if (!S.nudgeFlush) return;
    clearTimeout(S.nudgeTimer);
    S.nudgeTimer = null;
    var fn = S.nudgeFlush;
    S.nudgeFlush = null;
    fn();
  }


  var NUDGE_ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  function nudgeSelected(ev) {
    var v = NUDGE_ARROWS[ev.key];
    if (!v) return;
    var el = S.sel, kind = F.constructOf(el);
    ev.preventDefault();
    ev.stopPropagation();
    var mult = ev.shiftKey ? 4 : 1;

    if (kind === 'pin') {
      var parent = el.offsetParent || el.parentElement;
      var pr = parent.getBoundingClientRect();
      el._nx = (el._nx === undefined ? 0 : el._nx) + v[0] * mult * pr.width / 100;
      el._ny = (el._ny === undefined ? 0 : el._ny) + v[1] * mult * pr.height / 100;
      el.style.transform = 'translate(-50%, -50%) translate(' + el._nx + 'px,' + el._ny + 'px)';
      queueNudge(function () {
        var r = el.getBoundingClientRect();
        var cx = Math.round((r.left + r.width / 2 - pr.left) / pr.width * 200) / 2;
        var cy = Math.round((r.top + r.height / 2 - pr.top) / pr.height * 200) / 2;
        var op = { op: 'set_pin', line: F.srcOf(el), x: cx + '%', y: cy + '%' };
        if (el.style.width && el.style.width.indexOf('%') !== -1) op.w = el.style.width;
        rvPostEdit([op]);
      });
    } else if (kind === 'media' || kind === 'row' || kind === 'stack') {
      var target = (kind === 'media' && el.tagName === 'FIGURE') ? el.querySelector('img,video') : el;
      if (!target) return;
      var h = target.getBoundingClientRect().height + v[1] * 5 * mult * rvScale();
      if (v[1] === 0) return;
      if (kind === 'media') { target.style.height = h + 'px'; target.style.width = 'auto'; }
      else { el.style.flex = '0 0 ' + h + 'px'; el.style.height = h + 'px'; }
      queueNudge(function () {
        var hpx = Math.round(target.getBoundingClientRect().height / rvScale());
        rvPostEdit([kind === 'media'
          ? { op: 'set_media_size', line: F.srcOf(el), dim: 'h', value: hpx + 'px' }
          : { op: (kind === 'row' ? 'set_row_height' : 'set_stack_height'), line: F.srcOf(el), value: hpx }]);
      });
    }
    syncChrome();
  }

  /* --- block move: ghost, drop targets, commit ------------------------------------------ */


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
        return { line: F.srcOf(k), y: k.getBoundingClientRect().top };
      });
      slots.push({ line: F.srcEndOf(c) + 1, y: c.getBoundingClientRect().bottom });
      targets.push({ el: c, slots: slots,
                     kind: F.hasCls(c, 'column') ? 'column' : 'col' });
      c.classList.add('rv-ed-droptarget');
    });
    S.dropState = { targets: targets, active: null };
  }

  function clearDropTargets() {
    document.querySelectorAll('.rv-ed-droptarget').forEach(function (c) {
      c.classList.remove('rv-ed-droptarget');
    });
    var bar = document.getElementById('rv-ed-slotbar');
    if (bar) bar.remove();
    var ghost = document.getElementById('rv-ed-ghost');
    if (ghost) ghost.remove();
    S.dropState = null;
    maybeReload();
  }

  function moveGhost(ev) {
    var g = document.getElementById('rv-ed-ghost');
    if (!g) {
      g = document.createElement('div');
      g.id = 'rv-ed-ghost';
      g.textContent = F.kindOf(S.drag.el);
      document.body.appendChild(g);
    }
    g.style.left = (ev.clientX + 12) + 'px';
    g.style.top = (ev.clientY + 12) + 'px';
  }

  function pickDropSlot(ev) {
    if (!S.dropState) return;
    var hit = null;
    S.dropState.targets.forEach(function (t) {
      var r = t.el.getBoundingClientRect();
      if (ev.clientX >= r.left && ev.clientX <= r.right &&
          ev.clientY >= r.top - 8 && ev.clientY <= r.bottom + 8) hit = t;
    });
    var bar = document.getElementById('rv-ed-slotbar');
    if (!hit) { if (bar) bar.remove(); S.dropState.active = null; return; }
    var slot = hit.slots[0], dist = Infinity;
    hit.slots.forEach(function (s) {
      var d = Math.abs(ev.clientY - s.y);
      if (d < dist) { dist = d; slot = s; }
    });
    S.dropState.active = { target: hit, slot: slot };
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
    var choice = S.dropState && S.dropState.active;
    var el = d.el;
    clearDropTargets();
    if (!choice) { syncChrome(); return; }
    var construct = F.constructOf(el);
    if (construct === 'region') construct = 'paragraph';
    rvPostEdit([{
      op: 'move_block',
      src: [F.srcOf(el), F.srcEndOf(el)],
      construct: RV.MOVABLE[construct] ? construct : 'paragraph',
      dest: {
        insert_before: choice.slot.line,
        container: [F.srcOf(choice.target.el), F.srcEndOf(choice.target.el)],
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
    var k = F.constructOf(el);
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
    var w = RV.ui.box({ id: 'rv-ed-drawer', title: 'Fragments (reveal order)' });
    if (!w) return;
    w.body.innerHTML = '<div class="rv-ed-drawer-list"></div>' +
      '<div class="rv-ed-drawer-foot">↑↓ reorder · writes explicit +1..+n</div>';
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
      var label = F.kindOf(el) + (mapped ? ' · :' + el.getAttribute('data-rv-src') : ' · (unmapped)');
      row.innerHTML = '<span>' + (i + 1) + '. ' + label + '</span>' +
        (mapped ? '<span class="rv-ed-updown"><button data-d="-1">↑</button>' +
                  '<button data-d="1">↓</button></span>' : '');
      row.addEventListener('mouseenter', function () { S.hover = el; syncChrome(); });
      row.addEventListener('mouseleave', function () { S.hover = null; syncChrome(); });
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
      F.toast('Some fragments are raw HTML — their order can’t be rewritten');
    }
    rvPostEdit([{
      op: 'reorder_fragments',
      order: mapped.map(function (el) {
        return { line: F.srcOf(el), construct: fragConstruct(el) };
      }),
    }]);
  }


  /* --- OS file drag-drop --------------------------------------------------------------------- */

  window.addEventListener('dragover', function (ev) {
    if (!S.on) return;
    if (!ev.dataTransfer || Array.prototype.indexOf.call(ev.dataTransfer.types, 'Files') === -1) return;
    ev.preventDefault();
    if (!S.dropState) buildDropTargets(document.createElement('div'));
    pickDropSlot(ev);
  });

  window.addEventListener('drop', function (ev) {
    if (!S.on || !ev.dataTransfer || !ev.dataTransfer.files.length) return;
    ev.preventDefault();
    var choice = S.dropState && S.dropState.active;
    var file = ev.dataTransfer.files[0];
    clearDropTargets();
    if (!choice) { F.toast('Drop inside a column to insert media'); return; }
    var isVideo = /^video\//.test(file.type) || /\.(mp4|webm|ogv|mov)$/i.test(file.name);
    fetch('/__rv__/upload?name=' + encodeURIComponent(file.name), {
      method: 'PUT', headers: { 'X-RV-Token': TOKEN }, body: file,
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { F.toast('Upload rejected: ' + (j.error || '?')); return; }
      rvPostEdit([{
        op: 'insert_media',
        at: { insert_before: choice.slot.line,
              container: [F.srcOf(choice.target.el), F.srcEndOf(choice.target.el)],
              container_kind: choice.target.kind },
        kind: isVideo ? 'video' : 'img',
        path: j.path,
        flags: choice.target.kind === 'col' ? ['fill'] : [],
      }]);
    }).catch(function () { F.toast('Upload failed'); });
  });

  window.addEventListener('dragleave', function (ev) {
    if (S.on && !ev.relatedTarget && S.dropState && !S.drag) clearDropTargets();
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
      '<button class="rv-tb-hist" title="Save history (time machine)">🕐</button>' +
      '<button class="rv-tb-xhtml" title="Export the final HTML next to the .pres">⬇ HTML</button>' +
      '<button class="rv-tb-xpdf" title="Export a PDF next to the .pres">⬇ PDF</button>' +
      '<span class="rv-tb-status rv-st-idle">' + F.escapeHtml(PRES_NAME) + '</span>' +
      '<button class="rv-tb-help" title="Help">?</button>';
    document.body.appendChild(tb);
    tb.querySelector('.rv-tb-edit').addEventListener('click', function () { setEdit(!S.on); });
    tb.querySelector('.rv-tb-undo').addEventListener('click', function () { rvUndoRedo('undo'); });
    tb.querySelector('.rv-tb-redo').addEventListener('click', function () { rvUndoRedo('redo'); });
    tb.querySelector('.rv-tb-frag').addEventListener('click', function () {
      if (!S.on) setEdit(true);
      toggleDrawer();
    });
    tb.querySelector('.rv-tb-help').addEventListener('click', toggleHelp);
    function doExport(kind) {
      F.toast(kind === 'pdf' ? 'Exporting PDF… (can take a minute)' : 'Exporting HTML…', 60000);
      fetch('/__rv__/export?kind=' + kind, { method: 'POST', headers: { 'X-RV-Token': TOKEN } })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          F.toast(j.ok ? 'Exported → ' + j.path : 'Export failed: ' + (j.error || '?'), 6000);
        })
        .catch(function () { F.toast('Export failed', 4000); });
    }
    tb.querySelector('.rv-tb-xhtml').addEventListener('click', function () { doExport('html'); });
    if (window.__RV_DEV__.history === 'fallback') {
      var hb = tb.querySelector('.rv-tb-hist');
      hb.disabled = true;
      hb.title = 'Save history needs git on the server\u2019s PATH';
      hb.style.opacity = '0.4';
      if (!window.__rvHistToastShown) {
        window.__rvHistToastShown = true;
        F.toast('git not found \u2014 undo limited to the last edit, no save history', 6000);
      }
    } else {
      tb.querySelector('.rv-tb-hist').addEventListener('click', toggleHistory);
    }
    tb.querySelector('.rv-tb-xpdf').addEventListener('click', function () { doExport('pdf'); });
    tb.querySelector('.rv-tb-media').addEventListener('click', function () {
      if (!S.on) setEdit(true);
      importMedia();
    });
    tb.querySelector('.rv-tb-view').addEventListener('click', function () {
      S.splitPref = !S.splitPref;
      try { localStorage.setItem('rv-ed-split', S.splitPref ? '1' : '0'); } catch (e) {}
      if (!S.on && S.splitPref) setEdit(true);
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
    var w = RV.ui.box({ id: 'rv-ed-help', title: 'How editing works',
                        closes: ['rv-ed-history'] });
    if (!w) return;
    w.body.innerHTML =
      '<p>You are editing <code>' + F.escapeHtml(PRES_NAME) + '</code> — the source text file, ' +
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
      '</ul>';
  }

  /* --- side panel ---------------------------------------------------------------- */


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
    p.style.display = S.on ? 'flex' : 'none';
    if (!S.on) { S.panelFor = null; return; }
    var sec = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
    var key = S.sel || sec;
    if (key === S.panelFor) return;
    S.panelFor = key;
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

  /* Panel /src loads: only the newest render may fill the box. Older
     in-flight requests are aborted and epoch-guarded (an abort alone can't
     protect against a response already in the microtask queue). */
  var srcEpoch = 0;
  var srcCtl = null;

  function fetchSrc(start, end, cb) {
    srcEpoch += 1;
    var epoch = srcEpoch;
    if (srcCtl) { try { srcCtl.abort(); } catch (e) {} }
    var ctl = window.AbortController ? new AbortController() : null;
    srcCtl = ctl;
    fetch('/__rv__/src?start=' + start + '&end=' + end +
          '&token=' + encodeURIComponent(TOKEN),
          ctl ? { signal: ctl.signal } : undefined)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (epoch !== srcEpoch) return;
        cb(j);
      })
      .catch(function () { /* aborted or unreachable — nothing to fill */ });
  }

  function renderPanel() {
    var p = panelEl();
    var el = S.sel;
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
    var kind = F.constructOf(el) || 'element';
    var s = F.srcOf(el), e = F.srcEndOf(el);

    var crumbs = crumbChain(el).map(function (c) {
      var label = c === el ? '<b>' + F.kindOf(c) + '</b>' : F.kindOf(c);
      return '<span class="rv-pn-crumb" data-src="' + F.escapeHtml(c.getAttribute('data-rv-src')) + '">' + F.escapeHtml(label) + '</span>';
    }).join(' ▸ ');

    p.innerHTML =
      '<div class="rv-pn-head">' + crumbs + '</div>' +
      '<div class="rv-pn-sub">' + F.escapeHtml(PRES_NAME) + ' : ' + s + (e !== s ? '–' + e : '') + '</div>' +
      '<div class="rv-pn-fields"></div>' +
      '<div class="rv-pn-actions">' +
      '<button class="rv-pn-up" title="Move before the previous sibling">▲ Up</button>' +
      '<button class="rv-pn-down" title="Move after the next sibling">▼ Down</button>' +
      '<button class="rv-pn-del" title="Delete this block from the .pres (Del)">🗑 Delete</button>' +
      '</div>' +
      '<div class="rv-pn-srctitle">Source (editable)</div>' +
      '<div class="rv-fmt-slot"></div>' +
      '<textarea class="rv-pn-src" spellcheck="false"></textarea>' +
      '<button class="rv-pn-apply">Apply source</button>' +
      '<div class="rv-pn-foot">Changes save automatically to the .pres — no save button needed.</div>';
    appendCheatsheet(p);

    p.querySelectorAll('.rv-pn-crumb').forEach(function (c) {
      c.addEventListener('click', function () {
        var slide = Reveal.getCurrentSlide();
        var t = (slide && slide.querySelector('[data-rv-src="' + c.getAttribute('data-src') + '"]')) ||
                document.querySelector('section[data-rv-src="' + c.getAttribute('data-src') + '"]');
        if (t) { S.sel = t; syncChrome(); }
      });
    });
    p.querySelector('.rv-pn-up').addEventListener('click', function () { moveSibling(el, -1); });
    p.querySelector('.rv-pn-down').addEventListener('click', function () { moveSibling(el, 1); });
    p.querySelector('.rv-pn-del').addEventListener('click', function () { deleteSelected(el); });

    var slot1 = p.querySelector('.rv-fmt-slot');
    if (slot1) slot1.appendChild(formatBar(p.querySelector('.rv-pn-src')));
    // Source box + parameter fields need the actual .pres lines. Apply stays
    // disabled until they arrive, and commits exactly the span it displays.
    var applyBtn = p.querySelector('.rv-pn-apply');
    applyBtn.disabled = true;
    var bounds = null;
    fetchSrc(s, e, function (j) {
      if (!j.lines) return;
      var ta = p.querySelector('.rv-pn-src');
      if (ta) ta.value = j.lines.join('\n');
      buildFields(p.querySelector('.rv-pn-fields'), kind, el, j.lines, s, e);
      bounds = { start: j.start, end: j.end };
      applyBtn.disabled = false;
    });

    applyBtn.addEventListener('click', function () {
      if (!bounds) return;
      var ta = p.querySelector('.rv-pn-src');
      rvPostEdit([{ op: 'replace_lines', start: bounds.start, end: bounds.end, text: ta.value.split('\n') }]);
    });
  }

  function renderSlideSource(p, sec) {
    var s0 = F.srcOf(sec), e0 = F.srcEndOf(sec);
    p.innerHTML =
      '<div class="rv-pn-head"><b>' + (F.kindOf(sec) === 'slide' ? 'This slide' : F.kindOf(sec)) + '</b>' +
      ' <span class="rv-pn-sub">' + F.escapeHtml(PRES_NAME) + ' : ' + s0 + '–' + e0 + '</span></div>' +
      '<div class="rv-pn-hint">Click an element for its parameters, or edit the whole slide here.</div>' +
      '<div class="rv-pn-srctitle">Slide source (editable)</div>' +
      '<div class="rv-fmt-slot"></div>' +
      '<textarea class="rv-pn-src rv-pn-src-slide" spellcheck="false"></textarea>' +
      '<button class="rv-pn-apply">Apply source</button>' +
      '<div class="rv-pn-foot">Changes save automatically to the .pres — no save button needed.</div>';
    var slot0 = p.querySelector('.rv-fmt-slot');
    if (slot0) slot0.appendChild(formatBar(p.querySelector('.rv-pn-src')));
    var applyBtn0 = p.querySelector('.rv-pn-apply');
    applyBtn0.disabled = true;
    var bounds0 = null;
    fetchSrc(s0, e0, function (j) {
      var ta = p.querySelector('.rv-pn-src');
      if (j.lines && ta) ta.value = j.lines.join('\n');
      if (j.lines) {
        bounds0 = { start: j.start, end: j.end };
        applyBtn0.disabled = false;
      }
    });
    applyBtn0.addEventListener('click', function () {
      if (!bounds0) return;
      var ta = p.querySelector('.rv-pn-src');
      rvPostEdit([{ op: 'replace_lines', start: bounds0.start, end: bounds0.end, text: ta.value.split('\n') }]);
    });
    appendCheatsheet(p);
  }

  function wrapSel(ta, before, after) {
    var a = ta.selectionStart, b = ta.selectionEnd;
    var mid = ta.value.slice(a, b) || 'text';
    ta.value = ta.value.slice(0, a) + before + mid + after + ta.value.slice(b);
    ta.focus();
    ta.selectionStart = a + before.length;
    ta.selectionEnd = a + before.length + mid.length;
  }

  var PALETTE = [['accent', '--rv-accent'], ['warn', '--rv-warn'],
                 ['good', '--rv-good'], ['muted', '--rv-muted-color']];

  function formatBar(ta) {
    var bar = document.createElement('div');
    bar.className = 'rv-fmt';
    var root = getComputedStyle(document.documentElement);
    bar.innerHTML =
      '<button data-b="**" data-a="**" title="bold"><b>B</b></button>' +
      '<button data-b="*" data-a="*" title="italic"><i>I</i></button>' +
      '<button data-b="\`" data-a="\`" title="code">&lt;&gt;</button>' +
      PALETTE.map(function (c) {
        return '<button class="rv-fmt-sw" data-b="[" data-a="]{.' + c[0] + '}" title="' + c[0] +
          '" style="background:' + F.escapeHtml(root.getPropertyValue(c[1]).trim() || '#888') + '"></button>';
      }).join('') +
      '<input type="color" title="custom color" value="#1a4fd6">' +
      '<select title="size"><option value="">size…</option>' +
      ['title', 'lede', 'sm', 'fine'].map(function (r) {
        return '<option value="' + r + '">' + r + '</option>';
      }).join('') + '</select>';
    bar.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        wrapSel(ta, b.getAttribute('data-b'), b.getAttribute('data-a'));
      });
    });
    bar.querySelector('input[type=color]').addEventListener('change', function (ev) {
      wrapSel(ta, '[', ']{color=' + ev.target.value + '}');
    });
    bar.querySelector('select').addEventListener('change', function (ev) {
      if (ev.target.value) wrapSel(ta, '[', ']{.' + ev.target.value + '}');
      ev.target.value = '';
    });
    return bar;
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
    ['Inline format', ['**bold**  *italic*  \`code\`', '[text](https://url)',
                       '[text]{.accent}  [x]{color=#f00}', '[big]{.lede}  [small]{.sm}',
                       '> size: lede   (paragraph scope)', '> align: center',
                       'escape: \\* \\\` \\[']],
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

  /* --- time machine ------------------------------------------------------------------ */

  function relTime(ts) {
    var d = Math.max(0, Date.now() / 1000 - ts);
    if (d < 90) return Math.round(d) + 's ago';
    if (d < 5400) return Math.round(d / 60) + 'min ago';
    if (d < 129600) return Math.round(d / 3600) + 'h ago';
    return Math.round(d / 86400) + 'd ago';
  }

  function toggleHistory() {
    var w = RV.ui.box({
      id: 'rv-ed-history', title: '🕐 Save history',
      closes: ['rv-ed-help'],
      buttons: [{
        label: 'Snapshot…', cls: 'rv-hi-snap',
        title: 'Snapshot the current state with a note',
        onClick: function () {
          var msg = window.prompt('Snapshot note:', 'before big rework');
          if (msg === null) return;
          fetch('/__rv__/history/commit', {
            method: 'POST', headers: { 'X-RV-Token': TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg }),
          }).then(function () {
            var hd = document.getElementById('rv-ed-history');
            if (hd) loadHistory(hd);
          });
        },
      }],
    });
    if (!w) return;
    w.body.innerHTML =
      '<div class="rv-hi-hint">Every save is committed automatically to a shadow git ' +
      'repo (.rv-history/) inside the deck folder. Restoring first snapshots the ' +
      'current state — nothing is ever lost. Ctrl+Z also undoes a restore.</div>' +
      '<div class="rv-hi-list">loading…</div>';
    loadHistory(w.box);
  }

  function loadHistory(hd) {
    fetch('/__rv__/history?token=' + encodeURIComponent(TOKEN))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var list = hd.querySelector('.rv-hi-list');
        if (!j.entries || !j.entries.length) {
          list.innerHTML = '<div class="rv-hi-item">no snapshots yet — save once</div>';
          return;
        }
        var cur = j.cursor || (j.entries[0] && j.entries[0].hash);
        list.innerHTML = j.entries.map(function (e) {
          return '<div class="rv-hi-item' + (e.hash === cur ? ' rv-hi-current' : '') + '">' +
            (e.hash === cur ? '<span class="rv-hi-cur">◀ current</span>' : '') +
            '<span class="rv-hi-badge' + (e.auto ? '' : ' rv-hi-manual') + '">' +
            (e.auto ? 'auto' : 'save') + '</span>' +
            '<span class="rv-hi-when">' + relTime(e.ts) + '</span>' +
            '<span class="rv-hi-msg">' + F.escapeHtml(e.msg.replace(/^(auto|save): /, '')) + '</span>' +
            '<button class="rv-hi-diff" data-h="' + e.hash + '">Diff</button>' +
            '<button class="rv-hi-peek" data-h="' + e.hash + '">Peek</button>' +
            '<button data-h="' + e.hash + '">Restore</button></div>' +
            '<pre class="rv-hi-diffbox" data-h="' + e.hash + '" hidden></pre>';
        }).join('');
        list.querySelectorAll('.rv-hi-diff').forEach(function (b) {
          b.addEventListener('click', function () {
            var box = list.querySelector('.rv-hi-diffbox[data-h="' + b.getAttribute('data-h') + '"]');
            if (!box.hidden) { box.hidden = true; return; }
            fetch('/__rv__/history/diff?hash=' + b.getAttribute('data-h') +
                  '&token=' + encodeURIComponent(TOKEN))
              .then(function (r) { return r.json(); })
              .then(function (jj) {
                box.innerHTML = (jj.diff || '(no diff)').split('\n').map(function (ln) {
                  var esc = ln.replace(/&/g, '&amp;').replace(/</g, '&lt;');
                  if (/^\+(?!\+\+)/.test(ln)) return '<span class="rv-d-add">' + esc + '</span>';
                  if (/^-(?!--)/.test(ln)) return '<span class="rv-d-del">' + esc + '</span>';
                  return esc;
                }).join('\n');
                box.hidden = false;
              });
          });
        });
        list.querySelectorAll('.rv-hi-peek').forEach(function (b) {
          b.addEventListener('click', function () {
            fetch('/__rv__/history/preview', {
              method: 'POST', headers: { 'X-RV-Token': TOKEN, 'Content-Type': 'application/json' },
              body: JSON.stringify({ hash: b.getAttribute('data-h') }),
            }).then(function (r) { return r.json(); }).then(function (jj) {
              if (!jj.ok) { F.toast('Preview failed: ' + (jj.error || '?')); return; }
              openPeek(jj.url, b.getAttribute('data-h'));
            });
          });
        });
        list.querySelectorAll('button[data-h]:not(.rv-hi-diff):not(.rv-hi-peek)').forEach(function (b) {
          b.addEventListener('click', function () {
            fetch('/__rv__/history/restore', {
              method: 'POST', headers: { 'X-RV-Token': TOKEN, 'Content-Type': 'application/json' },
              body: JSON.stringify({ hash: b.getAttribute('data-h') }),
            }).then(function (r) { return r.json(); }).then(function (jj) {
              if (jj.unchanged) F.toast('Already at that version');
              else if (jj.ok) F.toast('Restored — Ctrl+Z to undo');
              else F.toast('Restore failed: ' + (jj.error || '?'));
            });
          });
        });
      });
  }

  function openPeek(url, hash) {
    var w = RV.ui.box({
      id: 'rv-ed-peek', replace: true, headCls: 'rv-pk-bar',
      title: '🕐 Peek: past version',
      hint: 'read-only preview — the deck is unchanged',
      buttons: [{
        label: 'Restore this version', cls: 'rv-pk-restore',
        onClick: function () {
          fetch('/__rv__/history/restore', {
            method: 'POST', headers: { 'X-RV-Token': TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ hash: hash }),
          }).then(function (r) { return r.json(); }).then(function (jj) {
            var ov = document.getElementById('rv-ed-peek');
            if (ov) ov.remove();
            F.toast(jj.ok ? 'Restored — Ctrl+Z to undo' : 'Restore failed');
          });
        },
      }],
    });
    var fr = document.createElement('iframe');
    fr.src = url;
    w.body.appendChild(fr);
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
      if (!j.ok) { F.toast('Upload rejected: ' + (j.error || '?')); return; }
      var sel = S.sel, at = null, flags = [];
      var sec = window.Reveal && Reveal.getCurrentSlide();
      function spanDest(container, kind) {
        return { insert_before: F.srcEndOf(container) + 1,
                 container: [F.srcOf(container), F.srcEndOf(container)],
                 container_kind: kind };
      }
      if (sel && sel.hasAttribute('data-rv-src') &&
          (F.hasCls(sel, 'region') || F.hasCls(sel, 'rv-card') || F.hasCls(sel, 'rv-cell') ||
           F.hasCls(sel, 'rv-layer') || F.hasCls(sel, 'column'))) {
        at = spanDest(sel, F.hasCls(sel, 'column') ? 'column' : 'col');
        flags = F.hasCls(sel, 'column') ? [] : ['fill'];
      } else if (sel && sel.hasAttribute('data-rv-src') && sel.tagName !== 'SECTION') {
        var cont = containerOf(sel) || sec;
        at = { insert_before: F.srcEndOf(sel) + 1,
               container: [F.srcOf(cont), F.srcEndOf(cont)],
               container_kind: F.hasCls(cont, 'column') ? 'column' :
                               (cont.tagName === 'SECTION' ? 'slide' : 'col') };
        flags = cont.tagName === 'SECTION' || F.hasCls(cont, 'column') ? [] : ['fill'];
      } else if (sec && sec.hasAttribute('data-rv-src')) {
        at = spanDest(sec, 'slide');
      }
      if (!at) { F.toast('Uploaded to ' + j.path + ' — add a “! ' + j.path + '” line'); return; }
      rvPostEdit([{ op: 'insert_media', at: at, kind: isVideo ? 'video' : 'img',
                    path: j.path, flags: flags }]);
    }).catch(function () { F.toast('Upload failed'); });
  }

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
      '<input type="text" value="' + (value == null ? '' : F.escapeHtml(value)) + '"' +
      (hint ? ' placeholder="' + F.escapeHtml(hint) + '"' : '') + '></label>';
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
    } else if (kind === 'svg') {
      buildSvgSteps(box, el, s);
      return;
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

  var SVG_ANIM_RE = /^>\s*animate\s*:\s*#([\w-]+)\s+opacity:1\s*(?:@.*)?$/;
  var SVG_HIDE_RE = /^>\s*hide\s*:\s*(.*)$/;
  var SVG_BLOCK_RE = /^>\s*(hide|animate)\s*:/;

  function buildSvgSteps(box, el, svgLine) {
    var ids = [];
    el.querySelectorAll('svg [id]').forEach(function (n) {
      if (ids.length < 40 && n.id) ids.push({ id: n.id, node: n });
    });
    if (!ids.length) {
      box.innerHTML = '<div class="rv-pn-hint">No id-carrying elements in this SVG — ' +
        'add ids (e.g. in Inkscape) to animate parts.</div>';
      return;
    }
    var sec = Reveal.getCurrentSlide();
    fetch('/__rv__/src?start=' + F.srcOf(sec) + '&end=' + F.srcEndOf(sec) +
          '&token=' + encodeURIComponent(TOKEN))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.lines || !document.contains(box)) return;  // panel re-rendered
        var base = F.srcOf(sec);
        var rel = svgLine - base;           // index of `> svg:` in j.lines
        var end = rel;
        var hidden = {}, step = {}, order = 0, preserved = [];
        for (var k = rel + 1; k < j.lines.length && SVG_BLOCK_RE.test(j.lines[k]); k++) {
          end = k;
          var hm = j.lines[k].match(SVG_HIDE_RE);
          var am = j.lines[k].match(SVG_ANIM_RE);
          if (hm) {
            hm[1].split(',').forEach(function (x) { hidden[x.trim().replace('#', '')] = 1; });
          } else if (am) {
            step[am[1]] = ++order;
          } else {
            preserved.push(j.lines[k]);
          }
        }
        box.innerHTML = '<div class="rv-pn-hint">Reveal SVG elements as steps ' +
          '(– = always visible):</div>' +
          ids.map(function (it, i) {
            var cur = step[it.id] || '';
            return '<label class="rv-pn-fld" data-id="' + F.escapeHtml(it.id) + '"><span>#' + F.escapeHtml(it.id) +
              '</span><select>' + ['<option value="">–</option>'].concat(
                [1,2,3,4,5,6,7,8].map(function (n) {
                  return '<option value="' + n + '"' + (cur === n ? ' selected' : '') +
                    '>step ' + n + '</option>';
                })).join('') + '</select></label>';
          }).join('') +
          '<button class="rv-pn-svgapply">Apply steps</button>';
        box.querySelectorAll('.rv-pn-fld').forEach(function (row) {
          var node = el.querySelector('svg [id="' + row.getAttribute('data-id') + '"]');
          row.addEventListener('mouseenter', function () { S.hover = node; syncChrome(); });
          row.addEventListener('mouseleave', function () { S.hover = null; syncChrome(); });
        });
        box.querySelector('.rv-pn-svgapply').addEventListener('click', function () {
          var chosen = [];
          box.querySelectorAll('.rv-pn-fld').forEach(function (row) {
            var v = row.querySelector('select').value;
            if (v) chosen.push({ id: row.getAttribute('data-id'), n: parseInt(v, 10) });
          });
          chosen.sort(function (a, b) { return a.n - b.n; });
          var block = [j.lines[rel]];
          if (chosen.length) {
            block.push('> hide: ' + chosen.map(function (c) { return '#' + c.id; }).join(','));
            chosen.forEach(function (c) { block.push('> animate: #' + c.id + ' opacity:1'); });
          }
          preserved.forEach(function (ln) { block.push(ln); });
          rvPostEdit([{ op: 'replace_lines', start: svgLine, end: base + end, text: block }]);
        });
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
          (F.hasCls(cur, 'region') || F.hasCls(cur, 'column') || F.hasCls(cur, 'rv-card') ||
           F.hasCls(cur, 'rv-cell') || F.hasCls(cur, 'rv-layer'))) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function moveSibling(el, dir) {
    var parent = el.parentElement;
    var mine = mappedChildren(parent);
    var i = mine.indexOf(el);
    var target = mine[i + dir];
    if (!target) { F.toast('Already at the ' + (dir < 0 ? 'top' : 'bottom')); return; }
    var container = containerOf(el);
    var cSpan = container ? [F.srcOf(container), F.srcEndOf(container)]
                          : [F.srcOf(el), F.srcEndOf(target)];
    var kindC = container && F.hasCls(container, 'column') ? 'column' : 'col';
    var construct = F.constructOf(el);
    rvPostEdit([{
      op: 'move_block',
      src: [F.srcOf(el), F.srcEndOf(el)],
      construct: RV.MOVABLE[construct] ? construct : 'paragraph',
      dest: {
        insert_before: dir < 0 ? F.srcOf(target) : F.srcEndOf(target) + 1,
        container: cSpan,
        container_kind: kindC,
      },
    }]);
  }

  function deleteSelected(el) {
    var construct = F.constructOf(el);
    if (!el.hasAttribute('data-rv-src') || el.tagName === 'SECTION') {
      F.toast('Select a block inside the slide to delete it');
      return;
    }
    F.toast('Deleted ' + F.kindOf(el) + ' — Ctrl+Z to undo');
    S.sel = null;
    rvPostEdit([{
      op: 'delete_block',
      src: [F.srcOf(el), F.srcEndOf(el)],
      construct: RV.MOVABLE[construct] ? construct : 'paragraph',
    }]);
  }

  /* --- hover kind tag --------------------------------------------------------------------- */

  function hoverTag(ev) {
    var tag = document.getElementById('rv-ed-hovertag');
    if (!S.on || !S.hover || S.hover === S.sel || S.drag) {
      if (tag) tag.style.display = 'none';
      return;
    }
    if (!tag) {
      tag = document.createElement('div');
      tag.id = 'rv-ed-hovertag';
      document.body.appendChild(tag);
    }
    tag.textContent = F.kindOf(S.hover);
    tag.style.display = 'block';
    tag.style.left = (ev.clientX + 14) + 'px';
    tag.style.top = (ev.clientY + 16) + 'px';
  }

  document.addEventListener('mousemove', function (ev) {
    if (S.on) hoverTag(ev);
  }, true);

  buildToolbar();

  var params = new URLSearchParams(location.search);
  if (params.get('rv-test-edit')) {
    // Headless smoke hook: POST the given ops through the real pipeline.
    var testArm = function () {
      setTimeout(function () {
        try { rvPostEdit(JSON.parse(params.get('rv-test-edit'))); }
        catch (e) { F.toast('bad rv-test-edit'); }
      }, 200);
    };
    if (Reveal.isReady && Reveal.isReady()) testArm();
    else Reveal.on('ready', testArm);
  }
  if (params.get('rv-split') === '1') S.splitPref = true;
  if (params.get('rv-edit') === '1') {
    var arm = function () {
      setEdit(true);
      var selParam = params.get('rv-select');
      if (selParam) {
        var slide = Reveal.getCurrentSlide();
        S.sel = slide && (selParam === '1'
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
      if (ev.type === 'reload') { scheduleReload(); }
      else if (ev.type === 'build-error') { showError(ev); }
    };
    // EventSource reconnects on its own; nothing else to do.
  }

  connect();

  /* transitional exports — still-unextracted functions consumed by
     already-extracted modules; each moves out as the split proceeds. */
  F.setEdit = setEdit;
  F.syncChrome = syncChrome;
  F.toggleDrawer = toggleDrawer;
})();
