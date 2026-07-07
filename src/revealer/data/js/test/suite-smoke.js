/* Smoke suite: the editor boots in a real deck and a pin drag round-trips
 * through /__rv__/edit into the .pres source. Runs against whatever deck
 * the test server is serving (the pytest fixture provides one pin). */
(function () {
  'use strict';
  var TOKEN = null;

  function token() {
    if (TOKEN === null) TOKEN = (window.__RV_DEV__ || {}).token || '';
    return TOKEN;
  }

  // /src is idempotent, so a transient "Failed to fetch" (an in-flight
  // request aborted by a rebuild's reload) is retried rather than failing
  // the whole test.
  function srcLines(start, end, tries) {
    tries = tries || 0;
    return RVT.fetch('/__rv__/src?start=' + start + '&end=' + end +
                     '&token=' + encodeURIComponent(token()))
      .then(function (r) { return r.json(); })
      .catch(function (e) {
        if (tries >= 6) throw e;
        return new Promise(function (res) { setTimeout(res, 200); })
          .then(function () { return srcLines(start, end, tries + 1); });
      });
  }

  RVT.test('editor boots and arms edit mode', function () {
    return RVT.iframe('/?rv-edit=1', '#rv-ed-toolbar').then(function (f) {
      return RVT.until(function () {
        return f.contentDocument.documentElement.classList.contains('rv-edit');
      }, 15000, 'rv-edit class on iframe html').then(function () {
        f.remove();
        return true;
      });
    });
  });

  RVT.test('pin drag posts set_pin and rewrites the source line', function () {
    var pinLine = 0;
    var before = '';
    return srcLines(1, 1).then(function (j) {
      return srcLines(1, j.total);
    }).then(function (j) {
      (j.lines || []).forEach(function (ln, i) {
        if (!pinLine && /^> pin\b/.test(ln)) { pinLine = i + 1; before = ln; }
      });
      RVT.assert(pinLine, 'fixture deck has a > pin line');
      return RVT.iframe('/?rv-edit=1', '#rv-ed-toolbar');
    }).then(function (f) {
      // select the pin the way a user does: click it in edit mode
      return RVT.until(function () {
        return f.contentDocument.documentElement.classList.contains('rv-edit') &&
               f.contentDocument.querySelector('.rv-pin');
      }, 15000, 'edit mode + pin element').then(function () {
        var pin = f.contentDocument.querySelector('.rv-pin');
        var pr = pin.getBoundingClientRect();
        pin.dispatchEvent(new f.contentWindow.MouseEvent('click', {
          bubbles: true, cancelable: true,
          clientX: pr.left + pr.width / 2, clientY: pr.top + pr.height / 2,
        }));
        return f;
      });
    }).then(function (f) {
      return RVT.until(function () {
        return f.contentDocument.querySelector('.rv-ed-dragzone');
      }, 15000, 'pin dragzone').then(function (zone) {
        var doc = f.contentDocument;
        var win = f.contentWindow;
        var r = zone.getBoundingClientRect();
        var x0 = r.left + r.width / 2;
        var y0 = r.top + r.height / 2;
        function pe(type, target, x, y) {
          target.dispatchEvent(new win.PointerEvent(type, {
            bubbles: true, cancelable: true, clientX: x, clientY: y,
            pointerId: 1, isPrimary: true, button: 0, buttons: 1,
          }));
        }
        pe('pointerdown', zone, x0, y0);
        pe('pointermove', doc, x0 + 60, y0 + 40);
        pe('pointerup', doc, x0 + 60, y0 + 40);
        // the edit posts, the server rebuilds; poll until the line moves
        var deadline = Date.now() + 20000;
        function poll() {
          return srcLines(pinLine, pinLine).then(function (j) {
            var now = j.lines && j.lines[0];
            if (now && now !== before && /^> pin\b/.test(now)) return now;
            RVT.assert(Date.now() < deadline, 'pin line unchanged after drag: ' + now);
            return new Promise(function (res) { setTimeout(res, 250); }).then(poll);
          });
        }
        return poll().then(function () { f.remove(); return true; });
      });
    });
  });
})();
