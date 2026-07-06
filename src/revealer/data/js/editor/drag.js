/* drag: selection grips, the drag state machine (pin/media/row/stack/col-split/block-move), snap fractions, keyboard nudges */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;

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
    var el = F.layer();
    el.querySelectorAll('.rv-ed-grip, .rv-ed-dragzone').forEach(function (g) { g.remove(); });
  }

  function rvRenderHandles() {
    clearHandles();
    if (!S.on || !S.sel || !document.contains(S.sel) || S.drag) return;
    var host = F.layer();
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
    if (kind === 'block-move') F.buildDropTargets(el);
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
      F.moveGhost(ev);
      F.pickDropSlot(ev);
    }
    F.syncChrome();
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
      F.rvPostEdit([op]);
    } else if (d.kind === 'media-size') {
      var target = el.tagName === 'FIGURE' ? el.querySelector('img,video') : el;
      var hpx = Math.round(target.getBoundingClientRect().height / d.scale);
      F.rvPostEdit([{ op: 'set_media_size', line: line, dim: 'h', value: hpx + 'px' }]);
    } else if (d.kind === 'row-height' || d.kind === 'stack-height') {
      var hh = Math.round(el.getBoundingClientRect().height / d.scale);
      F.rvPostEdit([{ op: (d.kind === 'row-height' ? 'set_row_height' : 'set_stack_height'),
                    line: line, value: hh }]);
    } else if (d.kind === 'col-split') {
      commitColSplit(d);
    } else if (d.kind === 'block-move') {
      F.commitBlockMove(d, ev);
    }
    F.syncChrome();
    F.maybeReload();
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
    F.rvPostEdit([
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
        F.rvPostEdit([op]);
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
        F.rvPostEdit([kind === 'media'
          ? { op: 'set_media_size', line: F.srcOf(el), dim: 'h', value: hpx + 'px' }
          : { op: (kind === 'row' ? 'set_row_height' : 'set_stack_height'), line: F.srcOf(el), value: hpx }]);
      });
    }
    F.syncChrome();
  }

  // exports (what other editor/ modules call):
  F.rvRenderHandles = rvRenderHandles;
  F.flushNudge = flushNudge;
  F.nudgeSelected = nudgeSelected;
  RV.NUDGE_ARROWS = NUDGE_ARROWS;
})();
