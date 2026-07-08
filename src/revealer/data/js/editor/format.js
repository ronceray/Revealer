/* format: the inline-format toolbar for source textareas (bold/italic/code, palette swatches, size spans) */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;

  function wrapSel(ta, before, after) {
    var a = ta.selectionStart, b = ta.selectionEnd;
    var sel = ta.value.slice(a, b);
    var out;
    if (a === b) {
      out = before + 'text' + after;
    } else if (sel.indexOf('\n') === -1) {
      out = before + sel + after;
    } else {
      // An inline span (**…**, [ …]{…}) can't cross a line break — build.py
      // renders each line separately — so a multi-line selection wraps each
      // non-blank line's content after any list marker, not the whole block.
      out = sel.split('\n').map(function (ln) {
        var m = /^(\s*(?:[*+\-]|\d+[.)])\s+)?(.*)$/.exec(ln);
        return (m && m[2].trim()) ? (m[1] || '') + before + m[2] + after : ln;
      }).join('\n');
    }
    ta.value = ta.value.slice(0, a) + out + ta.value.slice(b);
    ta.focus();
    ta.selectionStart = a;
    ta.selectionEnd = a + out.length;
  }

  // Drop a snippet at the caret (palette chips). Cursor lands after it.
  function insertAtCursor(ta, text) {
    var a = ta.selectionStart, b = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = a + text.length;
  }

  // Wrap the selected whole lines (or the caret's line) in a `> frag` block —
  // reveals that content as one fragment. Block-level, so it can't reuse wrapSel.
  function wrapFragBlock(ta) {
    var v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    var ls = v.lastIndexOf('\n', a - 1) + 1;         // start of the first line
    var le = v.indexOf('\n', b);                     // end of the last line
    if (le === -1) le = v.length;
    var wrapped = '> frag\n' + v.slice(ls, le) + '\n> end: frag';
    ta.value = v.slice(0, ls) + wrapped + v.slice(le);
    ta.focus();
    ta.selectionStart = ls;
    ta.selectionEnd = ls + wrapped.length;
  }

  var PALETTE = [['accent', '--rv-accent'], ['warn', '--rv-warn'],
                 ['good', '--rv-good'], ['muted', '--rv-muted-color']];

  function formatBar(ta) {
    var bar = document.createElement('div');
    bar.className = 'rv-fmt';
    var root = getComputedStyle(document.documentElement);
    bar.innerHTML =
      '<button data-b="**" data-a="**" title="bold"><b>B</b></button>' +
      '<button data-b="*" data-a="*" title="italic"><i>I</i></button>' +
      '<button data-b="\`" data-a="\`" title="code">&lt;&gt;</button>' +
      PALETTE.map(function (c) {
        return '<button class="rv-fmt-sw" data-b="[" data-a="]{.' + c[0] + '}" title="' + c[0] +
          '" style="background:' + F.escapeHtml(root.getPropertyValue(c[1]).trim() || '#888') + '"></button>';
      }).join('') +
      '<input type="color" title="custom color" value="#1a4fd6">' +
      '<select title="size"><option value="">size…</option>' +
      ['title', 'lede', 'sm', 'fine'].map(function (r) {
        return '<option value="' + r + '">' + r + '</option>';
      }).join('') + '</select>';
    bar.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        wrapSel(ta, b.getAttribute('data-b'), b.getAttribute('data-a'));
      });
    });
    bar.querySelector('input[type=color]').addEventListener('change', function (ev) {
      wrapSel(ta, '[', ']{color=' + ev.target.value + '}');
    });
    bar.querySelector('select').addEventListener('change', function (ev) {
      if (ev.target.value) wrapSel(ta, '[', ']{.' + ev.target.value + '}');
      ev.target.value = '';
    });
    return bar;
  }

  // exports (what other editor/ modules call):
  F.formatBar = formatBar;
  F.insertAtCursor = insertAtCursor;
  F.wrapFragBlock = wrapFragBlock;
  RV.PALETTE = PALETTE;  // textsel.js reuses the swatch set in the bubble
})();
