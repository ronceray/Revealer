/* Revealer runtime: fixed header/footer + SVG animation driven from .pres */

function set_fixed(slide) {
  // Set slide fixed divs

  var headerHtml = $(slide).children(".slide_header").html() || '';
  var footerHtml = $(slide).children(".slide_footer").html() || '';
  var hideHeader = slide && slide.getAttribute('data-rv-header') === 'none';

  $('header').html(headerHtml).css('display', (hideHeader || !headerHtml) ? 'none' : 'block');
  $('footer').html(footerHtml).css('display', footerHtml ? 'block' : 'none');

  var themeLink = document.getElementById('rv-theme');
  if (themeLink) {
    if (!themeLink.dataset.rvDefaultHref) {
      themeLink.dataset.rvDefaultHref = themeLink.getAttribute('href');
    }
    var slideTheme = slide ? slide.getAttribute('data-rv-theme') : null;
    var baseHref = themeLink.dataset.rvDefaultHref.replace(/[^/]+\.css$/, '');
    themeLink.setAttribute('href', slideTheme ? baseHref + slideTheme + '.css' : themeLink.dataset.rvDefaultHref);
  }

  if ($(slide).hasClass('dark')) {
    $('body').addClass('dark');
    $('header').addClass('dark_fixed');
    $('footer').addClass('dark_fixed');
  } else {
    $('body').removeClass('dark');
    $('header').removeClass('dark_fixed');
    $('footer').removeClass('dark_fixed');
  }
}

/* --- Content fitting ----------------------------------------------------- */
/*
 * Each slide body lives in `.rv-content > .rv-content-inner`. We position the
 * content box inside the area left free by the fixed header / footer (with a
 * light margin on the four edges) and uniformly scale the inner block down so
 * that everything always fits the slide without overflowing or colliding with
 * the header.
 */

// Default geometry (fractions of slide dimensions), overridable per slide via
// data-rv-* attributes emitted by the builder.
var RV_HEADER_MARGIN = 0.05;   // vertical gap header/footer <-> central area
var RV_COLUMN_SPACING = 0.05;  // horizontal edge + inter-block spacing

function rv_slidesElement() {
  return document.querySelector('.reveal .slides');
}

function rv_bandFromTop(el, slidesRect, scale) {
  // Slide-coordinate height occupied by a fixed bar anchored at the top.
  if (!el) return 0;
  if (window.getComputedStyle(el).display === 'none') return 0;
  var r = el.getBoundingClientRect();
  if (r.height === 0) return 0;
  return Math.max(0, (r.bottom - slidesRect.top) / scale);
}

function rv_bandFromBottom(el, slidesRect, scale) {
  // Slide-coordinate height occupied by a fixed bar anchored at the bottom.
  if (!el) return 0;
  if (window.getComputedStyle(el).display === 'none') return 0;
  var r = el.getBoundingClientRect();
  if (r.height === 0) return 0;
  return Math.max(0, (slidesRect.bottom - r.top) / scale);
}

function rv_num(slide, attr, fallback) {
  if (!slide) return fallback;
  var v = parseFloat(slide.getAttribute(attr));
  return isFinite(v) ? v : fallback;
}

// Natural content height of a block in its own coordinates. Measured with the
// content top-aligned so overflow (which would bleed symmetrically when
// centered) is captured reliably.
function rv_blockContentHeight(col) {
  var prev = col.style.justifyContent;
  col.style.justifyContent = 'flex-start';
  var h = col.scrollHeight;
  col.style.justifyContent = prev;
  return h;
}

