/* outline: the slide outline sidebar — list top-level slides, navigate, add/duplicate/move/delete */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var F = RV.fn;

  /* --- slide outline ------------------------------------------------------ */

  function topSections() {
    return Array.prototype.slice.call(
      document.querySelectorAll('.reveal .slides > section'));
  }

  function innerSections(sec) {
    return Array.prototype.filter.call(sec.children, function (c) {
      return c.tagName === 'SECTION';
    });
  }

  function titleOf(sec, i) {
    // Regular slides carry their title in .slide_header; title and section
    // slides use h1/h2 (h3 covers raw-HTML slides).
    var h = sec.querySelector('.slide_header,h1,h2,h3');
    var t = h && h.textContent ? h.textContent.trim() : '';
    return t || 'Slide ' + (i + 1);
  }

  // The element carrying the slide's provenance: the top-level section
  // itself or, for a vertical stack, its first mapped inner section.
  function anchorOf(sec) {
    if (sec.hasAttribute('data-rv-src')) return sec;
    var inner = innerSections(sec);
    for (var i = 0; i < inner.length; i++) {
      if (inner[i].hasAttribute('data-rv-src')) return inner[i];
    }
    return null;
  }

  // Included slides carry data-rv-f / data-rv-inc: their spans are file-local
  // to an include, so deck-level move/delete/insert (which post main-file
  // ops) would corrupt the wrong file. v1 shows them navigate-only (P8).
  function isInc(sec) {
    var a = anchorOf(sec) || sec;
    return !!(sec.hasAttribute('data-rv-inc') ||
              (a && (a.hasAttribute('data-rv-f') || a.hasAttribute('data-rv-inc'))));
  }

  // {s, e} source span of a top-level slide (stacks span all children),
  // or null when the slide carries no provenance (raw HTML).
  function spanOf(sec) {
    var a = anchorOf(sec);
    if (!a) return null;
    var s = parseInt(a.getAttribute('data-rv-src'), 10);
    var e = null;
    var inner = innerSections(sec);
    if (inner.length) {
      var last = inner[inner.length - 1];
      if (last.hasAttribute('data-rv-src-end')) {
        e = parseInt(last.getAttribute('data-rv-src-end'), 10);
      }
    }
    if (e === null) {
      var own = sec.getAttribute('data-rv-src-end');
      e = own ? parseInt(own, 10) : s;
    }
    return { s: s, e: e };
  }

  function toggleOutline() {
    var w = RV.ui.box({ id: 'rv-ed-outline', title: RV.t('outline.title') });
    if (!w) return;
    w.body.innerHTML = '<div class="rv-ol-list"></div>';
    renderOutline();
  }

  function renderOutline() {
    var box = document.getElementById('rv-ed-outline');
    if (!box) return;
    var list = box.querySelector('.rv-ol-list');
    list.innerHTML = '';
    var cur = (window.Reveal && Reveal.getIndices) ? Reveal.getIndices().h : -1;
    var secs = topSections();
    secs.forEach(function (sec, i) {
      var span = spanOf(sec);
      var kids = innerSections(sec).length;
      var row = document.createElement('div');
      row.className = 'rv-ol-item' + (i === cur ? ' rv-ol-current' : '');
      var html = '<div class="rv-ol-head"><span class="rv-ol-num">' + (i + 1) + '</span>' +
        '<span class="rv-ol-title">' + RV.esc(titleOf(sec, i)) +
        (kids ? ' <span class="rv-ol-kids">▤ ' + kids + '</span>' : '') +
        '</span></div>';
      if (span && isInc(sec)) {
        html += '<span class="rv-ol-unmapped rv-ol-inc">' + RV.esc(RV.t('outline.included')) + '</span>';
      } else if (span) {
        // Cross-file moves are out of scope for v1: a swap with an included
        // neighbour would post file-local line numbers against the main file.
        var canUp = i > 0 && !!spanOf(secs[i - 1]) && !isInc(secs[i - 1]);
        var canDown = i < secs.length - 1 && !!spanOf(secs[i + 1]) && !isInc(secs[i + 1]);
        html += '<span class="rv-ol-acts">' +
          '<button data-act="add" title="' + RV.esc(RV.t('outline.addTitle')) + '">＋</button>' +
          '<button data-act="dup" title="' + RV.esc(RV.t('outline.dupTitle')) + '">⧉</button>' +
          '<button data-act="up" title="' + RV.esc(RV.t('outline.upTitle')) + '"' + (canUp ? '' : ' disabled') + '>↑</button>' +
          '<button data-act="down" title="' + RV.esc(RV.t('outline.downTitle')) + '"' + (canDown ? '' : ' disabled') + '>↓</button>' +
          '<button data-act="del" title="' + RV.esc(RV.t('outline.delTitle')) + '">🗑</button>' +
          '</span>';
      } else {
        html += '<span class="rv-ol-unmapped">' + RV.esc(RV.t('outline.unmapped')) + '</span>';
      }
      row.innerHTML = html;
      row.addEventListener('click', function () {
        Reveal.slide(i);
        renderOutline();
      });
      row.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          doAction(b.getAttribute('data-act'), secs, i);
        });
      });
      list.appendChild(row);
    });
    if (!secs.length) list.innerHTML = '<div class="rv-ol-item">' + RV.esc(RV.t('outline.none')) + '</div>';
  }

  /* All actions go through F.rvPostEdit (sha/queue/toasts); the rebuild's
     SSE reload re-renders everything, so nothing mutates the DOM here. */
  function doAction(act, secs, i) {
    var span = spanOf(secs[i]);
    if (!span || isInc(secs[i])) return;  // included slides are navigate-only
    if (act === 'add') {
      F.openTemplateGallery(span, F.fileOf ? F.fileOf(secs[i]) : '');
    } else if (act === 'dup') {
      F.fetchSrc(span.s, span.e, function (j) {
        F.rvPostEdit([{ op: 'insert_lines',
          at: { insert_before: span.e + 1, container_kind: 'deck' },
          text: [''].concat(j.lines || []) }]);
      }, '', 'outline');
    } else if (act === 'up') {
      var prev = spanOf(secs[i - 1]);
      if (!prev || isInc(secs[i - 1])) return;
      F.rvPostEdit([{ op: 'move_block', construct: 'slide',
        src: [span.s, span.e],
        dest: { insert_before: prev.s, container_kind: 'deck' } }]);
    } else if (act === 'down') {
      // Moving the NEXT slide before this one swaps the pair (same effect,
      // simpler math: this slide's span is untouched by the deletion).
      var next = spanOf(secs[i + 1]);
      if (!next || isInc(secs[i + 1])) return;
      F.rvPostEdit([{ op: 'move_block', construct: 'slide',
        src: [next.s, next.e],
        dest: { insert_before: span.s, container_kind: 'deck' } }]);
    } else if (act === 'del') {
      F.rvPostEdit([{ op: 'delete_block', construct: 'slide',
        src: [span.s, span.e] }]);
    }
  }

  if (window.Reveal && Reveal.on) {
    Reveal.on('slidechanged', function () {
      if (document.getElementById('rv-ed-outline')) renderOutline();
    });
  }

  // The source span of the current top-level slide (for the Slide ▸ New slide menu).
  function currentSlideSpan() {
    var h = (window.Reveal && Reveal.getIndices) ? Reveal.getIndices().h : 0;
    var sec = topSections()[h];
    if (!sec || isInc(sec)) return null;   // included slides are navigate-only (P8)
    return spanOf(sec);
  }

  // exports (what other editor/ modules call):
  F.toggleOutline = toggleOutline;
  F.currentSlideSpan = currentSlideSpan;
})();
