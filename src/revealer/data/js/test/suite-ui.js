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
      f.contentDocument.querySelector('.rv-tb-hist').click();
      return RVT.until(function () {
        return f.contentDocument.querySelector('#rv-ed-history .rv-hi-item');
      }, 15000, 'history entries').then(function () {
        var doc = f.contentDocument;
        RVT.assert(doc.querySelector('#rv-ed-history .rv-box-head'), 'factory header');
        RVT.assert(doc.querySelector('#rv-ed-history .rv-hi-current'),
                   'one entry carries the cursor marker');
        // second toolbar click closes it (toggle-by-remove preserved)
        doc.querySelector('.rv-tb-hist').click();
        RVT.assert(!doc.getElementById('rv-ed-history'), 'toggles closed');
        f.remove();
        return true;
      });
    });
  });

  RVT.test('split view letterboxes the slide over a gray stage', function () {
    return RVT.iframe('/?rv-edit=1&rv-split=1', '#rv-ed-toolbar').then(function (f) {
      return RVT.until(function () {
        var d = f.contentDocument;
        var reveal = d.querySelector('.reveal');
        return d.body.classList.contains('rv-split') &&
               d.getElementById('rv-ed-stage') &&
               reveal && reveal.style.width ? f : null;
      }, 15000, 'gray stage + fitted reveal box').then(function (f) {
        var d = f.contentDocument;
        var stage = d.getElementById('rv-ed-stage');
        var reveal = d.querySelector('.reveal');
        var boxW = parseFloat(reveal.style.width);
        var boxH = parseFloat(reveal.style.height);
        var stageW = parseFloat(stage.style.width);
        RVT.assert(boxW > 0 && boxW < stageW,
          'reveal box (' + boxW + ') is inset within the stage (' + stageW + ')');
        var cfg = f.contentWindow.Reveal.getConfig();
        var want = (cfg.width || 960) / (cfg.height || 700);
        RVT.assert(Math.abs(boxW / boxH - want) < 0.05,
          'box aspect ' + (boxW / boxH).toFixed(3) + ' ~ deck ' + want.toFixed(3));
        f.remove();
        return true;
      });
    });
  });
})();
