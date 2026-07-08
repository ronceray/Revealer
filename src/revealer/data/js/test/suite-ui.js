/* Unit suite: RV namespace, escapeHtml, and the RV.ui.box widget factory.
 * Runs directly on the runner page (the editor monolith boots here too,
 * so window.RV is live); the drawer test drives a real deck iframe. */
(function () {
  'use strict';

  RVT.test('RV namespace and state exist', function () {
    RVT.assert(window.RV && RV.state, 'RV.state missing');
    RVT.assert(RV.state.on === false, 'edit mode should start off');
    RVT.assert(RV.state.drag === null, 'no drag at boot');
    RVT.assert(typeof RV.esc === 'function', 'RV.esc missing');
    RVT.assert(typeof RV.ui.box === 'function', 'RV.ui.box missing');
  });

  RVT.test('RV.esc neutralizes html metacharacters', function () {
    RVT.assert(RV.esc('<img src=x onerror=alert(1)>') ===
               '&lt;img src=x onerror=alert(1)&gt;', 'angle brackets');
    RVT.assert(RV.esc('a"b&c') === 'a&quot;b&amp;c', 'quote and ampersand');
    RVT.assert(RV.esc(42) === '42', 'coerces non-strings');
  });

  RVT.test('RV.ui.box: toggle, buttons, close, replace, closes', function () {
    var clicked = 0;
    var w = RV.ui.box({ id: 'rvt-box', title: 'T', buttons: [
      { label: 'B', onClick: function () { clicked += 1; } }] });
    RVT.assert(w && w.box === document.getElementById('rvt-box'), 'created');
    RVT.assert(w.box.querySelector('.rv-box-head b').textContent === 'T', 'title text');
    w.box.querySelector('.rv-box-head button').click();
    RVT.assert(clicked === 1, 'action button fired');
    w.box.querySelector('.rv-box-close').click();
    RVT.assert(!document.getElementById('rvt-box'), 'close button removes');

    RV.ui.box({ id: 'rvt-box', title: 'T' });
    var again = RV.ui.box({ id: 'rvt-box', title: 'T' });
    RVT.assert(again === null, 'second call returns null');
    RVT.assert(!document.getElementById('rvt-box'), 'toggle-by-remove');

    RV.ui.box({ id: 'rvt-box', title: 'T1' });
    var r = RV.ui.box({ id: 'rvt-box', title: 'T2', replace: true });
    RVT.assert(r && r.box.querySelector('b').textContent === 'T2', 'replace recreates');
    r.box.remove();

    RV.ui.box({ id: 'rvt-a', title: 'A' });
    RV.ui.box({ id: 'rvt-b', title: 'B', closes: ['rvt-a'] });
    RVT.assert(!document.getElementById('rvt-a'), 'closes sibling box');
    document.getElementById('rvt-b').remove();
  });

  RVT.test('state bus: set/onChange/emit semantics', function () {
    var calls = [];
    var off = RV.onChange('rvtKey', function (v, prev) { calls.push([v, prev]); });
    RV.set('rvtKey', 1);
    RV.set('rvtKey', 1);          // dedup: same value must not notify
    RV.set('rvtKey', 2);
    RV.emit('rvtKey');            // forced notification, value unchanged
    off();
    RV.set('rvtKey', 3);          // unsubscribed: silent
    RVT.assert(RV.get('rvtKey') === 3, 'get reads the store');
    RVT.assert(JSON.stringify(calls) === '[[1,null],[2,1],[2,2]]',
               'got ' + JSON.stringify(calls));
    delete RV.state.rvtKey;
    return true;
  });

  RVT.test('split view arms via the bus (rv-split boot param)', function () {
    return RVT.iframe('/?rv-edit=1&rv-split=1', '#rv-ed-toolbar').then(function (f) {
      return RVT.until(function () {
        return f.contentDocument.body.classList.contains('rv-split') &&
               f.contentDocument.getElementById('rv-ed-divider');
      }, 15000, 'body.rv-split + divider').then(function () {
        f.remove();
        return true;
      });
    });
  });

  RVT.test('history drawer opens from the toolbar with a current marker', function () {
    return RVT.iframe('/?rv-edit=1', '#rv-ed-toolbar').then(function (f) {
      RVT.menuClick(f.contentDocument, 'History', 'Version history');
      return RVT.until(function () {
        return f.contentDocument.querySelector('#rv-ed-history .rv-hi-item');
      }, 15000, 'history entries').then(function () {
        var doc = f.contentDocument;
        RVT.assert(doc.querySelector('#rv-ed-history .rv-box-head'), 'factory header');
        RVT.assert(doc.querySelector('#rv-ed-history .rv-hi-current'),
                   'one entry carries the cursor marker');
        // reopening from the menu closes it (toggle-by-remove preserved)
        RVT.menuClick(doc, 'History', 'Version history');
        RVT.assert(!doc.getElementById('rv-ed-history'), 'toggles closed');
        f.remove();
        return true;
      });
    });
  });

  RVT.test('document settings editor edits the .pres header block', function () {
    return RVT.iframe('/?rv-edit=1', '#rv-ed-toolbar').then(function (f) {
      return RVT.until(function () {
        return f.contentDocument.documentElement.classList.contains('rv-edit') ? f : null;
      }, 15000, 'edit mode');
    }).then(function (f) {
      var doc = f.contentDocument;
      var tok = (f.contentWindow.__RV_DEV__ || {}).token || '';
      RVT.menuClick(doc, 'View', 'Document source');
      return RVT.until(function () {
        var ta = doc.querySelector('#rv-ed-panel .rv-pn-src');
        return ta && ta.value.indexOf('> title:') !== -1 ? ta : null;
      }, 15000, 'settings editor showing the title').then(function (ta) {
        RVT.assert(ta.value.indexOf('> title: JS harness') !== -1,
          'settings block is shown: ' + JSON.stringify(ta.value));
        ta.value = ta.value.replace('JS harness', 'Edited Header');
        doc.querySelector('#rv-ed-panel .rv-pn-apply').click();
        function poll(n) {
          return RVT.fetch('/__rv__/src?start=1&end=1&token=' + encodeURIComponent(tok))
            .then(function (r) { return r.json(); })
            .then(function (j) {
              if (j.lines && j.lines[0].indexOf('Edited Header') !== -1) return true;
              RVT.assert(n < 40, 'title line not updated: ' + (j.lines && j.lines[0]));
              return new Promise(function (res) { setTimeout(res, 250); })
                .then(function () { return poll(n + 1); });
            });
        }
        return poll(0);
      }).then(function () {
        // restore the fixture title for later suites (deck is shared)
        return RVT.fetch('/__rv__/src?start=1&end=1&token=' + encodeURIComponent(tok))
          .then(function (r) { return r.json(); })
          .then(function (j) {
            return RVT.fetch('/__rv__/edit', {
              method: 'POST',
              headers: { 'X-RV-Token': tok, 'Content-Type': 'application/json' },
              body: JSON.stringify({ sha256: j.sha256, edits: [{
                op: 'replace_lines', start: 1, end: 1,
                text: ['> title: JS harness'] }] }),
            });
          });
      }).then(function () { f.remove(); return true; });
    });
  });

  RVT.test('preview Edit pill is draggable by its grip', function () {
    return RVT.iframe('/', '#rv-ed-pill').then(function (f) {
      var doc = f.contentDocument, win = f.contentWindow;
      var pill = doc.getElementById('rv-ed-pill');
      var grip = pill.querySelector('.rv-tb-grip');
      RVT.assert(grip, 'pill has a drag grip');
      var before = pill.getBoundingClientRect().left;
      var gr = grip.getBoundingClientRect();
      function pe(type, x, y, target) {
        (target || doc).dispatchEvent(new win.PointerEvent(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y,
          pointerId: 1, isPrimary: true, buttons: 1 }));
      }
      pe('pointerdown', gr.left + 5, gr.top + 5, grip);
      pe('pointermove', gr.left + 235, gr.top + 120);
      pe('pointerup', gr.left + 235, gr.top + 120);
      var after = pill.getBoundingClientRect().left;
      RVT.assert(after > before + 150,
        'pill moved right (' + before + ' -> ' + after + ')');
      try { win.localStorage.removeItem('rv-ed-tbpos'); } catch (e) {}
      f.remove();
      return true;
    });
  });

  RVT.test('split view scales the whole deck into a gray-framed box', function () {
    return RVT.iframe('/?rv-edit=1&rv-split=1', '#rv-ed-toolbar').then(function (f) {
      return RVT.until(function () {
        var d = f.contentDocument;
        var reveal = d.querySelector('.reveal');
        var frame = d.getElementById('rv-ed-frame');
        return d.body.classList.contains('rv-split') &&
               d.getElementById('rv-ed-stage') &&
               frame && frame.style.display === 'block' &&
               reveal && /scale\(/.test(reveal.style.transform) ? f : null;
      }, 15000, 'stage + framed box + scaled deck').then(function (f) {
        var d = f.contentDocument;
        var frame = d.getElementById('rv-ed-frame');
        var stage = d.getElementById('rv-ed-stage');
        var fw = parseFloat(frame.style.width), fh = parseFloat(frame.style.height);
        var sw = parseFloat(stage.style.width), sh = parseFloat(stage.style.height);
        RVT.assert(fw > 0 && fw < sw && fh > 0 && fh < sh,
          'framed box (' + fw + 'x' + fh + ') inset in the stage (' + sw + 'x' + sh + ')');
        // the deck — reveal AND the fixed chrome — is scaled by the SAME factor
        var m = /scale\(([0-9.]+)\)/.exec(d.querySelector('.reveal').style.transform);
        RVT.assert(m && parseFloat(m[1]) > 0 && parseFloat(m[1]) < 1,
          'reveal scaled down (' + (m && m[1]) + ')');
        var header = d.querySelector('body > header');
        if (header && header.style.transform) {
          var hm = /scale\(([0-9.]+)\)/.exec(header.style.transform);
          RVT.assert(hm && Math.abs(parseFloat(hm[1]) - parseFloat(m[1])) < 1e-6,
            'header scaled by the same factor as the deck (stays coupled)');
        }
        f.remove();
        return true;
      });
    });
  });
})();
