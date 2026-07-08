/* Outline suite: the slide outline sidebar — rows and the current marker,
 * row-click navigation, and the structural slide actions (add / move)
 * running against the real server and real edits. Mutating tests locate
 * the `=== ` slide markers dynamically, so they are independent of the
 * deck state earlier suites (or earlier tests here) leave behind. */
(function () {
  'use strict';

  function token() { return (window.__RV_DEV__ || {}).token || ''; }

  function srcAll() {
    return RVT.fetch('/__rv__/src?start=1&end=1&token=' + encodeURIComponent(token()))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        return RVT.fetch('/__rv__/src?start=1&end=' + j.total +
                         '&token=' + encodeURIComponent(token()))
          .then(function (r) { return r.json(); });
      });
  }

  function slideMarks(j) {
    var out = [];
    (j.lines || []).forEach(function (ln, i) {
      if (/^=== /.test(ln)) out.push({ line: i + 1, text: ln });
    });
    return out;
  }

  // The served deck lags the source while the post-edit rebuild runs;
  // resolve once the built page's sha matches the source, so a fresh
  // iframe never opens on a stale deck (whose spans would be wrong).
  function untilBuilt() {
    var deadline = Date.now() + 20000;
    function tick() {
      return srcAll().then(function (j) {
        return RVT.fetch('/').then(function (r) { return r.text(); }).then(function (t) {
          var m = t.match(/name="rv-src-sha" content="([0-9a-f]+)"/);
          if (m && m[1] === j.sha256) return j;
          RVT.assert(Date.now() < deadline, 'deck rebuild never caught up with the source');
          return new Promise(function (res) { setTimeout(res, 250); }).then(tick);
        });
      });
    }
    return tick();
  }

  function openOutline() {
    return untilBuilt().then(function () {
      return RVT.iframe('/?rv-edit=1', '#rv-ed-toolbar');
    }).then(function (f) {
      f.contentDocument.querySelector('.rv-tb-slide').click();
      return RVT.until(function () {
        return f.contentDocument.querySelector('#rv-ed-outline .rv-ol-item') ? f : null;
      }, 15000, 'outline rows');
    });
  }

  RVT.test('outline opens from the toolbar: rows, numbers, current marker', function () {
    return openOutline().then(function (f) {
      var doc = f.contentDocument;
      var secs = doc.querySelectorAll('.reveal .slides > section').length;
      var items = doc.querySelectorAll('#rv-ed-outline .rv-ol-item');
      RVT.assert(doc.querySelector('#rv-ed-outline .rv-box-head'), 'factory header');
      RVT.assert(items.length >= 2, 'fixture deck has at least two slides');
      RVT.assert(items.length === secs, 'one row per top-level slide');
      RVT.assert(items[0].querySelector('.rv-ol-num').textContent === '1', 'row 1 numbered');
      // this suite runs first (sorted order), so the fixture is pristine
      RVT.assert(items[0].querySelector('.rv-ol-title').textContent.trim() === 'One',
                 'row 1 shows the slide title');
      RVT.assert(items[1].querySelector('.rv-ol-title').textContent.trim() === 'Two',
                 'row 2 shows the slide title');
      RVT.assert(items[0].classList.contains('rv-ol-current'), 'first row is current');
      RVT.assert(items[0].querySelector('button[data-act="up"]').disabled,
                 'first mapped row has ↑ disabled');
      // The fixture ends with an `> include:`d slide (navigate-only, no move
      // buttons — P8): the last MOVABLE row is the one before it, and its ↓
      // is disabled (can't move down into / past the included neighbour).
      var movable = Array.prototype.filter.call(items, function (it) {
        return it.querySelector('button[data-act="down"]');
      });
      RVT.assert(movable.length &&
                 movable[movable.length - 1].querySelector('button[data-act="down"]').disabled,
                 'last movable row has ↓ disabled');
      RVT.assert(items[items.length - 1].querySelector('.rv-ol-inc'),
                 'the included slide is a navigate-only row');
      // second toolbar click closes it (toggle-by-remove preserved)
      doc.querySelector('.rv-tb-slide').click();
      RVT.assert(!doc.getElementById('rv-ed-outline'), 'toggles closed');
      f.remove();
      return true;
    });
  });

  RVT.test('clicking a row navigates and moves the current marker', function () {
    return openOutline().then(function (f) {
      f.contentDocument.querySelectorAll('#rv-ed-outline .rv-ol-item')[1].click();
      return RVT.until(function () {
        return f.contentWindow.Reveal.getIndices().h === 1;
      }, 15000, 'Reveal on slide 2').then(function () {
        return RVT.until(function () {
          var items = f.contentDocument.querySelectorAll('#rv-ed-outline .rv-ol-item');
          return items[1] && items[1].classList.contains('rv-ol-current');
        }, 15000, 'current marker on row 2');
      }).then(function () {
        f.remove();
        return true;
      });
    });
  });

  RVT.test('add-after opens the gallery; a picked template lands after the first slide', function () {
    var n0;
    return srcAll().then(function (j) {
      n0 = slideMarks(j).length;
      return openOutline();
    }).then(function (f) {
      var doc = f.contentDocument;
      doc.querySelector('#rv-ed-outline .rv-ol-item button[data-act="add"]').click();
      return RVT.until(function () {
        return doc.querySelector('#rv-ed-templates .rv-tpl-card[data-id="content"]');
      }, 10000, 'template gallery to open').then(function (card) {
        card.click();                                  // pick the "content" template
        var deadline = Date.now() + 20000;
        function poll() {
          return srcAll().then(function (j) {
            var marks = slideMarks(j);
            if (marks.length === n0 + 1 && marks[1].text === '=== Title') return true;
            RVT.assert(Date.now() < deadline,
                       'expected "=== Title" as the second marker, have: ' +
                       marks.map(function (m) { return m.text; }).join(' | '));
            return new Promise(function (res) { setTimeout(res, 250); }).then(poll);
          });
        }
        return poll().then(function () { f.remove(); return true; });
      });
    });
  });

  // Clicks ↓ on row 1 in a fresh outline and polls the source until the
  // first slide markers read as `want` (a list of marker texts).
  function moveDownFirstRowUntil(want) {
    return openOutline().then(function (f) {
      f.contentDocument.querySelector('#rv-ed-outline .rv-ol-item button[data-act="down"]')
        .click();
      var deadline = Date.now() + 20000;
      function poll() {
        return srcAll().then(function (j) {
          var got = slideMarks(j).map(function (m) { return m.text; });
          if (got.length === want.length &&
              got.join('\n') === want.join('\n')) return true;
          RVT.assert(Date.now() < deadline,
                     'expected markers [' + want.join(' | ') + '], have: ' +
                     got.join(' | '));
          return new Promise(function (res) { setTimeout(res, 250); }).then(poll);
        });
      }
      return poll().then(function () {
        f.remove();
        return true;
      });
    });
  }

  RVT.test('move ↓ on row 1 swaps the first two slides in the source (and back)', function () {
    var before;
    return srcAll().then(function (j) {
      before = slideMarks(j).map(function (m) { return m.text; });
      RVT.assert(before.length >= 2, 'needs at least two slides');
      var swapped = [before[1], before[0]].concat(before.slice(2));
      return moveDownFirstRowUntil(swapped).then(function () {
        // swap back: later suites expect the fixture's first slide (its
        // pin lives there) to be the deck's current slide again.
        return moveDownFirstRowUntil(before);
      });
    });
  });
})();
