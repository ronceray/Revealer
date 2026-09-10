/* Autosave suite: the panel's source box must never lose typed text.
 *
 * The box used to commit only through its Apply button, so selecting another
 * element or changing slide re-rendered the panel and discarded the edit —
 * silent data loss on the most routine interaction in the editor. Every box
 * now registers its commit and the panel flushes it before it re-renders. */
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

  function hasLine(j, needle) {
    return (j.lines || []).some(function (ln) { return ln.indexOf(needle) !== -1; });
  }

  // A panel with one armed source box, on the runner page (no deck needed).
  function scratchPanel(value) {
    var old = document.getElementById('rv-ed-panel');
    if (old) old.remove();
    var p = document.createElement('div');
    p.id = 'rv-ed-panel';
    var ta = document.createElement('textarea');
    ta.className = 'rv-pn-src';
    ta.value = value;
    var foot = document.createElement('div');
    foot.className = 'rv-pn-foot';
    p.appendChild(ta);
    p.appendChild(foot);
    document.body.appendChild(p);
    return { panel: p, ta: ta, foot: foot };
  }

  function type(ta, value) {
    ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  RVT.test('a dirty source box flushes once, and only when dirty', function () {
    var s = scratchPanel('original line');
    var commits = 0;
    try {
      RV.fn.armSourceBox(s.ta, function () { commits += 1; });
      RVT.assert(!RV.fn.panelDirty(), 'a freshly armed box is clean');
      RVT.assert(RV.fn.flushDirtySources() === 0, 'nothing to flush when clean');

      type(s.ta, 'edited line');
      RVT.assert(RV.fn.panelDirty(), 'typing marks the panel dirty');
      RVT.assert(s.ta.classList.contains('rv-dirty'), 'the box shows the dirty state');
      RVT.assert(s.foot.textContent.indexOf('Unsaved') !== -1 ||
                 s.foot.textContent.indexOf('non enregistr') !== -1,
                 'the footer says it is unsaved, got: ' + s.foot.textContent);

      RVT.assert(RV.fn.flushDirtySources() === 1, 'flushed the one dirty box');
      RVT.assert(commits === 1, 'commit ran exactly once, got ' + commits);
      RVT.assert(!s.ta.classList.contains('rv-dirty'), 'the box is clean after the flush');
      RVT.assert(!RV.fn.panelDirty(), 'panel is clean after the flush');

      RVT.assert(RV.fn.flushDirtySources() === 0, 'a second flush posts nothing');
      RVT.assert(commits === 1, 'still one commit, got ' + commits);

      // Typing back to the original value is not an edit.
      type(s.ta, 'edited line X');
      type(s.ta, 'edited line');
      RVT.assert(!RV.fn.panelDirty(), 'reverting to the saved text is clean');
    } finally {
      s.panel.remove();
    }
  });

  RVT.test('a box with no commit closure never claims to be dirty', function () {
    var s = scratchPanel('text');
    try {
      type(s.ta, 'changed');            // never armed: no bounds, nothing to post
      RVT.assert(!RV.fn.panelDirty(), 'an unarmed box is not a pending edit');
      RVT.assert(RV.fn.flushDirtySources() === 0, 'and flushes nothing');
    } finally {
      s.panel.remove();
    }
  });

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

  // Select `el`, wait for its source box to arrive, and return the box.
  function selectAndWait(f, el, contains) {
    f.contentWindow.RV.set('sel', el);
    return RVT.until(function () {
      var ta = f.contentDocument.querySelector('#rv-ed-panel .rv-pn-src');
      return ta && ta.value.indexOf(contains) !== -1 ? ta : null;
    }, 15000, 'source box holding "' + contains + '"');
  }

  RVT.test('the first slide\'s panel carries the deck settings block', function () {
    // #14: the header is edited far more often than any one slide, and a menu
    // entry under View was not where anyone looked for it.
    var f;
    return openDeck().then(function (frame) {
      f = frame;
      f.contentWindow.Reveal.slide(0, 0);
      return RVT.until(function () {
        var cur = f.contentWindow.Reveal.getCurrentSlide();
        return cur && f.contentWindow.Reveal.getIndices().h === 0 ? cur : null;
      }, 15000, 'on the first slide');
    }).then(function (sec) {
      f.contentWindow.RV.set('sel', null);
      f.contentWindow.RV.state.panelFor = null;
      f.contentWindow.RV.fn.rvPanelSync();
      return RVT.until(function () {
        var ta = f.contentDocument.querySelector('#rv-ed-panel .rv-pn-src-doc');
        return ta && ta.value.indexOf('> title:') !== -1 ? ta : null;
      }, 15000, 'settings box on the first slide panel');
    }).then(function (ta) {
      var doc = f.contentDocument;
      RVT.assert(ta.value.indexOf('> title: JS harness') !== -1,
                 'shows the real header: ' + JSON.stringify(ta.value.slice(0, 60)));
      var det = doc.querySelector('#rv-ed-panel .rv-pn-docset');
      RVT.assert(det && det.open, 'a short header opens without a click');
      RVT.assert(doc.querySelector('#rv-ed-panel .rv-pn-src-slide'),
                 'the slide source box is still there');
      RVT.assert(doc.querySelectorAll('#rv-ed-panel .rv-pn-src').length === 2,
                 'two independent source boxes');
      // Each box owns its own footer: typing in one must not relabel the other.
      var slideBox = doc.querySelector('#rv-ed-panel .rv-pn-src-slide');
      var foots = doc.querySelectorAll('#rv-ed-panel .rv-pn-foot');
      var before = foots[0].textContent;
      slideBox.value = slideBox.value + ' ';
      slideBox.dispatchEvent(new f.contentWindow.Event('input', { bubbles: true }));
      RVT.assert(foots[0].textContent === before,
                 'the settings footer is untouched by typing in the slide box');
      slideBox.value = slideBox.value.replace(/ $/, '');
      slideBox.dispatchEvent(new f.contentWindow.Event('input', { bubbles: true }));

      // Navigating off slide 1 drops the settings block again.
      f.contentWindow.Reveal.slide(1, 0);
      return RVT.until(function () {
        return !doc.querySelector('#rv-ed-panel .rv-pn-src-doc') ? true : null;
      }, 15000, 'settings block gone from a later slide');
    }).then(function () {
      f.remove();
      return true;
    });
  });

  RVT.test('selecting another element saves the edited source box', function () {
    var f;
    return openDeck().then(function (frame) {
      f = frame;
      return gotoSlideWith(f, 'Second slide.');
    }).then(function () {
      var para = f.contentWindow.Reveal.getCurrentSlide()
        .querySelector('.rv-paragraph[data-rv-src]');
      RVT.assert(para, 'the slide has an annotated paragraph');
      return selectAndWait(f, para, 'Second slide.');
    }).then(function (ta) {
      // Type, then navigate away WITHOUT touching Apply — the reported bug.
      ta.value = 'Second slide. Saved by navigating away.';
      ta.dispatchEvent(new f.contentWindow.Event('input', { bubbles: true }));
      RVT.assert(ta.classList.contains('rv-dirty'), 'the box is marked dirty');
      f.contentWindow.RV.set('sel', null);
      return pollSrc(function (j) {
        return hasLine(j, 'Second slide. Saved by navigating away.');
      }, 'the autosaved line');
    }).then(function () {
      f.remove();
      return true;
    });
  });

})();
