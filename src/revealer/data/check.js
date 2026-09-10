/* Layout check probe — the browser half of `revealer check`.
 *
 * The build's warnings are parse-time only: everything that goes wrong at
 * LAYOUT time (a callout overflowing its pinned row onto the figure below, a
 * citation pushed off the bottom edge, a logo strip rendered under the slide)
 * left the build reporting zero warnings, and the only way to find it was to
 * screenshot every slide and read the images.
 *
 * `revealer check` injects this file into a dev build, walks the whole deck in
 * one headless Chrome (fragments forced visible, so every slide is measured in
 * its most crowded state), and leaves the findings base64-encoded in
 * #rv-check-out for the Python side to decode from --dump-dom.
 *
 * Everything here is measured, never inferred: a finding always carries the
 * pixel overflow that produced it. Tolerances are deliberately loose — a noisy
 * check is an ignored check, and the promise is that "no findings" means the
 * deck is presentable. */
(function () {
  'use strict';

  var TOL = 2;                 // slide px of slack before anything is reported
  var CROP_TOL = 0.25;         // a `cover` image may lose a quarter of an axis
  var DEAD_FRACTION = 0.55;    // `> fill` body filling less than this is sparse

  var opts = window.__RV_CHECK_OPTS__ || {};

  function slidesEl() { return document.querySelector('.reveal .slides'); }

  function scale() {
    return (window.Reveal && Reveal.getScale && Reveal.getScale()) || 1;
  }

  // Friendly name for a finding, from the classes the DSL emits.
  var KINDS = [
    ['rv-pin', 'pin'], ['rv-stack', 'stack'], ['rv-layer', 'layer'],
    ['rv-grid-wrap', 'grid'], ['rv-card', 'card'], ['rv-cell', 'card'],
    ['box-info', 'info box'], ['box-warn', 'warn box'], ['box-good', 'good box'],
    ['math-box', 'equation'], ['rv-table-wrap', 'table'],
    ['rv-table-cell', 'table cell'], ['rv-fig', 'figure'],
    ['rv-media-fill', 'media'], ['rv-media', 'media'], ['region', 'column'],
    ['row', 'row'], ['rv-content-inner', 'slide body'], ['rv-paragraph', 'paragraph'],
    ['column', 'text column'], ['slide_header', 'slide title'],
    ['biblio-long', 'bibliography entry'], ['rv-cap', 'caption']
  ];

  function kindOf(el) {
    if (!el || !el.className) return (el && el.tagName || '?').toLowerCase();
    var cls = ' ' + (typeof el.className === 'string' ? el.className : '') + ' ';
    for (var i = 0; i < KINDS.length; i++) {
      if (cls.indexOf(' ' + KINDS[i][0] + ' ') !== -1) return KINDS[i][1];
    }
    if (el.id === 'hlogos') return 'logo strip';
    if (el.tagName === 'HEADER') return 'header band';
    if (el.tagName === 'FOOTER') return 'footer band';
    return el.tagName.toLowerCase();
  }

  // Nearest source annotation at or above `el` (dev builds only).
  function srcOf(el) {
    var n = el;
    while (n && n.nodeType === 1) {
      if (n.hasAttribute && n.hasAttribute('data-rv-src')) {
        return { line: parseInt(n.getAttribute('data-rv-src'), 10),
                 file: n.getAttribute('data-rv-f') || '' };
      }
      n = n.parentElement;
    }
    return null;
  }

  // Anything the author (or the layout) has declared out of scope.
  function ignored(el) {
    return !!(el.closest && el.closest('[data-rv-check="ignore"]'));
  }

  function visible(el) {
    var st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return parseFloat(st.opacity) > 0.01;
  }

  // What of an element actually reaches the screen: its own box, intersected
  // with every ancestor that clips. Without this, anything a parent hides is
  // reported as spilling — KaTeX's off-screen MathML (a 1px clipped box
  // holding a full-size formula) fires on every equation in the deck.
  function paintedRect(el) {
    var r = el.getBoundingClientRect();
    var top = r.top, left = r.left, bottom = r.bottom, right = r.right;
    var n = el.parentElement;
    while (n && n.nodeType === 1) {
      var st = window.getComputedStyle(n);
      if (st.overflow !== 'visible' || (st.clip && st.clip !== 'auto') ||
          (st.clipPath && st.clipPath !== 'none')) {
        var p = n.getBoundingClientRect();
        top = Math.max(top, p.top);
        left = Math.max(left, p.left);
        bottom = Math.min(bottom, p.bottom);
        right = Math.min(right, p.right);
      }
      n = n.parentElement;
    }
    return { top: top, left: left, bottom: bottom, right: right,
             width: right - left, height: bottom - top };
  }

  // Measure with pins hidden. `> pin:` is an absolute overlay the author
  // placed on purpose; it still counts in scrollHeight, so a pin near the
  // bottom edge makes its whole slide look like it overflows. A pin that
  // lands off the slide gets its own finding — one per cause.
  function withoutPins(el, fn) {
    var pins = el.querySelectorAll ? el.querySelectorAll('.rv-pin') : [];
    if (!pins.length) return fn();
    var prev = [];
    Array.prototype.forEach.call(pins, function (pin) {
      prev.push(pin.style.display);
      pin.style.display = 'none';
    });
    try {
      return fn();
    } finally {
      Array.prototype.forEach.call(pins, function (pin, i) {
        pin.style.display = prev[i];
      });
    }
  }

  function ownOverflow(el) {
    return withoutPins(el, function () { return el.scrollHeight - el.clientHeight; });
  }

  function text(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }

  function snippet(el) {
    var t = text(el);
    return t.length > 48 ? t.slice(0, 45) + '…' : t;
  }

  /* --- the checks ---------------------------------------------------------- */

  function checkSlide() {
    var sec = Reveal.getCurrentSlide();
    if (!sec) return [];
    var sc = scale();
    var canvas = slidesEl().getBoundingClientRect();
    var found = [];
    var seen = [];          // offending elements, to report only the outermost

    function add(kind, el, message, px) {
      var src = srcOf(el);
      found.push({
        kind: kind,
        element: kindOf(el),
        message: message,
        px: Math.round(px),
        line: src ? src.line : null,
        file: src ? src.file : '',
        text: snippet(el)
      });
    }

    // 1. The fit engine gave up: the block needs a deeper shrink than the
    //    `fit-floor` allows, so it is painted overflowing at full size.
    Array.prototype.forEach.call(sec.querySelectorAll('[data-rv-overflow]'), function (el) {
      var px = parseInt(el.getAttribute('data-rv-overflow'), 10) || 0;
      if (px <= TOL) return;
      if (ownOverflow(el) <= TOL) return;      // the pins alone made it overflow
      add('overflow', el,
          'content is ' + Math.round(px) + 'px taller than its box even at full size ' +
          '— split the slide, or raise `> fit-floor:` to let it shrink further', px);
    });

    // 2. A clipping box whose content does not fit it (the callout that lands
    //    on the figure below, the body that pushes its citation line off).
    var boxes = sec.querySelectorAll(
      '.rv-content-inner, .region, .rv-card, .rv-cell, .box-info, .box-warn, ' +
      '.box-good, .math-box, .rv-layer, .rv-table-cell');
    Array.prototype.forEach.call(boxes, function (el) {
      if (ignored(el) || !visible(el)) return;
      if (el.hasAttribute('data-rv-overflow')) return;      // already reported
      if (!el.clientHeight) return;
      var over = ownOverflow(el);
      if (over <= TOL) return;
      add('overflow', el,
          kindOf(el) + ' overflows its box by ' + Math.round(over) + 'px', over);
      seen.push(el);
    });

    // 3. Anything painted outside the slide canvas: it is simply not on the
    //    screen the audience sees.
    var all = sec.querySelectorAll('*');
    var offenders = [];
    Array.prototype.forEach.call(all, function (el) {
      if (ignored(el) || !visible(el)) return;
      if (!el.getBoundingClientRect) return;
      if (!text(el) && !el.querySelector('img,video,svg,canvas') &&
          !/^(IMG|VIDEO|SVG|CANVAS)$/.test(el.tagName)) return;
      var r = paintedRect(el);
      if (r.width < 1 || r.height < 1) return;   // clipped away: nothing to see
      var out = Math.max(canvas.top - r.top, r.bottom - canvas.bottom,
                         canvas.left - r.left, r.right - canvas.right);
      if (out / sc <= TOL) return;
      offenders.push({ el: el, px: out / sc });
    });
    // Only the outermost element of a nesting chain: the children spill
    // because it does, and one finding per cause is the whole point.
    offenders.filter(function (o) {
      return !offenders.some(function (p) {
        return p.el !== o.el && p.el.contains(o.el);
      });
    }).forEach(function (o) {
      add('offslide', o.el,
          kindOf(o.el) + ' is painted ' + Math.round(o.px) + 'px outside the slide',
          o.px);
    });

    // 4. A `cover` image showing less than three quarters of an axis: the
    //    crop is silently eating labels or data.
    Array.prototype.forEach.call(sec.querySelectorAll('img, video'), function (el) {
      if (ignored(el) || !visible(el)) return;
      var fit = window.getComputedStyle(el).objectFit;
      if (fit !== 'cover') return;
      var nw = el.naturalWidth || el.videoWidth || 0;
      var nh = el.naturalHeight || el.videoHeight || 0;
      var r = el.getBoundingClientRect();
      if (!nw || !nh || r.width < 1 || r.height < 1) return;
      var shown = Math.min((r.width / r.height) / (nw / nh),
                           (nw / nh) / (r.width / r.height));
      if (shown >= 1 - CROP_TOL) return;
      add('crop', el,
          'cover crops this media to ' + Math.round(shown * 100) +
          '% of one axis — use `contain`, or crop the source', (1 - shown) * 100);
    });

    // 5. A column that renders nothing: usually a stray marker, and always a
    //    hole in the layout.
    Array.prototype.forEach.call(sec.querySelectorAll('.region, .rv-card, .rv-cell'), function (el) {
      if (ignored(el) || !visible(el)) return;
      if (text(el) || el.querySelector('img,video,svg,canvas,iframe')) return;
      var r = el.getBoundingClientRect();
      if (r.width / sc < 20 || r.height / sc < 20) return;   // a spacer, not a hole
      add('empty', el, kindOf(el) + ' renders nothing', r.width / sc);
    });

    // 6. Dead space (opt-in): a `> fill` slide whose body uses little of it.
    if (opts.deadSpace && sec.classList.contains('rv-fill')) {
      var inner = sec.querySelector('.rv-content-inner');
      if (inner && inner.clientHeight) {
        var used = 0;
        Array.prototype.forEach.call(inner.children, function (c) {
          var cr = c.getBoundingClientRect();
          if (cr.height > 1) used += cr.height;
        });
        var frac = used / inner.getBoundingClientRect().height;
        if (frac < DEAD_FRACTION) {
          add('sparse', inner,
              'the body fills only ' + Math.round(frac * 100) +
              '% of the slide — `> fill center` / `between`, or merge slides',
              (1 - frac) * 100);
        }
      }
    }

    return found;
  }

  // The header / footer bands are positioned against the WINDOW, not the
  // slide canvas (the fit engine reserves their height out of the body), so
  // they are measured against the window: a logo strip rendered past the
  // bottom edge is cut off for the audience, and that is the finding.
  function checkBands() {
    var out = [];
    ['header', 'footer', '#hlogos'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el || !visible(el) || ignored(el)) return;
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      if (!text(el) && !el.querySelector('img,svg')) return;
      var over = Math.max(-r.top, r.bottom - window.innerHeight,
                          -r.left, r.right - window.innerWidth);
      if (over <= TOL) return;
      out.push({ kind: 'offslide', element: kindOf(el), line: null, file: '',
                 text: snippet(el), px: Math.round(over),
                 message: kindOf(el) + ' is cut off by the window edge (' +
                          Math.round(over) + 'px outside)' });
    });
    return out;
  }

  /* --- the walk ------------------------------------------------------------ */

  function routes() {
    var out = [];
    var tops = document.querySelectorAll('.reveal .slides > section');
    Array.prototype.forEach.call(tops, function (sec, h) {
      var subs = sec.querySelectorAll(':scope > section');
      if (subs.length) {
        Array.prototype.forEach.call(subs, function (_s, v) { out.push([h, v]); });
      } else {
        out.push([h, 0]);
      }
    });
    return out;
  }

  // Give the fit engine its deferred passes (it re-fits on the next frame and
  // again 300ms later, for async renderers like web fonts and KaTeX) before
  // measuring. Timers only, deliberately: a headless page that has gone idle
  // produces no compositor frames, so requestAnimationFrame never fires and a
  // walk that waited on it would hang forever. Under virtual time these waits
  // cost almost no wall-clock, and the engine's synchronous pass has already
  // run on the slidechanged event.
  function settle() {
    return new Promise(function (res) { setTimeout(res, 450); });
  }

  function ready() {
    return new Promise(function (res) {
      var done = function () {
        (document.fonts ? document.fonts.ready : Promise.resolve()).then(res, res);
      };
      if (window.Reveal && Reveal.isReady && Reveal.isReady()) done();
      else if (window.Reveal && Reveal.on) Reveal.on('ready', done);
      else setTimeout(done, 1000);
    });
  }

  function emit(payload) {
    var box = document.createElement('div');
    box.id = 'rv-check-out';
    // base64 so the JSON survives DOM serialization intact, UTF-8 safe.
    box.setAttribute('data-json', btoa(unescape(encodeURIComponent(
      JSON.stringify(payload)))));
    document.body.appendChild(box);
    window.__RV_CHECK_DONE__ = true;
  }

  // The same measurements, per slide, for the dev editor (it badges the
  // current slide live rather than walking the deck).
  window.__RV_CHECK__ = {
    slide: function () {
      try {
        return (window.Reveal && Reveal.getCurrentSlide()) ? checkSlide() : [];
      } catch (e) {
        return [];
      }
    },
    bands: checkBands
  };

  if (opts.walk === false) return;      // editor mode: no deck walk, no emit

  ready().then(function () {
    var list = routes();
    var slides = [];
    var chain = Promise.resolve();
    list.forEach(function (r) {
      chain = chain.then(function () {
        Reveal.slide(r[0], r[1]);
        return settle().then(function () {
          var sec = Reveal.getCurrentSlide();
          var title = sec && sec.querySelector('.slide_header');
          slides.push({
            h: r[0], v: r[1],
            index: r[1] ? r[0] + '/' + r[1] : String(r[0]),
            title: title ? text(title) : '',
            line: sec && sec.getAttribute('data-rv-src')
              ? parseInt(sec.getAttribute('data-rv-src'), 10) : null,
            file: (sec && sec.getAttribute('data-rv-f')) || '',
            findings: checkSlide()
          });
        });
      });
    });
    return chain.then(function () {
      emit({ ok: true, slides: slides, bands: checkBands() });
    });
  }).catch(function (e) {
    emit({ ok: false, error: String(e && e.message || e) });
  });
})();
