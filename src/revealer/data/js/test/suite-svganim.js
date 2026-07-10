/* SVG animation suite: `> animate:` steps must be a pure function of the
 * visible-fragment set — identical whether reached by forward stepping,
 * stepping back (previous step's values, pristine at zero), or a direct
 * jump / deep link (the old event-driven applier showed the initial state
 * on every non-linear path, and stepping back deleted original attributes).
 */
(function () {
  'use strict';

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function whenReady(f) {
    var win = f.contentWindow;
    return RVT.until(function () {
      return win.Reveal && win.Reveal.isReady && win.Reveal.isReady() ? f : null;
    }, 15000, 'reveal ready');
  }

  function animSlideIndex(win) {
    var slides = win.document.querySelectorAll('.reveal .slides > section');
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].querySelector('.revealer-svg-anim')) return i;
    }
    return -1;
  }

  function dot(win) {
    return win.document.querySelector('.revealer-svg svg #dot');
  }

  RVT.test('svg steps derive from state: jump, step back, pristine restore', function () {
    return RVT.iframe('/', '.reveal .slides section').then(function (f) {
      var win = f.contentWindow;
      return whenReady(f).then(function () {
        var idx = animSlideIndex(win);
        RVT.assert(idx > 0, 'deck needs the animated-SVG slide');

        // Direct jump with BOTH steps visible (deep-link/grid-jump path).
        win.Reveal.slide(idx, 0, 1);
        return wait(150).then(function () {
          var el = dot(win);
          RVT.assert(el.getAttribute('fill') === '#cccc00',
            'jump to step 2: fill should be #cccc00, got ' + el.getAttribute('fill'));
          RVT.assert(el.getAttribute('opacity') === '0.5',
            'jump to step 2: opacity should be 0.5');

          win.Reveal.prev();                       // back to step 1
          return wait(150);
        }).then(function () {
          var el = dot(win);
          RVT.assert(el.getAttribute('fill') === '#00cc00',
            'step back lands on step 1 fill, got ' + el.getAttribute('fill'));
          RVT.assert(el.getAttribute('opacity') === null,
            'step 2 opacity is rolled back to pristine (absent)');

          win.Reveal.prev();                       // back to zero fragments
          return wait(150);
        }).then(function () {
          var el = dot(win);
          RVT.assert(el.getAttribute('fill') === '#cc0000',
            'pristine fill attribute restored, got ' + el.getAttribute('fill'));

          // Leave and re-enter: no residue from the session.
          win.Reveal.slide(0);
          return wait(150).then(function () {
            win.Reveal.slide(idx, 0, 0);
            return wait(150);
          });
        }).then(function () {
          var el = dot(win);
          RVT.assert(el.getAttribute('fill') === '#00cc00',
            're-entry at f=0 shows step 1, got ' + el.getAttribute('fill'));
          f.remove();
          return true;
        });
      });
    });
  });
})();