// Reduce the block font size until its content fits the available height.
// Returns the applied font scale (<= 1), or NaN when the layout does not
// respond to probes (measurement unreliable — the caller schedules a retry).
function rv_fitBlock(col, avail) {
  var prev = parseFloat(col.style.getPropertyValue('--rv-fontscale'));
  col.style.setProperty('--rv-fontscale', 1);
  var full = rv_blockContentHeight(col);
  if (full <= avail + 0.5) return 1;
  // Sanity: a probe must move the measurement before the search can be
  // trusted. A frozen read (in-flight transition, collapsed box...) would
  // otherwise send every probe the same way and the search would return the
  // floor; keep the last applied scale instead of persisting garbage.
  col.style.setProperty('--rv-fontscale', 0.2);
  if (rv_blockContentHeight(col) >= full) {
    col.style.setProperty('--rv-fontscale', isFinite(prev) ? prev : 1);
    return NaN;
  }
  var lo = 0.2, hi = 1;
  for (var i = 0; i < 20; i++) {
    var mid = (lo + hi) / 2;
    col.style.setProperty('--rv-fontscale', mid);
    if (rv_blockContentHeight(col) <= avail + 0.5) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  col.style.setProperty('--rv-fontscale', lo);
  return lo;
}

function fitSlide(slide) {
  if (!slide) return;

  var content = slide.querySelector(':scope > .rv-content');
  if (!content) return;
  var inner = content.querySelector(':scope > .rv-content-inner');
  if (!inner) return;

  var slidesEl = rv_slidesElement();
  if (!slidesEl) return;

  // Measurement guard: while fitting, CSS transitions/animations must not
  // delay layout changes, or every probe below reads a stale height (see the
  // html.rv-measuring rules in the base stylesheet).
  document.documentElement.classList.add('rv-measuring');
  try {
    rv_fitSlideMeasured(slide, content, inner, slidesEl);
  } finally {
    document.documentElement.classList.remove('rv-measuring');
  }

  // Re-fit once media with intrinsic size has loaded (images / videos), since
  // their natural dimensions are unknown before that.
  if (!content._rvMediaBound) {
    content._rvMediaBound = true;
    var media = content.querySelectorAll('img, video');
    media.forEach(function (m) {
      var refit = function () { fitSlide(slide); };
      if (m.tagName === 'IMG') {
        if (!m.complete) m.addEventListener('load', refit);
      } else {
        m.addEventListener('loadedmetadata', refit);
      }
    });
  }
}

function rv_fitSlideMeasured(slide, content, inner, slidesEl) {
  var cfg = Reveal.getConfig();
  var W = cfg.width;
  var H = cfg.height;

  var slidesRect = slidesEl.getBoundingClientRect();
  // The `.slides` element is `H` tall in slide coordinates, so its on-screen
  // height gives the current reveal.js scale factor.
  var scale = slidesRect.height / H;
  if (!isFinite(scale) || scale <= 0) scale = 1;

  // Optional explicit header / footer heights (fraction of slide height).
  var header = document.querySelector('body > header');
  var footer = document.querySelector('body > footer');
  var hlogos = document.getElementById('hlogos');

  var hh = rv_num(slide, 'data-rv-header-height', NaN);
  if (isFinite(hh) && header) header.style.height = (hh * slidesRect.height) + 'px';
  var fh = rv_num(slide, 'data-rv-footer-height', NaN);
  if (isFinite(fh) && footer) footer.style.height = (fh * slidesRect.height) + 'px';

  var topReserve = Math.max(
    rv_bandFromTop(header, slidesRect, scale),
    rv_bandFromTop(hlogos, slidesRect, scale)
  );
  var bottomReserve = rv_bandFromBottom(footer, slidesRect, scale);

  // Vertical breathing margin between header/footer and the central area.
  var headerMargin = rv_num(slide, 'data-rv-header-margin', RV_HEADER_MARGIN);
  var columnSpacing = rv_num(slide, 'data-rv-column-spacing', RV_COLUMN_SPACING);
  var mv = headerMargin * H;

  // The central area spans the full slide width; horizontal spacing between
  // blocks and edges is handled by the `.multi-column` padding / gap.
  var boxLeft = 0;
  var boxTop = topReserve + mv;
  var boxW = Math.max(1, W);
  var boxH = Math.max(1, H - topReserve - bottomReserve - 2 * mv);

  content.style.left = boxLeft + 'px';
  content.style.top = boxTop + 'px';
  content.style.width = boxW + 'px';
  content.style.height = boxH + 'px';

  // The inner wrapper fills the central area exactly (no global scaling); each
  // block scales its own font to fit.
  inner.style.width = boxW + 'px';
  inner.style.height = boxH + 'px';
  inner.style.transform = 'translate(-50%, -50%) scale(1)';

  var multi = inner.querySelector(':scope > .multi-column');
  if (multi) {
    multi.style.setProperty('--rv-column-spacing', (columnSpacing * 100) + '%');
    var cols = Array.prototype.slice.call(
      multi.querySelectorAll(':scope > .column')
    );
    var widthMode = slide.getAttribute('data-rv-column-width') || 'equal';
    var unreliable = false;

    cols.forEach(function (c) { c.style.flex = '1 1 0'; });

    if (widthMode === 'auto' && cols.length > 1) {
      // Reallocate width between blocks so their font scales get balanced:
      // a block that had to shrink more receives a bit more width. Damped and
      // capped so it converges quickly even for image-heavy blocks.
      var weights = cols.map(function () { return 1; });
      for (var it = 0; it < 4; it++) {
        cols.forEach(function (c, i) { c.style.flex = weights[i].toFixed(4) + ' 1 0'; });
        void multi.offsetHeight;
        var scales = cols.map(function (c) { return rv_fitBlock(c, c.clientHeight); });
        var next = weights.map(function (w, i) {
          if (!isFinite(scales[i])) { unreliable = true; return w; }
          return w / Math.sqrt(Math.max(scales[i], 0.05));
        });
        var sum = next.reduce(function (a, b) { return a + b; }, 0);
        weights = next.map(function (w) { return (w / sum) * cols.length; });
      }
      cols.forEach(function (c, i) { c.style.flex = weights[i].toFixed(4) + ' 1 0'; });
    }

    void multi.offsetHeight;
    cols.forEach(function (col) {
      if (!isFinite(rv_fitBlock(col, col.clientHeight))) unreliable = true;
    });

    // A block whose measurements did not respond keeps its previous scale;
    // retry on the next frame (bounded, so a pathological slide cannot loop).
    if (unreliable) {
      var n = (slide._rvFitRetries || 0) + 1;
      if (n <= 3) {
        slide._rvFitRetries = n;
        requestAnimationFrame(function () { fitSlide(slide); });
      }
    } else {
      slide._rvFitRetries = 0;
    }
  }
}

/* --- SVG animation ------------------------------------------------------- */

function revealerSvgTargets(fragment) {
  // Resolve the SVG elements referenced by a fragment's data-svg-target.
  var section = fragment.closest('section');
  if (!section) return [];

  var svg = section.querySelector('.revealer-svg svg');
  if (!svg) return [];

  var selectors = (fragment.getAttribute('data-svg-target') || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length; });

  var elements = [];
  selectors.forEach(function (sel) {
    svg.querySelectorAll(sel).forEach(function (el) { elements.push(el); });
  });
  return elements;
}

