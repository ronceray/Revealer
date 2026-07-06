/* Textsel suite: the selection bubble (DOM selection -> wrap_span) and
 * in-place paragraph editing. Drives real deck iframes; line numbers are
 * looked up in the live source (earlier suites mutate the deck). */
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

  function findLine(j, needle) {
    var out = null;
    (j.lines || []).forEach(function (ln, i) {
      if (!out && ln.indexOf(needle) !== -1) out = { line: i + 1, text: ln };
    });
    return out;
  }

  // Poll the source until pred(j) is truthy (the edit lands async: POST,
  // rebuild, then the answer shows in /__rv__/src).
  function pollSrc(pred, what) {
    var deadline = Date.now() + 20000;
    function poll() {
      return srcAll().then(function (j) {
        var v = pred(j);
        if (v) return v;
        RVT.assert(Date.now() < deadline, 'source never showed ' + what);
        return new Promise(function (res) { setTimeout(res, 250); }).then(poll);
      });
    }
    return poll();
  }

  function openDeck() {
    return RVT.iframe('/?rv-edit=1', '#rv-ed-toolbar').then(function (f) {
      return RVT.until(function () {
        return f.contentDocument.documentElement.classList.contains('rv-edit')
          ? f : null;
      }, 15000, 'edit mode armed');
    });
  }

  // Navigate the deck iframe to the top-level slide containing `needle`
  // (slide order shifts as earlier suites add/move slides).
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

  // Select `word` inside the first Text node containing it on the current slide.
  function selectWord(f, word) {
    var doc = f.contentDocument;
    var sec = f.contentWindow.Reveal.getCurrentSlide();
    var walker = doc.createTreeWalker(sec, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var at = node.nodeValue.indexOf(word);
      if (at === -1) continue;
      var range = doc.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + word.length);
      var sel = doc.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return node;
    }
    RVT.assert(false, 'no text node with "' + word + '" on the current slide');
  }

  function bubbleVisible(f) {
    var el = f.contentDocument.getElementById('rv-ed-bubble');
    return el && el.style.display !== 'none' ? el : null;
  }

  RVT.test('selection bubble wraps a plain word in ** ** (wrap_span round-trip)', function () {
    return openDeck().then(function (f) {
      return gotoSlideWith(f, 'Some text below the pin').then(function () {
        selectWord(f, 'below');
        return RVT.until(function () { return bubbleVisible(f); },
                         15000, 'selection bubble');
      }).then(function (bub) {
        bub.querySelector('button[data-b="**"]').click();
        return pollSrc(function (j) { return findLine(j, '**below**'); },
                       '**below**');
      }).then(function (hit) {
        RVT.assert(hit.text.indexOf('Some text **below** the pin.') !== -1,
                   'wrap landed at the exact columns: ' + hit.text);
        f.remove();
        return true;
      });
    });
  });

  RVT.test('bubble refuses a selection crossing a formatting boundary', function () {
    return openDeck().then(function (f) {
      return gotoSlideWith(f, 'middle plain tail').then(function () {
        // positive control first: a plain word must arm the bubble here
        selectWord(f, 'plain');
        return RVT.until(function () { return bubbleVisible(f); },
                         15000, 'bubble on a plain word');
      }).then(function () {
        var doc = f.contentDocument;
        var sec = f.contentWindow.Reveal.getCurrentSlide();
        var b = sec.querySelector('.rv-paragraph b');
        RVT.assert(b && b.firstChild, 'rendered <b> on the slide');
        var after = b.nextSibling;
        RVT.assert(after && after.nodeType === 3, 'text node follows the <b>');
        var range = doc.createRange();
        range.setStart(b.firstChild, 1);
        range.setEnd(after, 4);
        var sel = doc.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        // the evaluate debounce is 120 ms; give a wrong bubble time to show
        return new Promise(function (res) { setTimeout(res, 700); });
      }).then(function () {
        RVT.assert(!bubbleVisible(f), 'bubble stayed hidden across the <b> boundary');
        f.remove();
        return true;
      });
    });
  });

  RVT.test('bubble maps columns correctly past a KaTeX span', function () {
    return openDeck().then(function (f) {
      return gotoSlideWith(f, 'Math check').then(function () {
        return RVT.until(function () {
          return f.contentWindow.Reveal.getCurrentSlide().querySelector('.katex');
        }, 15000, 'KaTeX rendered the math');
      }).then(function () {
        selectWord(f, 'trails');
        return RVT.until(function () { return bubbleVisible(f); },
                         15000, 'bubble on text after math');
      }).then(function (bub) {
        bub.querySelector('button[data-b="*"]').click();
        return pollSrc(function (j) { return findLine(j, '*trails*'); },
                       '*trails*');
      }).then(function (hit) {
        RVT.assert(hit.text.indexOf('$x^2$ *trails* words.') !== -1,
                   'columns exact despite the zero-width math: ' + hit.text);
        f.remove();
        return true;
      });
    });
  });
})();
