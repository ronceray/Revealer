/* Race suite: the edit FIFO queue and the consolidated keyboard guard.
 * Drives a real deck iframe — the races exercised here are the exact
 * bugs the queue exists to prevent (silently dropped second edit,
 * arrows nudging while typing in a field). */
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

  function findPin(j) {
    var out = null;
    (j.lines || []).forEach(function (ln, i) {
      if (!out && /^> pin\b/.test(ln)) out = { line: i + 1, text: ln };
    });
    return out;
  }

  function openWithPin() {
    return RVT.iframe('/?rv-edit=1', '#rv-ed-toolbar').then(function (f) {
      return RVT.until(function () {
        return f.contentDocument.documentElement.classList.contains('rv-edit') &&
               f.contentDocument.querySelector('.rv-pin') ? f : null;
      }, 15000, 'edit mode + pin');
    });
  }

  function clickPin(f) {
    var pin = f.contentDocument.querySelector('.rv-pin');
    var r = pin.getBoundingClientRect();
    pin.dispatchEvent(new f.contentWindow.MouseEvent('click', {
      bubbles: true, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    }));
    return RVT.until(function () {
      return f.contentDocument.querySelector('.rv-ed-dragzone');
    }, 15000, 'pin dragzone');
  }

  function dragBy(f, zone, dx, dy) {
    var doc = f.contentDocument, win = f.contentWindow;
    var r = zone.getBoundingClientRect();
    var x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    function pe(type, target, x, y) {
      target.dispatchEvent(new win.PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
        pointerId: 1, isPrimary: true, button: 0, buttons: 1,
      }));
    }
    pe('pointerdown', zone, x0, y0);
    pe('pointermove', doc, x0 + dx, y0 + dy);
    pe('pointerup', doc, x0 + dx, y0 + dy);
  }

  RVT.test('back-to-back drags both land (FIFO, no silent drop)', function () {
    var pin0;
    return srcAll().then(function (j) {
      pin0 = findPin(j);
      RVT.assert(pin0, 'pin line present');
      return openWithPin();
    }).then(function (f) {
      return clickPin(f).then(function (zone) {
        // two drags in quick succession: the second commits while the
        // first's POST is still in flight, so it must queue, not vanish
        dragBy(f, zone, 40, 0);
        var zone2 = f.contentDocument.querySelector('.rv-ed-dragzone') || zone;
        dragBy(f, zone2, 0, 30);
        var deadline = Date.now() + 20000;
        var seen = {};
        function poll() {
          return srcAll().then(function (j) {
            var now = findPin(j);
            if (now) seen[now.text] = 1;
            // done when the line differs from the original AND at least two
            // distinct rewrites were observed or the queue clearly drained
            var changed = now && now.text !== pin0.text;
            if (changed && Object.keys(seen).length >= 2) return true;
            RVT.assert(Date.now() < deadline,
                       'second drag never landed; saw ' + JSON.stringify(Object.keys(seen)));
            return new Promise(function (res) { setTimeout(res, 250); }).then(poll);
          });
        }
        return poll().then(function () { f.remove(); return true; });
      });
    });
  });

  RVT.test('typing guard: arrows in the source box never nudge the pin', function () {
    var before;
    return openWithPin().then(function (f) {
      return clickPin(f).then(function () {
        return RVT.until(function () {
          var ta = f.contentDocument.querySelector('.rv-pn-src');
          return ta && ta.value ? ta : null;
        }, 15000, 'panel source box');
      }).then(function (ta) {
        return srcAll().then(function (j) {
          before = findPin(j).text;
          ta.focus();
          [1, 2, 3, 4].forEach(function () {
            ta.dispatchEvent(new f.contentWindow.KeyboardEvent('keydown', {
              key: 'ArrowRight', bubbles: true, cancelable: true,
            }));
          });
          return new Promise(function (res) { setTimeout(res, 900); });
        }).then(function () {
          return srcAll();
        }).then(function (j) {
          RVT.assert(findPin(j).text === before,
                     'pin moved from a keystroke aimed at the textarea');
          f.remove();
          return true;
        });
      });
    });
  });
})();