function revealerParseAttrs(spec) {
  // "opacity:1; fill:#c00" -> [["opacity","1"], ["fill","#c00"]]
  return (spec || '')
    .split(';')
    .map(function (decl) { return decl.trim(); })
    .filter(function (decl) { return decl.length; })
    .map(function (decl) {
      var i = decl.indexOf(':');
      return [decl.slice(0, i).trim(), decl.slice(i + 1).trim()];
    });
}

/* The SVG animation state is DERIVED, never accumulated: on every relevant
 * event the animated elements are reset to a pristine snapshot and the steps
 * whose fragments are currently `.visible` are re-applied in fragment order.
 * This makes the result independent of HOW a state was reached — linear
 * stepping, stepping back (lands on the previous step's values, pristine at
 * zero), Esc-grid jumps, deep links, and the PDF exporter's force-shown
 * fragments all render the same thing. */

function rv_snapshotSvgProp(el, name) {
  if (!el._rvSvgOrig) el._rvSvgOrig = {};
  if (!(name in el._rvSvgOrig)) {
    el._rvSvgOrig[name] = {
      attr: el.getAttribute(name),
      style: el.style ? el.style.getPropertyValue(name) : '',
    };
  }
}

function rv_resetSvgProps(el) {
  var orig = el._rvSvgOrig;
  if (!orig) return;
  Object.keys(orig).forEach(function (name) {
    if (orig[name].attr === null) el.removeAttribute(name);
    else el.setAttribute(name, orig[name].attr);
    if (el.style) {
      if (orig[name].style) el.style.setProperty(name, orig[name].style);
      else el.style.removeProperty(name);
    }
  });
}

