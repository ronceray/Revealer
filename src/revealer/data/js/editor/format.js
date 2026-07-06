/* format: the inline-format toolbar for source textareas (bold/italic/code, palette swatches, size spans) */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;

  function wrapSel(ta, before, after) {
    var a = ta.selectionStart, b = ta.selectionEnd;
    var mid = ta.value.slice(a, b) || 'text';
    ta.value = ta.value.slice(0, a) + before + mid + after + ta.value.slice(b);
    ta.focus();
    ta.selectionStart = a + before.length;
    ta.selectionEnd = a + before.length + mid.length;
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
})();
