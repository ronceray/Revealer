/* textsel: the selection bubble — maps rendered-text selections back to
 * source columns via /__rv__/inspect and posts wrap_span format ops. */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;
  var TOKEN = RV.token;

  /* --- /__rv__/inspect fetches, cached per span -------------------------------
     The cache lives with the page: every landed edit reloads the deck, so an
     entry can never outlive the DOM it describes. A page that went stale
     against the disk (edit landed, reload still deferred) is caught by the
     server's sha precondition when the wrap_span posts. */
  var inspectCache = {};

  function rvInspect(start, end) {
    var key = start + '-' + end;
    if (!inspectCache[key]) {
      inspectCache[key] = fetch('/__rv__/inspect?start=' + start + '&end=' + end +
                                '&token=' + encodeURIComponent(TOKEN))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return (j && j.lines) || null; })
        .catch(function () { return null; });
    }
    return inspectCache[key];
  }

  /* --- DOM line model ----------------------------------------------------------
     Paragraph bodies render as `line1\nline2\n…`: every plain source line is
     followed by ONE newline TEXT character (build.py appends "\n" only on
     default text lines). Lines that took any other branch (bullets, code
     fences, media, directives) break that invariant, so requiring exactly
     span-many '\n'-terminated DOM lines that byte-match the inspect segments
     rejects every construct the map cannot vouch for. KaTeX output (.katex
     subtrees) and injected <style>/<script> text are invisible to the model —
     a math-opaque segment renders to zero counted characters once KaTeX ran. */

  function unCounted(node, para) {
    for (var el = node.parentElement; el && el !== para; el = el.parentElement) {
      if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') return true;
      if (el.classList && el.classList.contains('katex')) return true;
    }
    return false;
  }

  function domLineModel(para) {
    var walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, null);
    var entries = [];
    var lines = [''];
    var node;
    while ((node = walker.nextNode())) {
      var en = { node: node, counted: !unCounted(node, para) };
      if (en.counted) {
        en.line0 = lines.length - 1;
        en.off0 = lines[lines.length - 1].length;
        var text = node.nodeValue;
        for (var i = 0; i < text.length; i++) {
          if (text[i] === '\n') lines.push('');
          else lines[lines.length - 1] += text[i];
        }
      }
      entries.push(en);
    }
    return { entries: entries, lines: lines };
  }

  // (Text node, offset) -> {line, off} in visible-text coordinates, or null
  // when the endpoint sits inside KaTeX/style output.
  function posOf(model, node, offset) {
    for (var i = 0; i < model.entries.length; i++) {
      var en = model.entries[i];
      if (en.node !== node) continue;
      if (!en.counted) return null;
      var line = en.line0;
      var off = en.off0;
      var text = node.nodeValue;
      for (var k = 0; k < offset && k < text.length; k++) {
        if (text[k] === '\n') { line += 1; off = 0; }
        else off += 1;
      }
      return { line: line, off: off };
    }
    return null;
  }

  function expectedVisible(segments) {
    var out = '';
    for (var i = 0; i < segments.length; i++) {
      if (segments[i][3] === 'text') out += segments[i][2];
    }
    return out;
  }

  // Visible-offset range -> source columns. v1 rule: both endpoints must fall
  // inside ONE text segment whose rendered text equals its source slice (no
  // escapes inside), so the wrap_span columns are exact by construction.
  function mapCols(segments, lineText, a, b) {
    var cur = 0;
    for (var i = 0; i < segments.length; i++) {
      var sg = segments[i];
      var len = sg[3] === 'text' ? sg[2].length : 0;
      if (sg[3] === 'text' && a >= cur && a < cur + len) {
        if (b > cur + len) return null;                           // crosses formatting
        if (lineText.slice(sg[0], sg[1]) !== sg[2]) return null;  // escapes inside
        return { start_col: sg[0] + (a - cur), end_col: sg[0] + (b - cur) };
      }
      cur += len;
    }
    return null;
  }

  // Full pipeline; returns {line, start_col, end_col} or a refusal reason.
  function mapSelection(para, insp, range) {
    for (var i = 0; i < insp.length; i++) {
      if (!insp[i].segments) return 'unmapped';
    }
    var model = domLineModel(para);
    if (model.lines.length !== insp.length + 1 ||
        model.lines[insp.length] !== '') return 'structure';
    for (i = 0; i < insp.length; i++) {
      if (model.lines[i] !== expectedVisible(insp[i].segments)) return 'structure';
    }
    var a = posOf(model, range.startContainer, range.startOffset);
    var b = posOf(model, range.endContainer, range.endOffset);
    if (!a || !b) return 'opaque';
    if (a.line !== b.line) return 'multiline';
    if (a.off >= b.off) return 'collapsed';
    var cols = mapCols(insp[a.line].segments, insp[a.line].text, a.off, b.off);
    if (!cols) return 'crossing';
    return { line: insp[a.line].line,
             start_col: cols.start_col, end_col: cols.end_col };
  }

  /* --- the bubble --------------------------------------------------------------
     Wrappers mirror format.js exactly: the same markers land in the source
     whether the user works the panel textarea or the rendered text. */

  var armed = null;        // {line, start_col, end_col} behind the visible bubble
  var crossToasted = false;
  var debounceT = null;

  function bubbleEl() {
    var el = document.getElementById('rv-ed-bubble');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'rv-ed-bubble';
    var root = getComputedStyle(document.documentElement);
    el.innerHTML =
      '<button data-b="**" data-a="**" title="bold"><b>B</b></button>' +
      '<button data-b="*" data-a="*" title="italic"><i>I</i></button>' +
      '<button data-b="`" data-a="`" title="code">&lt;&gt;</button>' +
      RV.PALETTE.map(function (c) {
        return '<button class="rv-fmt-sw" data-b="[" data-a="]{.' + c[0] + '}" title="' + c[0] +
          '" style="background:' + F.escapeHtml(root.getPropertyValue(c[1]).trim() || '#888') + '"></button>';
      }).join('') +
      '<button class="rv-bb-size" data-b="[" data-a="]{.lede}" title="larger (lede)">lede</button>' +
      '<button class="rv-bb-size" data-b="[" data-a="]{.sm}" title="smaller (sm)">sm</button>';
    // mousedown must not steal the document selection the bubble acts on
    el.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    el.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        var op = armed && { op: 'wrap_span', line: armed.line,
                            start_col: armed.start_col, end_col: armed.end_col,
                            before: b.getAttribute('data-b'),
                            after: b.getAttribute('data-a') };
        hideBubble();
        if (!op) return;
        try { document.getSelection().removeAllRanges(); } catch (e) {}
        F.rvPostEdit([op]);
      });
    });
    document.body.appendChild(el);
    return el;
  }

  function hideBubble() {
    armed = null;
    var el = document.getElementById('rv-ed-bubble');
    if (el) el.style.display = 'none';
  }

  function showBubble(range, mapped) {
    armed = mapped;
    var el = bubbleEl();
    el.style.display = 'flex';
    var r = range.getBoundingClientRect();
    var left = Math.max(8, Math.min(r.left + r.width / 2 - el.offsetWidth / 2,
                                    window.innerWidth - el.offsetWidth - 8));
    var top = r.top - el.offsetHeight - 8;
    if (top < 8) top = r.bottom + 8;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function paraOf(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el && el.closest ? el.closest('.rv-paragraph[data-rv-src]') : null;
  }

  function evaluate() {
    if (!S.on || S.drag || S.dropState) return hideBubble();
    var sel = document.getSelection();
    if (!sel || sel.rangeCount < 1 || sel.isCollapsed) return hideBubble();
    var range = sel.getRangeAt(0);
    if (range.startContainer.nodeType !== 3 ||
        range.endContainer.nodeType !== 3) return hideBubble();
    var para = paraOf(range.commonAncestorContainer);
    if (!para || para.isContentEditable ||
        para.closest('[data-rv-inc]')) return hideBubble();
    rvInspect(F.srcOf(para), F.srcEndOf(para)).then(function (insp) {
      if (!insp || !S.on || S.drag) return hideBubble();
      // the fetch was async: remap against the selection as it is NOW
      var sel2 = document.getSelection();
      if (!sel2 || sel2.rangeCount < 1 || sel2.isCollapsed) return hideBubble();
      var range2 = sel2.getRangeAt(0);
      if (paraOf(range2.commonAncestorContainer) !== para) return hideBubble();
      var mapped = mapSelection(para, insp, range2);
      if (typeof mapped === 'string') {
        hideBubble();
        if (mapped === 'crossing' && !crossToasted) {
          crossToasted = true;
          F.toast('Selection crosses formatting — use the panel to edit');
        }
        return;
      }
      showBubble(range2, mapped);
    });
  }

  document.addEventListener('selectionchange', function () {
    if (!S.on) return;
    clearTimeout(debounceT);
    debounceT = setTimeout(evaluate, 120);
  });
  document.addEventListener('pointerdown', function (ev) {
    var el = document.getElementById('rv-ed-bubble');
    if (el && el.style.display !== 'none' && !el.contains(ev.target)) hideBubble();
  }, true);
  window.addEventListener('scroll', hideBubble, true);
  RV.onChange('on', function (on) { if (!on) hideBubble(); });
  if (window.Reveal && Reveal.on) Reveal.on('slidechanged', hideBubble);

  // exports (what other editor/ modules call):
  F.rvInspect = rvInspect;
  F.hideTextBubble = hideBubble;
})();
