/* Touch suite: the coarse-pointer picking path in chrome.js.
 *
 * Drives synthetic touch PointerEvents against a real deck iframe. Long-press
 * selection is deterministic — we dwell past the 500 ms threshold by polling
 * RV.state.sel — and a moved touch (scroll/drag) must NOT select. Everything
 * is guarded on pointerType==='touch', so this never disturbs mouse picking.
 */
(function () {
  'use strict';

  function armedPin(f) {
    return RVT.until(function () {
      return f.contentDocument.documentElement.classList.contains('rv-edit') &&
             f.contentDocument.querySelector('.rv-pin')
        ? f.contentDocument.querySelector('.rv-pin') : null;
    }, 15000, 'edit mode + pin element');
  }

  function touchEvent(win, type, x, y) {
    return new win.PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 7, pointerType: 'touch', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
    });
  }

  RVT.test('long-press (touch) selects the element under the finger', function () {
    return RVT.iframe('/?rv-edit=1', '#rv-ed-toolbar').then(function (f) {
      return armedPin(f).then(function (pin) {
        var win = f.contentWindow;
        var r = pin.getBoundingClientRect();
        var x = r.left + r.width / 2, y = r.top + r.height / 2;
        win.RV.set('sel', null);
        RVT.assert(!win.RV.state.sel, 'nothing selected before the long-press');
        pin.dispatchEvent(touchEvent(win, 'pointerdown', x, y));
        // dwell past the ~500 ms long-press threshold (the timer sets sel)
        return RVT.until(function () {
          return win.RV.state.sel === pin ? pin : null;
        }, 5000, 'pin selected by long-press').then(function () {
          pin.dispatchEvent(touchEvent(win, 'pointerup', x, y));
          RVT.assert(win.RV.state.sel === pin, 'pin stays selected after release');
          f.remove();
          return true;
        });
      });
    });
  });

  RVT.test('a moved touch (scroll/drag) does not long-press-select', function () {
    return RVT.iframe('/?rv-edit=1', '#rv-ed-toolbar').then(function (f) {
      return armedPin(f).then(function (pin) {
        var doc = f.contentDocument, win = f.contentWindow;
        var r = pin.getBoundingClientRect();
        var x = r.left + r.width / 2, y = r.top + r.height / 2;
        win.RV.set('sel', null);
        pin.dispatchEvent(touchEvent(win, 'pointerdown', x, y));
        doc.dispatchEvent(touchEvent(win, 'pointermove', x + 80, y + 80));  // beyond tap threshold
        // give the (now-cancelled) long-press timer time to prove it won't fire
        return new Promise(function (res) { setTimeout(res, 700); }).then(function () {
          doc.dispatchEvent(touchEvent(win, 'pointerup', x + 80, y + 80));
          RVT.assert(win.RV.state.sel !== pin, 'a moved touch must not select the pin');
          f.remove();
          return true;
        });
      });
    });
  });
})();
