/* Grid suite: the thumbnail-grid overview lives in the compiled runtime
 * (revealer.js), not the editor, so it is driven through a built-deck iframe.
 * Opens via the RVGrid API and via a real Escape keypress; navigates. */
(function () {
  'use strict';

  // Load the deck (NOT in edit mode) and wait until reveal + the grid API
  // are live inside the iframe.
  function openDeck() {
    return RVT.iframe('/', '.reveal .slides section').then(function (f) {
      return RVT.until(function () {
        var w = f.contentWindow;
        return w.Reveal && w.Reveal.isReady && w.Reveal.isReady() &&
               w.RVGrid ? f : null;
      }, 15000, 'reveal ready + RVGrid');
    });
  }

  function slideCount(f) {
    var doc = f.contentDocument;
    var n = 0;
    doc.querySelectorAll('.reveal .slides > section').forEach(function (top) {
      var subs = top.querySelectorAll(':scope > section');
      n += subs.length ? subs.length : 1;
    });
    return n;
  }

  RVT.test('RVGrid.open renders one cell per slide, click navigates', function () {
    return openDeck().then(function (f) {
      var win = f.contentWindow, doc = f.contentDocument;
      var expected = slideCount(f);
      RVT.assert(expected >= 2, 'deck has multiple slides (' + expected + ')');
      win.RVGrid.open();
      return RVT.until(function () {
        return doc.querySelector('#rv-grid .rv-grid-inner') ? doc : null;
      }, 8000, 'grid overlay').then(function () {
        var cells = doc.querySelectorAll('#rv-grid .rv-grid-cell');
        RVT.assert(cells.length === expected,
          'cells ' + cells.length + ' != slides ' + expected);
        RVT.assert(doc.querySelector('#rv-grid .rv-grid-cur'),
          'current slide is marked');
        RVT.assert(doc.querySelector('#rv-grid .rv-grid-thumb .rv-grid-scaler'),
          'thumbnails carry a scaled clone');
        // click the LAST cell -> navigate there and close
        var last = cells[cells.length - 1];
        last.click();
        return RVT.until(function () {
          return !doc.getElementById('rv-grid') &&
                 win.Reveal.getIndices().h === expected - 1 ? true : null;
        }, 8000, 'navigated to last slide + grid closed').then(function () {
          f.remove();
          return true;
        });
      });
    });
  });

  RVT.test('Escape toggles the grid open and closed', function () {
    return openDeck().then(function (f) {
      var win = f.contentWindow, doc = f.contentDocument;
      function esc() {
        doc.body.dispatchEvent(new win.KeyboardEvent('keydown', {
          key: 'Escape', bubbles: true, cancelable: true,
        }));
      }
      esc();
      return RVT.until(function () {
        return win.RVGrid.isOpen() && doc.getElementById('rv-grid') ? true : null;
      }, 8000, 'grid opened by Escape').then(function () {
        esc();
        return RVT.until(function () {
          return !win.RVGrid.isOpen() && !doc.getElementById('rv-grid') ? true : null;
        }, 8000, 'grid closed by Escape');
      }).then(function () {
        f.remove();
        return true;
      });
    });
  });
})();
