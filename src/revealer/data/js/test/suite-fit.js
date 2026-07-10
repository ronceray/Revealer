/* Fit suite: the content auto-fit must survive adversarial timing.
 *
 * Regression 1: fitSlide ran once, synchronously, in the 'slidechanged'
 * handler, so forward navigation measured the incoming slide mid-transition
 * and left the fonts shrunk. Fixed by re-fitting once layout settles.
 *
 * Regression 2 (the deeper root cause): reveal.css gives every `.fragment`
 * `transition: all .2s ease`, so a `--rv-fontscale` change takes ~200ms to
 * reach the layout. Any fit pass landing while a fragment fade was in flight
 * read stale heights on every probe of its binary search and collapsed the
 * font scale to the 0.2 floor (or false-fitted at 1) — and the bad value
 * stuck, because fragment steps never re-fitted. The fix makes measurements
 * transition-proof and re-fits on fragment events, so no timing collapses. */
(function () {
  'use strict';

  function whenFitReady(f) {
    var win = f.contentWindow;
    return RVT.until(function () {
      return win.Reveal && win.Reveal.isReady && win.Reveal.isReady() &&
             typeof win.fitSlide === 'function' ? f : null;
    }, 15000, 'reveal ready + fitSlide');
  }

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // Index of the "Fit cards" slide (a 2x2 grid of fragment cards).
  function gridSlideIndex(win) {
    var slides = win.document.querySelectorAll('.reveal .slides > section');
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].querySelector('.rv-card.fragment')) return i;
    }
    return -1;
  }

  // Natural content height, same protocol as the runtime's measurement.
  function contentHeight(col) {
    var prev = col.style.justifyContent;
    col.style.justifyContent = 'flex-start';
    var h = col.scrollHeight;
    col.style.justifyContent = prev;
    return h;
  }

  RVT.test('fitSlide re-fits after a forward slidechange', function () {
    return RVT.iframe('/', '.reveal .slides section').then(function (f) {
      var win = f.contentWindow;
      return whenFitReady(f).then(function () {
        win.Reveal.slide(0);
        return wait(300).then(function () {
          // fitSlide is a global; the slidechanged handler resolves it at call
          // time, so wrapping window.fitSlide counts every fit for this change.
          var count = 0, orig = win.fitSlide;
          win.fitSlide = function () { count += 1; return orig.apply(this, arguments); };
          win.Reveal.next();                         // forward to the next slide
          return wait(450).then(function () {
            win.fitSlide = orig;
            RVT.assert(count >= 2,
              'fitSlide should re-fit after the transition settles (got ' + count + ')');
            f.remove();
            return true;
          });
        });
      });
    });
  });

  RVT.test('fragment reveal near the deferred re-fit keeps a sane font scale', function () {
    return RVT.iframe('/', '.reveal .slides section').then(function (f) {
      var win = f.contentWindow;
      return whenFitReady(f).then(function () {
        var idx = gridSlideIndex(win);
        RVT.assert(idx > 0, 'test deck needs a fragment-card grid slide');
        win.Reveal.slide(idx - 1);
        return wait(500).then(function () {          // park; let timers die out
          win.Reveal.next();                         // arm the deferred re-fits
          return wait(230);
        }).then(function () {
          win.Reveal.next();                         // fragment fades in as the
          return wait(800);                          // deferred pass fires
        }).then(function () {
          var col = win.Reveal.getCurrentSlide()
            .querySelector('.multi-column > .column');
          var fs = parseFloat(col.style.getPropertyValue('--rv-fontscale')) || 1;
          var avail = col.clientHeight;
          var h = contentHeight(col);
          RVT.assert(fs > 0.3,
            'font scale collapsed to the floor (' + fs + ')');
          RVT.assert(h <= avail + 4,
            'content overflows after fit (' + h + ' > ' + avail + ' at ' + fs + ')');
          f.remove();
          return true;
        });
      });
    });
  });

  function slideByText(win, needle) {
    var slides = win.document.querySelectorAll('.reveal .slides > section');
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].textContent.indexOf(needle) !== -1) return i;
    }
    return -1;
  }

  RVT.test('fill slides shrink their body to fit', function () {
    return RVT.iframe('/', '.reveal .slides section').then(function (f) {
      var win = f.contentWindow;
      return whenFitReady(f).then(function () {
        var idx = slideByText(win, 'fill body cannot hold');
        RVT.assert(idx > 0, 'deck needs the fill-overflow slide');
        win.Reveal.slide(idx);
        return wait(600);
      }).then(function () {
        var inner = win.Reveal.getCurrentSlide()
          .querySelector('.rv-content-inner');
        var fs = parseFloat(inner.style.getPropertyValue('--rv-fontscale')) || 1;
        RVT.assert(fs < 0.999,
          'fill body must shrink (fontscale=' + fs + ')');
        RVT.assert(contentHeight(inner) <= inner.clientHeight + 4,
          'fill body fits after shrinking');
        f.remove();
        return true;
      });
    });
  });

  RVT.test('content that cannot fit at any scale keeps scale 1', function () {
    return RVT.iframe('/', '.reveal .slides section').then(function (f) {
      var win = f.contentWindow;
      return whenFitReady(f).then(function () {
        var idx = slideByText(win, 'cannot fit the box at any font scale');
        RVT.assert(idx > 0, 'deck needs the unfittable slide');
        win.Reveal.slide(idx);
        return wait(600);
      }).then(function () {
        var col = win.Reveal.getCurrentSlide()
          .querySelector('.multi-column > .column');
        var fs = parseFloat(col.style.getPropertyValue('--rv-fontscale')) || 1;
        RVT.assert(fs === 1,
          'fixed-height overflow keeps legible scale 1, got ' + fs);
        f.remove();
        return true;
      });
    });
  });

  RVT.test('fragment steps trigger a re-fit', function () {
    return RVT.iframe('/', '.reveal .slides section').then(function (f) {
      var win = f.contentWindow;
      return whenFitReady(f).then(function () {
        var idx = gridSlideIndex(win);
        RVT.assert(idx > 0, 'test deck needs a fragment-card grid slide');
        win.Reveal.slide(idx);
        return wait(800).then(function () {          // let navigation fits die out
          var count = 0, orig = win.fitSlide;
          win.fitSlide = function () { count += 1; return orig.apply(this, arguments); };
          win.Reveal.next();                         // reveal the first fragment
          return wait(500).then(function () {
            win.fitSlide = orig;
            RVT.assert(count >= 1,
              'a fragment step must re-fit the slide (got ' + count + ')');
            f.remove();
            return true;
          });
        });
      });
    });
  });
})();
