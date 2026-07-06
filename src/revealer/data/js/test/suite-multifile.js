/* Multi-file suite (P8): editing elements that come from an `> include:`d
 * file. The fixture's main .pres pulls in inc.pres (its own pin on line 2,
 * a plain paragraph on line 6); every edit here must land in inc.pres with
 * inc.pres's own line numbers and sha, leaving the main file untouched —
 * and an include edit chained immediately before a main edit must not 409
 * (per-file freshSha). Drives real deck iframes. Runs first (sorted), so
 * its edits stay line-preserving to keep the fixture stable for later
 * suites. */
(function () {
  'use strict';

  function token() { return (window.__RV_DEV__ || {}).token || ''; }

  // Every source line of a file ("" = the main .pres, else an include path).
  function srcAll(file) {
    var fq = file ? '&file=' + encodeURIComponent(file) : '';
    return RVT.fetch('/__rv__/src?start=1&end=1&token=' + encodeURIComponent(token()) + fq)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        return RVT.fetch('/__rv__/src?start=1&end=' + j.total +
                         '&token=' + encodeURIComponent(token()) + fq)
          .then(function (r) { return r.json(); });
      });
  }

  function findLine(j, needle) {
    var out = null;
    (j.lines || []).forEach(function (ln, i) {
      if (!out && ln.indexOf(needle) !== -1) out = { line: i + 1, text: ln };
    });
    return out;
  }

  // Poll a file's source until pred(j) is truthy (edits land async).
  function pollSrc(file, pred, what) {
    var deadline = Date.now() + 20000;
    function poll() {
      return srcAll(file).then(function (j) {
        var v = pred(j);
        if (v) return v;
        RVT.assert(Date.now() < deadline, 'source never showed ' + what);
        return new Promise(function (res) { setTimeout(res, 250); }).then(poll);
      });
    }
    return poll();
  }

  // Editing the included (last) slide reloads its iframe with a slide-restore
  // key; a stale one would land the NEXT suite's fresh iframe off slide 0.
  // Same-origin sessionStorage is shared, so clearing it here suffices.
  function clearRestore() {
    try { sessionStorage.removeItem('rv-dev-restore'); } catch (e) {}
  }

  function openDeck() {
    return RVT.iframe('/?rv-edit=1', '#rv-ed-toolbar').then(function (f) {
      return RVT.until(function () {
        return f.contentDocument.documentElement.classList.contains('rv-edit')
          ? f : null;
      }, 15000, 'edit mode armed');
    });
  }

  function gotoSlideWith(f, needle) {
    var secs = f.contentDocument.querySelectorAll('.reveal .slides > section');
    var idx = -1;
    for (var i = 0; i < secs.length; i++) {
      if (secs[i].textContent.indexOf(needle) !== -1) { idx = i; break; }
    }
    RVT.assert(idx !== -1, 'deck has a slide containing "' + needle + '"');
    f.contentWindow.Reveal.slide(idx, 0);
    return RVT.until(function () {
      var cur = f.contentWindow.Reveal.getCurrentSlide();
      return cur && cur.textContent.indexOf(needle) !== -1 ? f : null;
    }, 15000, 'current slide contains "' + needle + '"');
  }

  function clickEl(f, el) {
    var r = el.getBoundingClientRect();
    el.dispatchEvent(new f.contentWindow.MouseEvent('click', {
      bubbles: true, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    }));
  }

  RVT.test('included pin: panel names the file and a field edit rewrites inc.pres', function () {
    var f;
    return openDeck().then(function (fr) {
      f = fr;
      return gotoSlideWith(f, 'inc text');
    }).then(function () {
      var pin = f.contentWindow.Reveal.getCurrentSlide().querySelector('.rv-pin');
      RVT.assert(pin && pin.getAttribute('data-rv-f'),
                 'the included pin carries data-rv-f');
      clickEl(f, pin);
      // The breadcrumb sub-line names the owning include, not the main .pres.
      return RVT.until(function () {
        var sub = f.contentDocument.querySelector('#rv-ed-panel .rv-pn-sub');
        return sub && sub.textContent.indexOf('inc.pres') !== -1 ? sub : null;
      }, 15000, 'panel sub-line naming inc.pres');
    }).then(function (sub) {
      RVT.assert(sub.querySelector('.rv-pn-file'),
                 'the owning file renders as a breadcrumb tag');
      // The parameter fields appear once fetchSrc(&file=inc.pres) returns.
      return RVT.until(function () {
        return f.contentDocument.querySelector('#rv-ed-panel .rv-pn-fld input');
      }, 15000, 'pin parameter fields');
    }).then(function (inp) {
      inp.value = '55%';
      inp.dispatchEvent(new f.contentWindow.Event('change', { bubbles: true }));
      return pollSrc('inc.pres', function (j) { return findLine(j, '> pin: 55%'); },
                     'the included pin rewritten to 55% in inc.pres');
    }).then(function () {
      return srcAll('');  // the MAIN file's own pin must be untouched
    }).then(function (j) {
      RVT.assert(findLine(j, '> pin: 40% 40% 20%'),
                 'main pin unchanged: ' + (j.lines || []).join(' | '));
      RVT.assert(!findLine(j, '> pin: 55%'), 'no include pin leaked into the main file');
      f.remove();
      clearRestore();
      return true;
    });
  });

  RVT.test('selection bubble bolds a word in the included plain paragraph', function () {
    var f;
    return openDeck().then(function (fr) {
      f = fr;
      return gotoSlideWith(f, 'plain included paragraph');
    }).then(function () {
      var doc = f.contentDocument;
      var sec = f.contentWindow.Reveal.getCurrentSlide();
      var walker = doc.createTreeWalker(sec, NodeFilter.SHOW_TEXT, null);
      var node, hit = null;
      while ((node = walker.nextNode())) {
        var at = node.nodeValue.indexOf('included');
        if (at !== -1) { hit = { node: node, at: at }; break; }
      }
      RVT.assert(hit, 'found the lowercase word "included" in the paragraph');
      var range = doc.createRange();
      range.setStart(hit.node, hit.at);
      range.setEnd(hit.node, hit.at + 'included'.length);
      var sel = doc.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return RVT.until(function () {
        var el = doc.getElementById('rv-ed-bubble');
        return el && el.style.display !== 'none' ? el : null;
      }, 15000, 'selection bubble on the included paragraph');
    }).then(function (bub) {
      bub.querySelector('button[data-b="**"]').click();
      return pollSrc('inc.pres', function (j) { return findLine(j, '**included**'); },
                     '**included** in inc.pres');
    }).then(function (line) {
      RVT.assert(line.text.indexOf('plain **included** paragraph') !== -1,
                 'wrap landed at the exact columns: ' + line.text);
      return srcAll('');
    }).then(function (j) {
      RVT.assert(!findLine(j, '**included**'),
                 'the main file is untouched by the include edit');
      f.remove();
      clearRestore();
      return true;
    });
  });

  RVT.test('per-file sha: back-to-back include + main edits both land (no cross-file 409)', function () {
    var f;
    return openDeck().then(function (fr) {
      f = fr;
      var doc = f.contentDocument;
      var incPin = doc.querySelector('.rv-pin[data-rv-f]');
      var mainPin = doc.querySelector('.rv-pin:not([data-rv-f])');
      RVT.assert(incPin && mainPin, 'the deck has both an included and a main pin');
      var incLine = parseInt(incPin.getAttribute('data-rv-src'), 10);
      var mainLine = parseInt(mainPin.getAttribute('data-rv-src'), 10);
      var w = f.contentWindow;
      // Post the include edit (runs in-flight at once) then IMMEDIATELY the
      // main edit (queues behind it). Each must open on ITS OWN file's sha:
      // a shared freshSha would 409 the second edit or steer it to the wrong
      // file. Both landing proves freshShaByFile keeps the chains separate.
      w.RV.fn.rvPostEdit([{ op: 'set_pin', line: incLine, x: '11%', y: '22%', w: '10%' }], 'inc.pres');
      w.RV.fn.rvPostEdit([{ op: 'set_pin', line: mainLine, x: '44%', y: '44%', w: '20%' }], '');
      return pollSrc('inc.pres', function (j) { return findLine(j, '> pin: 11% 22%'); },
                     'the included pin at 11% 22%');
    }).then(function () {
      return pollSrc('', function (j) { return findLine(j, '> pin: 44% 44%'); },
                     'the main pin at 44% 44%');
    }).then(function () {
      f.remove();
      clearRestore();
      return true;
    });
  });
})();
