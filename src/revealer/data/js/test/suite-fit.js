/* Fit suite: the content auto-fit must re-run after a forward slidechange.
 * Regression: fitSlide ran once, synchronously, in the 'slidechanged' handler,
 * so forward navigation measured the incoming slide mid-transition (a transient,
 * over-tall layout) and left the fonts shrunk — while backward navigation, which
 * lands on an already-laid-out slide, rendered fine. The fix re-fits once layout
 * settles (rAF + a short timeout), mirroring the 'ready' handler. */
(function () {
  'use strict';

  RVT.test('fitSlide re-fits after a forward slidechange', function () {
    return RVT.iframe('/', '.reveal .slides section').then(function (f) {
      var win = f.contentWindow;
      return RVT.until(function () {
        return win.Reveal && win.Reveal.isReady && win.Reveal.isReady() &&
               typeof win.fitSlide === 'function' ? f : null;
      }, 15000, 'reveal ready + fitSlide').then(function () {
        win.Reveal.slide(0);
        return new Promise(function (r) { setTimeout(r, 300); }).then(function () {
          // fitSlide is a global; the slidechanged handler resolves it at call
          // time, so wrapping window.fitSlide counts every fit for this change.
          var count = 0, orig = win.fitSlide;
          win.fitSlide = function () { count += 1; return orig.apply(this, arguments); };
          win.Reveal.next();                         // forward to the next slide
          return new Promise(function (r) { setTimeout(r, 450); }).then(function () {
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
})();
