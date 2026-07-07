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
// Returns the applied font scale (<= 1).
function rv_fitBlock(col, avail) {
  col.style.setProperty('--rv-fontscale', 1);
  if (rv_blockContentHeight(col) <= avail + 0.5) return 1;
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
          return w / Math.sqrt(Math.max(scales[i], 0.05));
        });
        var sum = next.reduce(function (a, b) { return a + b; }, 0);
        weights = next.map(function (w) { return (w / sum) * cols.length; });
      }
      cols.forEach(function (c, i) { c.style.flex = weights[i].toFixed(4) + ' 1 0'; });
    }

    void multi.offsetHeight;
    cols.forEach(function (col) {
      rv_fitBlock(col, col.clientHeight);
    });
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

function revealerApplyFragment(fragment, restore) {
  if (!fragment.classList || !fragment.classList.contains('revealer-svg-anim')) {
    return;
  }

  var duration = fragment.getAttribute('data-svg-duration') || '0.5s';
  var attrs = revealerParseAttrs(fragment.getAttribute('data-svg-attrs'));

  revealerSvgTargets(fragment).forEach(function (el) {
    if (!el._revealerOrig) el._revealerOrig = {};
    if (!el._revealerOrigStyle) el._revealerOrigStyle = {};

    el.style.transition = 'all ' + duration + ' ease';

    attrs.forEach(function (pair) {
      var name = pair[0];
      var value = pair[1];

      // If the element supports the property via style (e.g. opacity), prefer
      // to read/write it on `el.style` so inline `style="opacity:0"` is handled.
      var usesStyle = false;
      try {
        if (el.style && (name in el.style)) usesStyle = true;
      } catch (e) {
        usesStyle = false;
      }

      // Remember the original value the first time we touch this attribute/style.
      if (usesStyle) {
        if (!(name in el._revealerOrigStyle)) {
          el._revealerOrigStyle[name] = el.style.getPropertyValue(name) || null;
        }
      } else {
        if (!(name in el._revealerOrig)) {
          el._revealerOrig[name] = el.getAttribute(name);
        }
      }

      if (restore) {
        if (usesStyle) {
          var origStyle = el._revealerOrigStyle[name];
          if (origStyle === null || origStyle === '') {
            el.style.removeProperty(name);
            el.removeAttribute(name);
          } else {
            el.style.setProperty(name, origStyle);
            el.setAttribute(name, origStyle);
          }
        } else {
          var orig = el._revealerOrig[name];
          if (orig === null) {
            el.removeAttribute(name);
            el.style.removeProperty(name);
          } else {
            el.setAttribute(name, orig);
            el.style.setProperty(name, orig);
          }
        }
      } else {
        try {
          el.style.setProperty(name, value);
        } catch (e) {
        }
        try {
          el.setAttribute(name, value);
        } catch (e) {
        }
      }
    });
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

Reveal.on('slidechanged', function (event) {
  set_fixed(event.currentSlide);
  fitSlide(event.currentSlide);
  if (event.previousSlide) rv_resetVideos(event.previousSlide);
  // Autoplay videos that are visible immediately (not gated behind a fragment).
  rv_videosIn(event.currentSlide).forEach(function (v) {
    if (!(v.closest && v.closest('.fragment'))) {
      try { v.currentTime = 0; var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
  });
});

Reveal.on('fragmentshown', function (event) {
  revealerApplyFragment(event.fragment, false);
  rv_playVideos(event.fragment);
});

Reveal.on('fragmenthidden', function (event) {
  revealerApplyFragment(event.fragment, true);
  rv_resetVideos(event.fragment);
});

Reveal.on('ready', function (event) {
  set_fixed(event.currentSlide);
  fitSlide(event.currentSlide);
  // Re-fit after asynchronous rendering (KaTeX math, web fonts) settles.
  requestAnimationFrame(function () { fitSlide(Reveal.getCurrentSlide()); });
  setTimeout(function () { fitSlide(Reveal.getCurrentSlide()); }, 250);
});

Reveal.on('resize', function () {
  fitSlide(Reveal.getCurrentSlide());
});

window.addEventListener('load', function () {
  fitSlide(Reveal.getCurrentSlide());
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

