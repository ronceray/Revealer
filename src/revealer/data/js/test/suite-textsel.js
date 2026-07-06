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

  /* --- in-place editing (inline-edit.js) --------------------------------- */

  function paraWith(f, needle) {
    var sec = f.contentWindow.Reveal.getCurrentSlide();
    var paras = sec.querySelectorAll('.rv-paragraph[data-rv-src]');
    for (var i = 0; i < paras.length; i++) {
      if (paras[i].textContent.indexOf(needle) !== -1) return paras[i];
    }
    RVT.assert(false, 'no paragraph containing "' + needle + '"');
  }

  function dblclick(f, el) {
    el.dispatchEvent(new f.contentWindow.MouseEvent('dblclick', {
      bubbles: true, cancelable: true,
    }));
  }

  RVT.test('double-click edits a paragraph in place (replace_lines round-trip)', function () {
    return openDeck().then(function (f) {
      return gotoSlideWith(f, 'Editable target line').then(function () {
        var para = paraWith(f, 'Editable target line here.');
        dblclick(f, para);
        return RVT.until(function () {
          return para.isContentEditable ? para : null;
        }, 15000, 'paragraph becomes contenteditable');
      }).then(function (para) {
        para.textContent = 'Rewritten in place by the suite.';
        para.dispatchEvent(new f.contentWindow.FocusEvent('blur'));
        return pollSrc(function (j) {
          return findLine(j, 'Rewritten in place by the suite.') &&
                 !findLine(j, 'Editable target line here.');
        }, 'the rewritten paragraph line');
      }).then(function () {
        f.remove();
        return true;
      });
    });
  });

  RVT.test('Escape cancels an in-place edit and restores the DOM', function () {
    var lineBefore;
    return srcAll().then(function (j) {
      lineBefore = findLine(j, 'middle plain tail');
      RVT.assert(lineBefore, 'fixture line with bold present');
      return openDeck();
    }).then(function (f) {
      return gotoSlideWith(f, 'middle plain tail').then(function () {
        var para = paraWith(f, 'middle plain tail');
        dblclick(f, para);
        return RVT.until(function () {
          return para.isContentEditable ? para : null;
        }, 15000, 'paragraph becomes contenteditable');
      }).then(function (para) {
        para.textContent = 'thrown away';
        para.dispatchEvent(new f.contentWindow.KeyboardEvent('keydown', {
          key: 'Escape', bubbles: true, cancelable: true,
        }));
        RVT.assert(!para.isContentEditable, 'Escape ends the session');
        RVT.assert(para.querySelector('b'), 'original <b> restored');
        RVT.assert(para.textContent.indexOf('middle plain tail') !== -1,
                   'original text restored');
        // nothing may have been posted: the source line must stay put
        return new Promise(function (res) { setTimeout(res, 800); });
      }).then(function () {
        return srcAll();
      }).then(function (j) {
        var now = findLine(j, 'middle plain tail');
        RVT.assert(now && now.text === lineBefore.text,
                   'source unchanged after cancel');
        f.remove();
        return true;
      });
    });
  });

  /* --- reverse renderer (pure DOM, runs on the runner page) --------------- */

  RVT.test('reverseRender round-trips the inline vocabulary', function () {
    var F = window.RV.fn;
    var cases = [
      ['plain text line', 'plain text line'],
      ['with **bold** words', 'with <b>bold</b> words'],
      ['an *italic* bit', 'an <i>italic</i> bit'],
      ['some `code` span', 'some <code>code</code> span'],
      ['a [link](https://example.org/x) here',
       'a <a href="https://example.org/x" target="_blank">link</a> here'],
      ['role [text]{.accent} span', 'role <span class="accent">text</span> span'],
      ['two [text]{.accent .lede} roles',
       'two <span class="accent lede">text</span> roles'],
      ['a [color]{color=#ff0000} span',
       'a <span style="color:#ff0000">color</span> span'],
      ['a [size]{size=120%} span',
       'a <span style="font-size:120%">size</span> span'],
      ['mix [x]{.warn color=#f00} attrs',
       'mix <span class="warn" style="color:#f00">x</span> attrs'],
      ['nested *a **b** c* forms', 'nested <i>a <b>b</b> c</i> forms'],
      ['escaped \\*star \\`tick \\[bracket', 'escaped *star `tick [bracket'],
      ['line one\nline two\n', 'line one\nline two\n'],
    ];
    var div = document.createElement('div');
    cases.forEach(function (c) {
      div.innerHTML = c[1];
      var got = F.reverseRender(div);
      RVT.assert(got === c[0],
                 'reverse of ' + JSON.stringify(c[1]) + ' = ' +
                 JSON.stringify(got) + ', want ' + JSON.stringify(c[0]));
    });
    var refusals = ['<u>x</u>', '<span>x</span>', 'a<br>b', '<div>x</div>',
                    '<b> pad </b>', '<a href="https://x" id="k">x</a>',
                    '<span style="font-weight:700">x</span>'];
    refusals.forEach(function (html) {
      div.innerHTML = html;
      RVT.assert(F.reverseRender(div) === null,
                 'must refuse ' + JSON.stringify(html));
    });
    return true;
  });
})();