function rv_applySvgStep(fragment) {
  var duration = fragment.getAttribute('data-svg-duration') || '0.5s';
  var attrs = revealerParseAttrs(fragment.getAttribute('data-svg-attrs'));
  revealerSvgTargets(fragment).forEach(function (el) {
    el.style.transition = 'all ' + duration + ' ease';
    attrs.forEach(function (pair) {
      var name = pair[0];
      var value = pair[1];
      rv_snapshotSvgProp(el, name);
      try { el.style.setProperty(name, value); } catch (e) {}
      try { el.setAttribute(name, value); } catch (e) {}
    });
  });
}

// Fragments in presentation order (reveal normalizes data-fragment-index on
// sync, so the attribute is authoritative; DOM order breaks ties).
function rv_fragmentsInOrder(slide) {
  var frags = Array.prototype.slice.call(slide.querySelectorAll('.fragment'));
  return frags
    .map(function (f, i) {
      var idx = parseInt(f.getAttribute('data-fragment-index'), 10);
      return { f: f, idx: isFinite(idx) ? idx : 1e9, dom: i };
    })
    .sort(function (a, b) { return (a.idx - b.idx) || (a.dom - b.dom); })
    .map(function (e) { return e.f; });
}

function rv_syncFragmentEffects(slide) {
  if (!slide) return;
  var frags = rv_fragmentsInOrder(slide);

  // SVG steps: reset every touched element, then replay the visible steps.
  var anims = frags.filter(function (f) {
    return f.classList.contains('revealer-svg-anim');
  });
  if (anims.length) {
    var touched = [];
    anims.forEach(function (f) {
      revealerSvgTargets(f).forEach(function (el) {
        if (touched.indexOf(el) === -1) touched.push(el);
      });
    });
    touched.forEach(rv_resetSvgProps);
    anims.forEach(function (f) {
      if (f.classList.contains('visible')) rv_applySvgStep(f);
    });
  }

  // Fragment-gated videos: play/reset on visibility EDGES only, so a video
  // is not restarted by every later fragment step on the same slide.
  frags.forEach(function (f) {
    var active = f.classList.contains('visible');
    if (active === !!f._rvActive) return;
    f._rvActive = active;
    if (!rv_videosIn(f).length) return;
    if (active) rv_playVideos(f);
    else rv_resetVideos(f);
  });
}

/* --- Video playback tied to slides / fragments --------------------------- */

function rv_videosIn(el) {
  if (!el) return [];
  var vids = [];
  if (el.tagName === 'VIDEO') vids.push(el);
  if (el.querySelectorAll) el.querySelectorAll('video').forEach(function (v) { vids.push(v); });
  return vids;
}

