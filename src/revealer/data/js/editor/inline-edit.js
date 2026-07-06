/* inline-edit: double-click in-place paragraph editing (contenteditable) —
 * reverse-renders the edited DOM back to DSL source and posts replace_lines. */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;

  /* --- reverse renderer: rendered DOM -> DSL source ------------------------------
     The inverse of build.py's _inline_md for the vocabulary the format tools
     write: b/strong, i/em, code, a[href], span{.role|color=|size=}. Text
     escapes the marker chars (* ` [) so literal markers survive the round
     trip; '\n' text characters ARE the multi-line structure (paragraph
     bodies join source lines with a newline text node, never <br>).
     Anything else — <br>, <div> from rich paste, <u>, unknown attributes —
     returns null: the caller must refuse the commit and restore the DOM
     rather than write back a lossy approximation. */

  function reverseRender(el) {
    var out = '';
    for (var n = el.firstChild; n; n = n.nextSibling) {
      var piece = reverseNode(n);
      if (piece === null) return null;
      out += piece;
    }
    return out;
  }

  function reverseNode(n) {
    if (n.nodeType === 3) return n.nodeValue.replace(/([*`[])/g, '\\$1');
    if (n.nodeType !== 1) return '';  // comments render to nothing
    var inner = reverseRender(n);
    if (inner === null) return null;
    var tag = n.tagName;
    if (tag === 'B' || tag === 'STRONG') return wrapTight('**', inner);
    if (tag === 'I' || tag === 'EM') return wrapTight('*', inner);
    if (tag === 'CODE') return inner ? '`' + inner + '`' : null;
    if (tag === 'A') return reverseLink(n, inner);
    if (tag === 'SPAN') return reverseSpan(n, inner);
    return null;
  }

  // **x** / *x* only re-render with non-space edges (the _MD_BOLD/ITAL_RE
  // grammar), so looser content cannot be written back faithfully.
  function wrapTight(marker, inner) {
    if (!inner || /^\s|\s$/.test(inner)) return null;
    return marker + inner + marker;
  }

  // [text](url): the renderer only ever adds target="_blank"; the url must
  // match the DSL's ([^()\s]+) and the text must stay ]-free (']' has no
  // escape in the DSL — over-strict for nested spans, which is safe).
  function reverseLink(n, inner) {
    for (var i = 0; i < n.attributes.length; i++) {
      var a = n.attributes[i].name;
      if (a !== 'href' && a !== 'target') return null;
    }
    var href = n.getAttribute('href') || '';
    if (!/^[^()\s]+$/.test(href)) return null;
    if (!inner || inner.indexOf(']') !== -1) return null;
    return '[' + inner + '](' + href + ')';
  }

  // [text]{.role color=C size=S} — exactly the attrs _md_span_sub emits.
  function reverseSpan(n, inner) {
    for (var i = 0; i < n.attributes.length; i++) {
      var a = n.attributes[i].name;
      if (a !== 'class' && a !== 'style') return null;
    }
    var toks = [];
    var classes = (n.getAttribute('class') || '').split(/\s+/);
    for (i = 0; i < classes.length; i++) {
      if (!classes[i]) continue;
      if (!/^[A-Za-z][\w-]*$/.test(classes[i])) return null;
      toks.push('.' + classes[i]);
    }
    var decls = (n.getAttribute('style') || '').split(';');
    for (i = 0; i < decls.length; i++) {
      var d = decls[i].trim();
      if (!d) continue;
      var m = d.match(/^(color|font-size)\s*:\s*(.+)$/i);
      if (!m || !/^[^\s{}]+$/.test(m[2].trim())) return null;
      toks.push((m[1].toLowerCase() === 'color' ? 'color=' : 'size=') + m[2].trim());
    }
    if (!toks.length) return null;  // a bare <span> is not expressible
    if (!inner || inner.indexOf(']') !== -1) return null;
    return '[' + inner + ']{' + toks.join(' ') + '}';
  }

  /* --- the editing session ---------------------------------------------------- */

  var editing = null;  // {el, s, e, html} while a paragraph is contenteditable

  // Math and code paragraphs stay source-box-edited; everything the reverse
  // renderer cannot express (bullets, media, raw html…) is refused up front
  // so the user never loses typing to an uncommittable session.
  function eligible(para) {
    if (!para || para.closest('[data-rv-inc]')) return false;
    if (para.querySelector('.katex,pre')) return false;
    return reverseRender(para) !== null;
  }

  document.addEventListener('dblclick', function (ev) {
    if (!S.on || editing) return;
    var t = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target && ev.target.parentElement;
    var para = t && t.closest ? t.closest('.rv-paragraph[data-rv-src]') : null;
    if (!para) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (!eligible(para)) {
      F.toast('This paragraph can’t be edited in place — use the panel');
      return;
    }
    var s = F.srcOf(para);
    var e = F.srcEndOf(para);
    F.rvInspect(s, e).then(function (insp) {
      if (editing || !S.on || !document.contains(para)) return;
      var ok = !!insp;
      for (var i = 0; ok && i < insp.length; i++) {
        if (!insp[i].segments) ok = false;
        for (var k = 0; ok && k < insp[i].segments.length; k++) {
          if (insp[i].segments[k][3] === 'math-opaque') ok = false;
        }
      }
      if (!ok) {
        F.toast('This paragraph can’t be edited in place — use the panel');
        return;
      }
      begin(para, s, e);
    });
  }, true);

  function begin(para, s, e) {
    editing = { el: para, s: s, e: e, html: para.innerHTML };
    F.hideTextBubble();
    para.classList.add('rv-ed-editing');
    para.setAttribute('contenteditable', 'true');
    para.addEventListener('keydown', onKey);
    para.addEventListener('blur', onBlur);
    para.focus();
  }

  // Tear down listeners BEFORE touching attributes: removing contenteditable
  // drops focus, and that blur must not re-enter commit().
  function finish() {
    var ed = editing;
    editing = null;
    ed.el.removeEventListener('keydown', onKey);
    ed.el.removeEventListener('blur', onBlur);
    ed.el.removeAttribute('contenteditable');
    ed.el.classList.remove('rv-ed-editing');
    return ed;
  }

  function onBlur() { commit(); }

  // The consolidated chrome.js handler already ignores contenteditable
  // targets; this local listener adds the session keys and keeps everything
  // else from reaching other document-level listeners.
  function onKey(ev) {
    ev.stopPropagation();
    if (ev.key === 'Escape') {
      ev.preventDefault();
      cancel();
    } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      commit();
    } else if (ev.key === 'Enter') {
      // Enter would insert <div>/<br>, which cannot be written back; the
      // '\n' line joints of a multi-line paragraph are preserved as-is.
      ev.preventDefault();
      F.toast('Line breaks can’t be added here — use the panel');
    }
  }

  function cancel() {
    if (!editing) return;
    var ed = finish();
    ed.el.innerHTML = ed.html;
    F.toast('Edit cancelled');
  }

  function commit() {
    if (!editing) return;
    var ed = finish();
    if (ed.el.innerHTML === ed.html) return;  // untouched — nothing to save
    var src = reverseRender(ed.el);
    if (src === null) {
      ed.el.innerHTML = ed.html;
      F.toast('That formatting can’t be written back — use the panel');
      return;
    }
    src = src.replace(/\n+$/, '');  // paragraph bodies carry a trailing '\n'
    if (!src.replace(/\s/g, '')) {
      ed.el.innerHTML = ed.html;
      F.toast('Empty paragraph — use Delete to remove it instead');
      return;
    }
    F.rvPostEdit([{ op: 'replace_lines', start: ed.s, end: ed.e,
                    text: src.split('\n') }]);
  }

  // exports (what other editor/ modules call):
  F.reverseRender = reverseRender;
})();
