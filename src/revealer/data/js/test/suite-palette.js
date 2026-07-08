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

  RVT.test('template gallery: 13 cards, insert on click, closes', function () {
    RVT.assert(RV.fn.TEMPLATES.length === 13, 'expected 13 templates');
    var ids = RV.fn.TEMPLATES.map(function (t) { return t.id; });
    RVT.assert(new Set(ids).size === 13, 'template ids are unique');
    var orig = RV.fn.rvPostEdit, captured = null;
    RV.fn.rvPostEdit = function (edits, file) { captured = { edits: edits, file: file }; return Promise.resolve(true); };
    try {
      var pre = document.getElementById('rv-ed-templates');
      if (pre) pre.remove();
      RV.fn.openTemplateGallery({ s: 1, e: 4 }, '');
      var box = document.getElementById('rv-ed-templates');
      RVT.assert(box, 'gallery box opened');
      RVT.assert(box.querySelectorAll('.rv-tpl-card').length === 13, 'renders 13 cards');
      box.querySelector('.rv-tpl-card[data-id="content"]').click();
      RVT.assert(captured && captured.edits[0].op === 'insert_lines', 'posted insert_lines');
      RVT.assert(captured.edits[0].at.insert_before === 5, 'inserts after e (=4)');
      RVT.assert(JSON.stringify(captured.edits[0].text) ===
                 JSON.stringify(['', '=== Title', '', 'Your text here.']),
                 'content body, got ' + JSON.stringify(captured.edits[0].text));
      RVT.assert(!document.getElementById('rv-ed-templates'), 'gallery closes after a pick');
    } finally {
      RV.fn.rvPostEdit = orig;
      var b = document.getElementById('rv-ed-templates');
      if (b) b.remove();
    }
  });
})();