function rv_playVideos(el) {
  rv_videosIn(el).forEach(function (v) {
    try { v.currentTime = 0; var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  });
}

function rv_resetVideos(el) {
  rv_videosIn(el).forEach(function (v) {
    try { v.pause(); v.currentTime = 0; } catch (e) {}
  });
}

/* One entry point for every fit trigger. Each request fits now (so the new
 * state paints correctly), once on the next frame (post-layout), and once
 * after async renderers settle (web fonts, KaTeX, media). Re-arming cancels
 * the pending deferred passes, so a stale timer armed for one slide state can
 * never fire in the middle of another (the old scattered timers did exactly
 * that: a leftover slidechanged pass fired just as a fragment faded in). */
var rv_pendingFit = { raf: 0, settle: 0 };
function rv_queueFit() {
  if (rv_pendingFit.raf) cancelAnimationFrame(rv_pendingFit.raf);
  if (rv_pendingFit.settle) clearTimeout(rv_pendingFit.settle);
  fitSlide(Reveal.getCurrentSlide());
  rv_pendingFit.raf = requestAnimationFrame(function () {
    rv_pendingFit.raf = 0;
    fitSlide(Reveal.getCurrentSlide());
  });
  rv_pendingFit.settle = setTimeout(function () {
    rv_pendingFit.settle = 0;
    fitSlide(Reveal.getCurrentSlide());
  }, 300);
}

Reveal.on('slidechanged', function (event) {
  set_fixed(event.currentSlide);
  rv_syncFragmentEffects(event.currentSlide);
  rv_queueFit();
  if (event.previousSlide) {
    rv_resetVideos(event.previousSlide);
    // Re-arm the edge detection so gated videos replay on a later re-entry.
    event.previousSlide.querySelectorAll('.fragment').forEach(function (f) {
      f._rvActive = false;
    });
  }
  // Autoplay videos that are visible immediately (not gated behind a fragment).
  rv_videosIn(event.currentSlide).forEach(function (v) {
    if (!(v.closest && v.closest('.fragment'))) {
      try { v.currentTime = 0; var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
  });
});

Reveal.on('fragmentshown', function () {
  rv_syncFragmentEffects(Reveal.getCurrentSlide());
  rv_queueFit();
});

Reveal.on('fragmenthidden', function () {
  rv_syncFragmentEffects(Reveal.getCurrentSlide());
  rv_queueFit();
});

/* Fragment visibility can change without any reveal event: `fragments:false`
 * (the PDF exporter's force-shown variant) and Fragments.disable() flip the
 * `.visible` classes silently, and the timing relative to 'ready' is a race.
 * Since the SVG/video effects derive from those classes, observe the classes
 * themselves — every silent flip re-syncs the current slide (coalesced). */
function rv_armFragmentObserver() {
  var slides = rv_slidesElement();
  if (!slides || slides._rvFragObs) return;
  var pending = 0;
  slides._rvFragObs = new MutationObserver(function (muts) {
    if (pending) return;
    for (var i = 0; i < muts.length; i++) {
      var t = muts[i].target;
      if (t.classList && t.classList.contains('fragment')) {
        pending = requestAnimationFrame(function () {
          pending = 0;
          rv_syncFragmentEffects(Reveal.getCurrentSlide());
        });
        return;
      }
    }
  });
  slides._rvFragObs.observe(slides,
    { subtree: true, attributes: true, attributeFilter: ['class'] });
}

Reveal.on('ready', function (event) {
  set_fixed(event.currentSlide);
  rv_armFragmentObserver();
  rv_syncFragmentEffects(event.currentSlide);
  rv_queueFit();
  // Web fonts change text metrics when they land; re-fit once they are in.
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(function () { rv_queueFit(); });
  }
});

Reveal.on('resize', function () {
  rv_queueFit();
});

window.addEventListener('load', function () {
  rv_queueFit();
});

$(document).ready(function () {
  set_fixed(Reveal.getCurrentSlide());
  fitSlide(Reveal.getCurrentSlide());
});


/* --- thumbnail grid overview -------------------------------------------------
   Replaces reveal.js's single-row Esc overview (which is "just a line" for
   horizontal-only decks) with a wrapped grid of live slide thumbnails.
   Enabled by `overview: false` in the deck's Reveal.initialize. Works in the
   served deck AND in exported standalone HTML. */
(function () {
  var GRID_ID = 'rv-grid';
  var isOpen = false;
  var cells = [];   // [{ cell, h, v }]
  var sel = 0;
  var cols = 1;

  function injectStyle() {
    if (document.getElementById('rv-grid-style')) return;
    var css =
      '#rv-grid{position:fixed;inset:0;z-index:100000;overflow:auto;padding:26px;' +
      'background:#12141c;-webkit-font-smoothing:antialiased;}' +
      '#rv-grid .rv-grid-head{color:#c7cde0;font:13px system-ui,sans-serif;' +
      'text-align:center;margin:0 0 16px;}' +
      '#rv-grid .rv-grid-inner{display:grid;gap:18px;max-width:1680px;margin:0 auto;' +
      'grid-template-columns:repeat(auto-fill,minmax(300px,1fr));}' +
      '.rv-grid-cell{all:unset;display:block;cursor:pointer;border-radius:8px;' +
      'overflow:hidden;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.45);' +
      'outline:3px solid transparent;outline-offset:1px;transition:outline-color .1s;}' +
      '.rv-grid-cell:hover{outline-color:#5e9cff;}' +
      '.rv-grid-cell.rv-grid-sel{outline-color:#5e9cff;}' +
      '.rv-grid-cell.rv-grid-cur{outline-color:#2a76dd;}' +
      '.rv-grid-cell.rv-grid-sub .rv-grid-thumb{border-left:4px solid #5e9cff;}' +
      '.rv-grid-thumb{position:relative;width:100%;overflow:hidden;' +
      'background:var(--r-background-color,#fff);}' +
      '.rv-grid-scaler{position:absolute;top:0;left:0;transform-origin:top left;' +
      'pointer-events:none;}' +
      '.rv-grid-label{padding:5px 9px;font:12px system-ui,sans-serif;color:#1c2233;' +
      'background:#eef1f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}';
    var st = document.createElement('style');
    st.id = 'rv-grid-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // All slides, flattened: each vertical sub-slide is its own addressable cell.
  function slideList() {
    var out = [];
    var tops = document.querySelectorAll('.reveal .slides > section');
    Array.prototype.forEach.call(tops, function (top, h) {
      var subs = top.querySelectorAll(':scope > section');
      if (subs.length) {
        Array.prototype.forEach.call(subs, function (sub, v) {
          out.push({ el: sub, h: h, v: v, stack: true });
        });
      } else {
        out.push({ el: top, h: h, v: 0, stack: false });
      }
    });
    return out;
  }

  function titleOf(el) {
    var h = el.querySelector('.slide_header, h1, h2, h3');
    return h ? h.textContent.trim() : '';
  }

  function build() {
    injectStyle();
    var cfg = Reveal.getConfig();
    var W = cfg.width || 960, H = cfg.height || 700;
    var ov = document.createElement('div');
    ov.id = GRID_ID;
    var head = document.createElement('div');
    head.className = 'rv-grid-head';
    head.textContent = 'Slides — click or ←→ then Enter · Esc to close';
    ov.appendChild(head);
    var grid = document.createElement('div');
    grid.className = 'rv-grid-inner';
    var list = slideList();
    var cur = Reveal.getIndices();
    cells = [];
    sel = 0;
    list.forEach(function (s, i) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'rv-grid-cell' + (s.stack ? ' rv-grid-sub' : '');
      var isCur = s.h === cur.h && (s.v || 0) === (cur.v || 0);
      if (isCur) { cell.classList.add('rv-grid-cur'); sel = i; }
      var thumb = document.createElement('div');
      thumb.className = 'rv-grid-thumb';
      thumb.style.aspectRatio = W + ' / ' + H;
      var scaler = document.createElement('div');
      scaler.className = 'rv-grid-scaler';
      scaler.style.width = W + 'px';
      scaler.style.height = H + 'px';
      var clone = s.el.cloneNode(true);
      clone.removeAttribute('hidden');
      clone.classList.add('present');
      clone.style.cssText = 'display:block;position:static;transform:none;' +
        'width:' + W + 'px;height:' + H + 'px;visibility:visible;opacity:1;';
      // static thumbnails: don't let cloned media reload/play
      Array.prototype.forEach.call(clone.querySelectorAll('iframe'), function (f) {
        f.removeAttribute('src');
      });
      Array.prototype.forEach.call(clone.querySelectorAll('video'), function (v) {
        v.removeAttribute('autoplay'); v.pause && v.pause();
      });
      scaler.appendChild(clone);
      thumb.appendChild(scaler);
      cell.appendChild(thumb);
      var label = document.createElement('div');
      label.className = 'rv-grid-label';
      var t = titleOf(s.el);
      label.textContent = (i + 1) + (t ? '. ' + t : '');
      cell.appendChild(label);
      cell.addEventListener('click', function () { go(s.h, s.v); });
      grid.appendChild(cell);
      cells.push({ cell: cell, h: s.h, v: s.v });
    });
    ov.appendChild(grid);
    document.body.appendChild(ov);
    // Scale each clone to its thumbnail width once the grid has laid out.
    requestAnimationFrame(function () {
      cells.forEach(function (c) {
        var thumb = c.cell.querySelector('.rv-grid-thumb');
        var scaler = c.cell.querySelector('.rv-grid-scaler');
        if (thumb && scaler) {
          scaler.style.transform = 'scale(' + (thumb.clientWidth / W) + ')';
        }
      });
      // columns = cells sharing the first row's top offset (for arrow nav)
      if (cells.length) {
        var top0 = cells[0].cell.offsetTop;
        cols = cells.filter(function (c) { return c.cell.offsetTop === top0; }).length || 1;
      }
      markSel();
      if (cells[sel]) cells[sel].cell.scrollIntoView({ block: 'center' });
    });
  }

  function markSel() {
    cells.forEach(function (c, i) {
      c.cell.classList.toggle('rv-grid-sel', i === sel);
    });
  }

  function go(h, v) {
    close();
    Reveal.slide(h, v);
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    build();
  }

  function close() {
    var ov = document.getElementById(GRID_ID);
    if (ov) ov.remove();
    isOpen = false;
    cells = [];
  }

  function toggle() { isOpen ? close() : open(); }

  document.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // In the dev editor's edit mode the editor owns Esc (select-parent) and
    // 'o' (outline); defer entirely while editing and the grid isn't open.
    if (!isOpen && document.documentElement.classList.contains('rv-edit')) return;
    if (ev.key === 'Escape' || ev.key === 'o' || ev.key === 'O') {
      toggle();
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (!isOpen) return;
    var moved = true;
    if (ev.key === 'ArrowRight') sel = Math.min(cells.length - 1, sel + 1);
    else if (ev.key === 'ArrowLeft') sel = Math.max(0, sel - 1);
    else if (ev.key === 'ArrowDown') sel = Math.min(cells.length - 1, sel + cols);
    else if (ev.key === 'ArrowUp') sel = Math.max(0, sel - cols);
    else if (ev.key === 'Enter') { var c = cells[sel]; if (c) go(c.h, c.v); return; }
    else moved = false;
    if (moved) {
      markSel();
      if (cells[sel]) cells[sel].cell.scrollIntoView({ block: 'nearest' });
      ev.preventDefault();
      ev.stopPropagation();
    }
  }, true);

  // Exposed for the JS test harness.
  window.RVGrid = { open: open, close: close, toggle: toggle,
                    isOpen: function () { return isOpen; } };

  // Debug/screenshot hook: ?rv-grid=1 opens the grid once the deck is ready.
  if (/[?&]rv-grid=1/.test(location.search) && window.Reveal && Reveal.on) {
    Reveal.on('ready', function () { setTimeout(open, 300); });
  }
})();

