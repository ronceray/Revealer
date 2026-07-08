/* Suite: the schema-driven command palette + the insert / frag-wrap helpers. */
(function () {
  'use strict';

  RVT.test('insertAtCursor drops text at the caret', function () {
    var ta = document.createElement('textarea');
    ta.value = 'abcd';
    ta.selectionStart = ta.selectionEnd = 2;
    RV.fn.insertAtCursor(ta, 'XY');
    RVT.assert(ta.value === 'abXYcd', 'got ' + ta.value);
    RVT.assert(ta.selectionStart === 4, 'caret sits after the insert');
  });

  RVT.test('wrapFragBlock wraps the selected whole lines', function () {
    var ta = document.createElement('textarea');
    ta.value = '* a\n* b\n* c';
    ta.selectionStart = 0; ta.selectionEnd = 7;         // spans "* a\n* b"
    RV.fn.wrapFragBlock(ta);
    RVT.assert(ta.value === '> frag\n* a\n* b\n> end: frag\n* c',
               'got ' + JSON.stringify(ta.value));
  });

  RVT.test('palette renders schema groups and a chip inserts at the caret', function () {
    return RVT.until(function () { return RV.schema && RV.schema.staticCheat; },
                     15000, 'RV.schema loaded').then(function () {
      var old = document.getElementById('rv-ed-panel');
      if (old) old.remove();
      var panel = document.createElement('div');
      panel.id = 'rv-ed-panel';
      var ta = document.createElement('textarea');
      ta.className = 'rv-pn-src';
      panel.appendChild(ta);
      document.body.appendChild(panel);
      try {
        RV.fn.appendPalette(panel);
        var secs = panel.querySelectorAll('.rv-pl-sec');
        RVT.assert(secs.length >= 5, 'expected several groups, got ' + secs.length);
        RVT.assert(panel.querySelector('.rv-pl-wrap'), 'Fragments group has a wrap button');
        var chip = panel.querySelector('.rv-pl-chip:not(.rv-pl-wrap)');
        RVT.assert(chip, 'has an insert chip');
        ta.selectionStart = ta.selectionEnd = 0;
        chip.click();
        RVT.assert(ta.value.length > 0, 'chip inserted its snippet into the source box');
      } finally {
        panel.remove();
      }
    });
  });
})();
