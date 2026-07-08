/* panel: the side panel — breadcrumb, per-construct parameter fields, editable source spans, SVG steps, sibling move/delete */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;
  var TOKEN = RV.token;

  /* --- side panel ---------------------------------------------------------------- */


  function panelEl() {
    var p = document.getElementById('rv-ed-panel');
    if (!p) {
      p = document.createElement('div');
      p.id = 'rv-ed-panel';
      document.body.appendChild(p);
    }
    return p;
  }

  function rvPanelSync() {
    var p = panelEl();
    p.style.display = S.on ? 'flex' : 'none';
    if (!S.on) { S.panelFor = null; return; }
    if (S.sel) S.docSel = false;             // selecting anything exits doc-settings
    var sec = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
    var key = S.docSel ? 'docsettings' : (S.sel || sec);
    if (key === S.panelFor) return;
    S.panelFor = key;
    renderPanel();
  }

  function crumbChain(el) {
    var chain = [];
    var cur = el;
    while (cur && cur.tagName !== 'BODY') {
      if (cur.hasAttribute && cur.hasAttribute('data-rv-src')) chain.unshift(cur);
      cur = cur.parentElement;
    }
    return chain;
  }


  function renderPanel() {
    var p = panelEl();
    if (S.docSel) { renderDocSettings(p); return; }
    var el = S.sel;
    if (!el || !document.contains(el)) {
      var sec = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
      if (sec && sec.hasAttribute('data-rv-src')) {
        // Included slides carry data-rv-src too; renderSlideSource routes the
        // whole-slide edit to the owning file (fileOf(sec)) — no longer
        // read-only (P8).
        renderSlideSource(p, sec);
      } else {
        p.innerHTML =
          '<div class="rv-pn-head">' + RV.esc(RV.t('panel.nothing')) + '</div>' +
          '<div class="rv-pn-hint">' + RV.esc(RV.t('panel.nothingHint')) + '</div>';
        appendPalette(p);
      }
      return;
    }
    var kind = F.constructOf(el) || 'element';
    var s = F.srcOf(el), e = F.srcEndOf(el);
    // The owning file: "" for the main .pres, else an include path. Every
    // read (fetchSrc) and write (rvPostEdit) for this element carries it, so
    // an included element edits ITS file with ITS own line numbers (P8).
    var file = F.fileOf(el);

    var crumbs = crumbChain(el).map(function (c) {
      var label = c === el ? '<b>' + F.kindOf(c) + '</b>' : F.kindOf(c);
      return '<span class="rv-pn-crumb" data-src="' + F.escapeHtml(c.getAttribute('data-rv-src')) + '">' + F.escapeHtml(label) + '</span>';
    }).join(' ▸ ');

    p.innerHTML =
      '<div class="rv-pn-head">' + crumbs + '</div>' +
      '<div class="rv-pn-sub">' +
      (file ? '<span class="rv-pn-file">' + F.escapeHtml(file) + '</span>'
            : F.escapeHtml(RV.PRES_NAME)) +
      ' : ' + s + (e !== s ? '–' + e : '') + '</div>' +
      (kind === 'paragraph' && !el.querySelector('.katex,pre')
        ? '<div class="rv-pn-hint">' + RV.esc(RV.t('panel.dblclickHint')) + '</div>' : '') +
      '<div class="rv-pn-fields"></div>' +
      '<div class="rv-pn-actions">' +
      '<button class="rv-pn-up" title="' + RV.esc(RV.t('panel.upTitle')) + '">' + RV.esc(RV.t('panel.up')) + '</button>' +
      '<button class="rv-pn-down" title="' + RV.esc(RV.t('panel.downTitle')) + '">' + RV.esc(RV.t('panel.down')) + '</button>' +
      '<button class="rv-pn-del" title="' + RV.esc(RV.t('panel.deleteTitle')) + '">' + RV.esc(RV.t('panel.delete')) + '</button>' +
      '</div>' +
      '<div class="rv-pn-srctitle">' + RV.esc(RV.t('panel.source')) + '</div>' +
      '<div class="rv-fmt-slot"></div>' +
      '<textarea class="rv-pn-src" spellcheck="false"></textarea>' +
      '<button class="rv-pn-apply">' + RV.esc(RV.t('panel.apply')) + '</button>' +
      '<div class="rv-pn-foot">' + RV.esc(RV.t('panel.autosave')) + '</div>';
    appendPalette(p);

    p.querySelectorAll('.rv-pn-crumb').forEach(function (c) {
      c.addEventListener('click', function () {
        var slide = Reveal.getCurrentSlide();
        var t = (slide && slide.querySelector('[data-rv-src="' + c.getAttribute('data-src') + '"]')) ||
                document.querySelector('section[data-rv-src="' + c.getAttribute('data-src') + '"]');
        if (t) { RV.set('sel', t); F.syncChrome(); }
      });
    });
    p.querySelector('.rv-pn-up').addEventListener('click', function () { moveSibling(el, -1); });
    p.querySelector('.rv-pn-down').addEventListener('click', function () { moveSibling(el, 1); });
    p.querySelector('.rv-pn-del').addEventListener('click', function () { deleteSelected(el); });

    var slot1 = p.querySelector('.rv-fmt-slot');
    if (slot1) slot1.appendChild(F.formatBar(p.querySelector('.rv-pn-src')));
    // Source box + parameter fields need the actual .pres lines. Apply stays
    // disabled until they arrive, and commits exactly the span it displays.
    var applyBtn = p.querySelector('.rv-pn-apply');
    applyBtn.disabled = true;
    var bounds = null;
    F.fetchSrc(s, e, function (j) {
      if (!j.lines) return;
      var ta = p.querySelector('.rv-pn-src');
      if (ta) ta.value = j.lines.join('\n');
      buildFields(p.querySelector('.rv-pn-fields'), kind, el, j.lines, s, e, file);
      bounds = { start: j.start, end: j.end };
      applyBtn.disabled = false;
    }, file);

    applyBtn.addEventListener('click', function () {
      if (!bounds) return;
      var ta = p.querySelector('.rv-pn-src');
      F.rvPostEdit([{ op: 'replace_lines', start: bounds.start, end: bounds.end, text: ta.value.split('\n') }], file);
    });
  }

  function renderSlideSource(p, sec) {
    var s0 = F.srcOf(sec), e0 = F.srcEndOf(sec);
    var file = F.fileOf(sec);  // an included slide edits its own file (P8)
    p.innerHTML =
      '<div class="rv-pn-head"><b>' + (F.kindOf(sec) === 'slide' ? RV.esc(RV.t('panel.thisSlide')) : F.kindOf(sec)) + '</b>' +
      ' <span class="rv-pn-sub">' +
      (file ? '<span class="rv-pn-file">' + F.escapeHtml(file) + '</span>'
            : F.escapeHtml(RV.PRES_NAME)) +
      ' : ' + s0 + '–' + e0 + '</span></div>' +
      (file ? '<div class="rv-pn-hint">' + RV.t('panel.includedFrom', { file: F.escapeHtml(file) }) + '</div>' : '') +
      '<div class="rv-pn-hint">' + RV.esc(RV.t('panel.slideHint')) + '</div>' +
      '<div class="rv-pn-srctitle">' + RV.esc(RV.t('panel.slideSource')) + '</div>' +
      '<div class="rv-fmt-slot"></div>' +
      '<textarea class="rv-pn-src rv-pn-src-slide" spellcheck="false"></textarea>' +
      '<button class="rv-pn-apply">' + RV.esc(RV.t('panel.apply')) + '</button>' +
      '<div class="rv-pn-foot">' + RV.esc(RV.t('panel.autosave')) + '</div>';
    var slot0 = p.querySelector('.rv-fmt-slot');
    if (slot0) slot0.appendChild(F.formatBar(p.querySelector('.rv-pn-src')));
    var applyBtn0 = p.querySelector('.rv-pn-apply');
    applyBtn0.disabled = true;
    var bounds0 = null;
    F.fetchSrc(s0, e0, function (j) {
      var ta = p.querySelector('.rv-pn-src');
      if (j.lines && ta) ta.value = j.lines.join('\n');
      if (j.lines) {
        bounds0 = { start: j.start, end: j.end };
        applyBtn0.disabled = false;
      }
    }, file);
    applyBtn0.addEventListener('click', function () {
      if (!bounds0) return;
      var ta = p.querySelector('.rv-pn-src');
      F.rvPostEdit([{ op: 'replace_lines', start: bounds0.start, end: bounds0.end, text: ta.value.split('\n') }], file);
    });
    appendPalette(p);
  }


  /* --- document settings (the .pres header block) edited in the panel ------ */

  function renderDocSettings(p) {
    p.innerHTML =
      '<div class="rv-pn-head"><b>' + RV.esc(RV.t('docset.title')) + '</b></div>' +
      '<div class="rv-pn-hint">' + RV.esc(RV.t('docset.hint')) + '</div>' +
      '<div class="rv-pn-srctitle">' + RV.esc(RV.t('panel.source')) + '</div>' +
      '<div class="rv-fmt-slot"></div>' +
      '<textarea class="rv-pn-src rv-pn-src-slide" spellcheck="false"></textarea>' +
      '<button class="rv-pn-apply">' + RV.esc(RV.t('docset.apply')) + '</button>' +
      '<div class="rv-pn-foot">' + RV.esc(RV.t('panel.autosave')) + '</div>';
    var ta = p.querySelector('.rv-pn-src');
    var slot = p.querySelector('.rv-fmt-slot');
    if (slot) slot.appendChild(F.formatBar(ta));
    var applyBtn = p.querySelector('.rv-pn-apply');
    var bounds = null;
    applyBtn.disabled = true;
    // The settings block is the main file's lines before its first slide /
    // include directive. Derive it from the main SOURCE — a DOM section's
    // data-rv-src is file-local when the first slide is itself included, so
    // reading it as a main-file line would edit the wrong span.
    F.fetchSrc(1, 1, function (j0) {
      var total = (j0 && j0.total) || 1;      // the /src endpoint rejects end > total
      F.fetchSrc(1, total, function (j) {
        if (!j.lines || !S.docSel) return;    // panel navigated away
        var lines = j.lines, first = 0;
        for (var i = 0; i < lines.length; i++) {
          if (/^\s*(===|%%%|>>>|>\s*include\s*:)/.test(lines[i])) { first = i + 1; break; }
        }
        if (first > 1) {
          ta.value = lines.slice(0, first - 1).join('\n');
          bounds = { start: 1, end: first - 1 };
        } else {
          ta.placeholder = '> title: My talk\n> author: First author\n> theme: revealer';
        }
        applyBtn.disabled = false;
      });
    });
    applyBtn.addEventListener('click', function () {
      var out = ta.value.split('\n');
      if (bounds) {
        F.rvPostEdit([{ op: 'replace_lines', start: bounds.start, end: bounds.end, text: out }]);
      } else {
        if (!ta.value.replace(/\s/g, '')) return;   // ignore an empty box
        F.rvPostEdit([{ op: 'insert_lines',
          at: { insert_before: 1, container_kind: 'deck' }, text: out.concat(['']) }]);
      }
    });
    appendPalette(p);
  }

  // Entry point (the View ▸ Document source menu / the ⚙ button call this).
  function openDocSettings() {
    S.docSel = true;
    RV.set('sel', null);            // clear any selection (rvPanelSync keeps docSel on a null sel)
    if (!S.on) F.setEdit(true);     // emits 'on' -> rvPanelSync renders doc settings
    S.panelFor = null;
    F.rvPanelSync();
  }

  // Navigating to another slide leaves doc-settings.
  if (window.Reveal && Reveal.on) {
    Reveal.on('slidechanged', function () {
      if (S.docSel) { S.docSel = false; S.panelFor = null; rvPanelSync(); }
    });
  }

  // Preferred category order for the palette; unknown categories append after.
  var PALETTE_ORDER = ['Slides', 'Layout', 'Media', 'Components',
                       'Text & math', 'Fragments', 'Inline format'];
  var CAT_KEY = {
    'Slides': 'cheat.slides', 'Layout': 'cheat.layout', 'Media': 'cheat.media',
    'Components': 'cheat.components', 'Text & math': 'cheat.textMath',
    'Fragments': 'cheat.fragments', 'Inline format': 'cheat.inlineFormat',
  };

  // Merge staticCheat + every construct's cheat into {category: [[chip, insert]]}.
  function paletteGroups() {
    if (!RV.schema) return null;
    var groups = {};
    function add(e) { (groups[e[0]] = groups[e[0]] || []).push([e[1], e[2]]); }
    (RV.schema.staticCheat || []).forEach(add);
    var cons = RV.schema.constructs || {};
    Object.keys(cons).forEach(function (n) { (cons[n].cheat || []).forEach(add); });
    return groups;
  }

  // Drop a snippet into the panel's source box at the caret, else append it as
  // a new block on the current slide.
  function paletteInsert(insert) {
    var ta = document.querySelector('#rv-ed-panel .rv-pn-src');
    if (ta) { F.insertAtCursor(ta, insert); return; }
    var sec = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
    if (!sec || !sec.hasAttribute('data-rv-src')) { F.toast(RV.t('palette.needTarget')); return; }
    F.rvPostEdit([{ op: 'insert_lines',
      at: { insert_before: F.srcEndOf(sec) + 1, container_kind: 'deck' },
      text: insert.replace(/\n+$/, '').split('\n') }], F.fileOf(sec));
  }

  function appendPalette(p) {
    var groups = paletteGroups();
    if (!groups) return;                       // schema not loaded yet
    var cats = PALETTE_ORDER.filter(function (c) { return groups[c]; })
      .concat(Object.keys(groups).filter(function (c) { return PALETTE_ORDER.indexOf(c) < 0; }));
    var d = document.createElement('details');
    d.className = 'rv-pn-cheat';
    var html = '<summary>' + RV.esc(RV.t('panel.cheatsheet')) + '</summary>' +
      '<div class="rv-pl-hint">' + RV.esc(RV.t('palette.hint')) + '</div>';
    cats.forEach(function (cat) {
      var label = CAT_KEY[cat] ? RV.t(CAT_KEY[cat]) : cat;
      html += '<div class="rv-pl-sec"><b>' + RV.esc(label) + '</b><div class="rv-pl-chips">' +
        groups[cat].map(function (ci, i) {
          return '<button class="rv-pl-chip" data-cat="' + RV.esc(cat) +
                 '" data-i="' + i + '">' + RV.esc(ci[0]) + '</button>';
        }).join('') +
        (cat === 'Fragments'
          ? '<button class="rv-pl-chip rv-pl-wrap" data-wrap="1">' +
            RV.esc(RV.t('palette.wrapFrag')) + '</button>' : '') +
        '</div></div>';
    });
    d.innerHTML = html;
    try { d.open = localStorage.getItem('rv-ed-cheat') === '1'; } catch (e) {}
    d.addEventListener('toggle', function () {
      try { localStorage.setItem('rv-ed-cheat', d.open ? '1' : '0'); } catch (e) {}
    });
    d.querySelectorAll('.rv-pl-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-wrap')) {
          var ta = document.querySelector('#rv-ed-panel .rv-pn-src');
          if (ta) F.wrapFragBlock(ta); else F.toast(RV.t('palette.needTarget'));
          return;
        }
        paletteInsert(groups[btn.getAttribute('data-cat')][+btn.getAttribute('data-i')][1]);
      });
    });
    p.appendChild(d);
  }

  /* --- parameter fields -------------------------------------------------------------- */

  function fld(label, value, hint) {
    return '<label class="rv-pn-fld"><span>' + label + '</span>' +
      '<input type="text" value="' + (value == null ? '' : F.escapeHtml(value)) + '"' +
      (hint ? ' placeholder="' + F.escapeHtml(hint) + '"' : '') + '></label>';
  }

  function tokensOf(line, headRe) {
    var m = line.match(headRe);
    return m ? m[1].trim().split(/\s+/).filter(Boolean) : [];
  }

  function findToken(tokens, re) {
    for (var i = 0; i < tokens.length; i++) {
      var m = tokens[i].match(re);
      if (m) return m;
    }
    return null;
  }

  function buildFields(box, kind, el, lines, s, e, file) {
    if (!box) return;
    file = file || '';
    var line0 = lines[0] || '';
    var defs = [];  // {label, value, apply(newValue) -> op or null}

    function fragDef(construct) {
      var toks = tokensOf(line0, /^\s*>?\s*\S+(.*)$/) ;
      var fm = findToken(toks, /^\+(\d+)?$/);
      defs.push({
        label: RV.t('field.fragIndex'), value: fm ? (fm[1] || '+') : '',
        apply: function (v) {
          if (v === '') return null;
          return { op: 'set_fragment_index', line: s, construct: construct,
                   index: v === '+' ? null : parseInt(v, 10) };
        },
      });
    }

    if (kind === 'pin') {
      var nums = (line0.match(/pin\s*:\s*(.*)$/) || ['', ''])[1]
        .replace('+', ' ').trim().split(/\s+/).filter(Boolean);
      defs.push({ label: RV.t('field.x'), value: nums[0] || '50%', apply: pinApply(0, nums, s) });
      defs.push({ label: RV.t('field.y'), value: nums[1] || '50%', apply: pinApply(1, nums, s) });
      defs.push({ label: RV.t('field.width'), value: nums[2] || '', apply: pinApply(2, nums, s) });
    } else if (kind === 'media') {
      var toks = tokensOf(line0, /^\s*!{1,2}\s+\S+(.*?)(?:\|.*)?$/);
      var h = findToken(toks, /^h=(.+)$/i), w = findToken(toks, /^w=(.+)$/i);
      defs.push({ label: RV.t('field.height'), value: h ? h[1] : '',
        apply: function (v) { return { op: 'set_media_size', line: s, dim: 'h', value: v || null }; } });
      defs.push({ label: RV.t('field.width'), value: w ? w[1] : '',
        apply: function (v) { return { op: 'set_media_size', line: s, dim: 'w', value: v || null }; } });
      fragDef('media');
    } else if (kind === 'row') {
      var toks2 = tokensOf(line0, /^\s*>\s*row\b(.*)$/);
      var h2 = findToken(toks2, /^h=(\d+)/i);
      var gap = toks2.filter(function (t) { return !/^h=/i.test(t) && !/^\+\d*$/.test(t); })[0];
      defs.push({ label: RV.t('field.heightPx'), value: h2 ? h2[1] : '',
        apply: function (v) { return { op: 'set_row_height', line: s, value: v ? parseInt(v, 10) : null }; } });
      defs.push({ label: RV.t('field.gap'), value: gap || '',
        apply: function (v) { return v ? { op: 'set_row_gap', line: s, value: v } : null; } });
    } else if (kind === 'stack') {
      var h3 = findToken(tokensOf(line0, /^\s*>\s*stack\b(.*)$/), /^h=(\d+)/i);
      defs.push({ label: RV.t('field.heightPx'), value: h3 ? h3[1] : '',
        apply: function (v) { return { op: 'set_stack_height', line: s, value: v ? parseInt(v, 10) : null }; } });
    } else if (kind === 'region') {
      var toks3 = tokensOf(line0, /^\s*>\s*col\b(.*)$/);
      var size = toks3.filter(function (t) {
        return !/^\+\d*$/.test(t) && ['center', 'relative', 'clip'].indexOf(t.toLowerCase()) === -1;
      })[0];
      defs.push({ label: RV.t('field.colSize'), value: size || '',
        apply: function (v) { return { op: 'set_col_size', line: s, new: v || null }; } });
      fragDef('col');
    } else if (kind === 'grid') {
      var gapLine = null;
      for (var i = 1; i < lines.length; i++) {
        var gm = lines[i].match(/^\s*>\s*gap\s*:\s*(.*)$/);
        if (gm) { gapLine = gm[1]; break; }
      }
      defs.push({ label: RV.t('field.gap'), value: gapLine || '',
        apply: function (v) { return v ? { op: 'set_grid_gap', line: s, end: e, value: v } : null; } });
    } else if (kind === 'card') {
      fragDef('card');
    } else if (kind === 'layer') {
      fragDef('layer');
    } else if (kind === 'box') {
      fragDef('box');
    } else if (kind === 'eq') {
      fragDef('eq');
    } else if (kind === 'frag') {
      fragDef('frag');
    } else if (kind === 'svg') {
      buildSvgSteps(box, el, s, file);
      return;
    } else if (kind === 'column') {
      var wm = line0.match(/^\s*\|{1,2}\s*(.*)$/);
      defs.push({ label: RV.t('field.width'), value: wm ? wm[1] : '',
        apply: function (v) { return { op: 'set_block_width', line: s, new: v || null }; } });
    }

    box.innerHTML = defs.length
      ? defs.map(function (d, i) { return fld(d.label, d.value).replace('<label', '<label data-i="' + i + '"'); }).join('')
      : '<div class="rv-pn-hint">' + RV.esc(RV.t('panel.noParams')) + '</div>';

    box.querySelectorAll('.rv-pn-fld input').forEach(function (input) {
      var def = defs[parseInt(input.parentElement.getAttribute('data-i'), 10)];
      function commit() {
        var op = def.apply(input.value.trim());
        if (op) F.rvPostEdit([op], file);
      }
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { commit(); ev.preventDefault(); }
        ev.stopPropagation();
      });
      input.addEventListener('change', commit);
    });
  }

  var SVG_ANIM_RE = /^>\s*animate\s*:\s*#([\w-]+)\s+opacity:1\s*(?:@.*)?$/;
  var SVG_HIDE_RE = /^>\s*hide\s*:\s*(.*)$/;
  var SVG_BLOCK_RE = /^>\s*(hide|animate)\s*:/;

  function buildSvgSteps(box, el, svgLine, file) {
    file = file || '';
    var ids = [];
    el.querySelectorAll('svg [id]').forEach(function (n) {
      if (ids.length < 40 && n.id) ids.push({ id: n.id, node: n });
    });
    if (!ids.length) {
      box.innerHTML = '<div class="rv-pn-hint">' + RV.esc(RV.t('panel.svgNoIds')) + '</div>';
      return;
    }
    var sec = Reveal.getCurrentSlide();
    fetch('/__rv__/src?start=' + F.srcOf(sec) + '&end=' + F.srcEndOf(sec) +
          '&token=' + encodeURIComponent(TOKEN) +
          (file ? '&file=' + encodeURIComponent(file) : ''))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.lines || !document.contains(box)) return;  // panel re-rendered
        var base = F.srcOf(sec);
        var rel = svgLine - base;           // index of `> svg:` in j.lines
        var end = rel;
        var hidden = {}, step = {}, order = 0, preserved = [];
        for (var k = rel + 1; k < j.lines.length && SVG_BLOCK_RE.test(j.lines[k]); k++) {
          end = k;
          var hm = j.lines[k].match(SVG_HIDE_RE);
          var am = j.lines[k].match(SVG_ANIM_RE);
          if (hm) {
            hm[1].split(',').forEach(function (x) { hidden[x.trim().replace('#', '')] = 1; });
          } else if (am) {
            step[am[1]] = ++order;
          } else {
            preserved.push(j.lines[k]);
          }
        }
        box.innerHTML = '<div class="rv-pn-hint">' + RV.esc(RV.t('panel.svgSteps')) + '</div>' +
          ids.map(function (it, i) {
            var cur = step[it.id] || '';
            return '<label class="rv-pn-fld" data-id="' + F.escapeHtml(it.id) + '"><span>#' + F.escapeHtml(it.id) +
              '</span><select>' + ['<option value="">–</option>'].concat(
                [1,2,3,4,5,6,7,8].map(function (n) {
                  return '<option value="' + n + '"' + (cur === n ? ' selected' : '') +
                    '>' + RV.esc(RV.t('panel.svgStep', { n: n })) + '</option>';
                })).join('') + '</select></label>';
          }).join('') +
          '<button class="rv-pn-svgapply">' + RV.esc(RV.t('panel.svgApply')) + '</button>';
        box.querySelectorAll('.rv-pn-fld').forEach(function (row) {
          var node = el.querySelector('svg [id="' + row.getAttribute('data-id') + '"]');
          row.addEventListener('mouseenter', function () { S.hover = node; F.syncChrome(); });
          row.addEventListener('mouseleave', function () { S.hover = null; F.syncChrome(); });
        });
        box.querySelector('.rv-pn-svgapply').addEventListener('click', function () {
          var chosen = [];
          box.querySelectorAll('.rv-pn-fld').forEach(function (row) {
            var v = row.querySelector('select').value;
            if (v) chosen.push({ id: row.getAttribute('data-id'), n: parseInt(v, 10) });
          });
          chosen.sort(function (a, b) { return a.n - b.n; });
          var block = [j.lines[rel]];
          if (chosen.length) {
            block.push('> hide: ' + chosen.map(function (c) { return '#' + c.id; }).join(','));
            chosen.forEach(function (c) { block.push('> animate: #' + c.id + ' opacity:1'); });
          }
          preserved.forEach(function (ln) { block.push(ln); });
          F.rvPostEdit([{ op: 'replace_lines', start: svgLine, end: base + end, text: block }], file);
        });
      });
  }

  function pinApply(idx, nums, line) {
    return function (v) {
      var parts = nums.slice();
      parts[idx] = v;
      var op = { op: 'set_pin', line: line, x: parts[0] || '50%', y: parts[1] || '50%' };
      if (parts[2]) op.w = parts[2];
      return op;
    };
  }

  /* --- sibling move / delete ------------------------------------------------------------ */

  function containerOf(el) {
    var cur = el.parentElement;
    while (cur && cur.tagName !== 'SECTION') {
      if (cur.hasAttribute && cur.hasAttribute('data-rv-src') &&
          (F.hasCls(cur, 'region') || F.hasCls(cur, 'column') || F.hasCls(cur, 'rv-card') ||
           F.hasCls(cur, 'rv-cell') || F.hasCls(cur, 'rv-layer'))) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function moveSibling(el, dir) {
    var parent = el.parentElement;
    var mine = F.mappedChildren(parent);
    var i = mine.indexOf(el);
    var target = mine[i + dir];
    if (!target) { F.toast(dir < 0 ? RV.t('toast.atTop') : RV.t('toast.atBottom')); return; }
    var container = containerOf(el);
    var cSpan = container ? [F.srcOf(container), F.srcEndOf(container)]
                          : [F.srcOf(el), F.srcEndOf(target)];
    var kindC = container && F.hasCls(container, 'column') ? 'column' : 'col';
    var construct = F.constructOf(el);
    // Siblings share a slide, hence a file: an intra-include move is a
    // single-file structural op (P8) — its spans are file-local already.
    F.rvPostEdit([{
      op: 'move_block',
      src: [F.srcOf(el), F.srcEndOf(el)],
      construct: RV.MOVABLE[construct] ? construct : 'paragraph',
      dest: {
        insert_before: dir < 0 ? F.srcOf(target) : F.srcEndOf(target) + 1,
        container: cSpan,
        container_kind: kindC,
      },
    }], F.fileOf(el));
  }

  function deleteSelected(el) {
    var construct = F.constructOf(el);
    if (!el.hasAttribute('data-rv-src') || el.tagName === 'SECTION') {
      F.toast(RV.t('toast.selectToDelete'));
      return;
    }
    F.toast(RV.t('toast.deleted', { kind: F.kindOf(el) }));
    var file = F.fileOf(el);
    RV.set('sel', null);
    F.rvPostEdit([{
      op: 'delete_block',
      src: [F.srcOf(el), F.srcEndOf(el)],
      construct: RV.MOVABLE[construct] ? construct : 'paragraph',
    }], file);
  }

  // exports (what other editor/ modules call):
  F.rvPanelSync = rvPanelSync;
  F.appendPalette = appendPalette;
  F.openDocSettings = openDocSettings;
  RV.onChange('on', rvPanelSync);
  RV.onChange('sel', rvPanelSync);
  F.deleteSelected = deleteSelected;
  F.containerOf = containerOf;
})();
