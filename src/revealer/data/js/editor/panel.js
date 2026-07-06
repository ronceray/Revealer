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
    var sec = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
    var key = S.sel || sec;
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
    var el = S.sel;
    if (!el || !document.contains(el)) {
      var sec = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
      if (sec && sec.hasAttribute('data-rv-src')) {
        renderSlideSource(p, sec);
      } else if (sec && sec.hasAttribute('data-rv-inc')) {
        p.innerHTML =
          '<div class="rv-pn-head">Included slide</div>' +
          '<div class="rv-pn-hint">This slide comes from <code>' +
          RV.esc(sec.getAttribute('data-rv-inc')) +
          '</code> — edit that file; it is read-only here.</div>';
        appendCheatsheet(p);
      } else {
        p.innerHTML =
          '<div class="rv-pn-head">Nothing selected</div>' +
          '<div class="rv-pn-hint">Click an element in the slide to inspect and edit it.</div>';
        appendCheatsheet(p);
      }
      return;
    }
    var kind = F.constructOf(el) || 'element';
    var s = F.srcOf(el), e = F.srcEndOf(el);

    var crumbs = crumbChain(el).map(function (c) {
      var label = c === el ? '<b>' + F.kindOf(c) + '</b>' : F.kindOf(c);
      return '<span class="rv-pn-crumb" data-src="' + F.escapeHtml(c.getAttribute('data-rv-src')) + '">' + F.escapeHtml(label) + '</span>';
    }).join(' ▸ ');

    p.innerHTML =
      '<div class="rv-pn-head">' + crumbs + '</div>' +
      '<div class="rv-pn-sub">' + F.escapeHtml(RV.PRES_NAME) + ' : ' + s + (e !== s ? '–' + e : '') + '</div>' +
      (kind === 'paragraph' && !el.querySelector('.katex,pre')
        ? '<div class="rv-pn-hint">Double-click the paragraph to edit its text in place.</div>' : '') +
      '<div class="rv-pn-fields"></div>' +
      '<div class="rv-pn-actions">' +
      '<button class="rv-pn-up" title="Move before the previous sibling">▲ Up</button>' +
      '<button class="rv-pn-down" title="Move after the next sibling">▼ Down</button>' +
      '<button class="rv-pn-del" title="Delete this block from the .pres (Del)">🗑 Delete</button>' +
      '</div>' +
      '<div class="rv-pn-srctitle">Source (editable)</div>' +
      '<div class="rv-fmt-slot"></div>' +
      '<textarea class="rv-pn-src" spellcheck="false"></textarea>' +
      '<button class="rv-pn-apply">Apply source</button>' +
      '<div class="rv-pn-foot">Changes save automatically to the .pres — no save button needed.</div>';
    appendCheatsheet(p);

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
      buildFields(p.querySelector('.rv-pn-fields'), kind, el, j.lines, s, e);
      bounds = { start: j.start, end: j.end };
      applyBtn.disabled = false;
    });

    applyBtn.addEventListener('click', function () {
      if (!bounds) return;
      var ta = p.querySelector('.rv-pn-src');
      F.rvPostEdit([{ op: 'replace_lines', start: bounds.start, end: bounds.end, text: ta.value.split('\n') }]);
    });
  }

  function renderSlideSource(p, sec) {
    var s0 = F.srcOf(sec), e0 = F.srcEndOf(sec);
    p.innerHTML =
      '<div class="rv-pn-head"><b>' + (F.kindOf(sec) === 'slide' ? 'This slide' : F.kindOf(sec)) + '</b>' +
      ' <span class="rv-pn-sub">' + F.escapeHtml(RV.PRES_NAME) + ' : ' + s0 + '–' + e0 + '</span></div>' +
      '<div class="rv-pn-hint">Click an element for its parameters, or edit the whole slide here.</div>' +
      '<div class="rv-pn-srctitle">Slide source (editable)</div>' +
      '<div class="rv-fmt-slot"></div>' +
      '<textarea class="rv-pn-src rv-pn-src-slide" spellcheck="false"></textarea>' +
      '<button class="rv-pn-apply">Apply source</button>' +
      '<div class="rv-pn-foot">Changes save automatically to the .pres — no save button needed.</div>';
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
    });
    applyBtn0.addEventListener('click', function () {
      if (!bounds0) return;
      var ta = p.querySelector('.rv-pn-src');
      F.rvPostEdit([{ op: 'replace_lines', start: bounds0.start, end: bounds0.end, text: ta.value.split('\n') }]);
    });
    appendCheatsheet(p);
  }


  var CHEATSHEET = [
    ['Slides', ['=== Slide title', '--- vertical sub-slide', '%%% Section divider',
                '>>> first: Deck title', '>>> biblio']],
    ['Layout', ['> fill', '> row h=400 24px', '> col 2/5 center', '> end: row',
                '|| 40%   (text columns)', '| 55%', '||']],
    ['Media', ['! img.png fill h=200px +2 | caption', '!! movie.mp4 loop',
               'flags: fill contain cover top h= w= + +N']],
    ['Components', ['> info Title … > end: info', '> warn / > good', '> eq +  … > end: eq',
                    '> grid(2,2) compact / > card +', '> stack h=300 / > layer + clear',
                    '> pin: 50% 50% 20% +', '> frag 2 … > end: frag', '> table(2,3)']],
    ['Text & math', ['* bullet (2 spaces = nested)', '[ highlighted line ]',
                     '$inline$  $$display$$', '@@ python … @@']],
    ['Inline format', ['**bold**  *italic*  \`code\`', '[text](https://url)',
                       '[text]{.accent}  [x]{color=#f00}', '[big]{.lede}  [small]{.sm}',
                       '> size: lede   (paragraph scope)', '> align: center',
                       'escape: \\* \\\` \\[']],
  ];

  function appendCheatsheet(p) {
    var d = document.createElement('details');
    d.className = 'rv-pn-cheat';
    d.innerHTML = '<summary>📖 Command cheatsheet</summary>' +
      CHEATSHEET.map(function (sec) {
        return '<div class="rv-cs-sec"><b>' + sec[0] + '</b><pre>' +
          sec[1].join('\n') + '</pre></div>';
      }).join('');
    try { d.open = localStorage.getItem('rv-ed-cheat') === '1'; } catch (e) {}
    d.addEventListener('toggle', function () {
      try { localStorage.setItem('rv-ed-cheat', d.open ? '1' : '0'); } catch (e) {}
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

  function buildFields(box, kind, el, lines, s, e) {
    if (!box) return;
    var line0 = lines[0] || '';
    var defs = [];  // {label, value, apply(newValue) -> op or null}

    function fragDef(construct) {
      var toks = tokensOf(line0, /^\s*>?\s*\S+(.*)$/) ;
      var fm = findToken(toks, /^\+(\d+)?$/);
      defs.push({
        label: 'fragment #', value: fm ? (fm[1] || '+') : '',
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
      defs.push({ label: 'x', value: nums[0] || '50%', apply: pinApply(0, nums, s) });
      defs.push({ label: 'y', value: nums[1] || '50%', apply: pinApply(1, nums, s) });
      defs.push({ label: 'width', value: nums[2] || '', apply: pinApply(2, nums, s) });
    } else if (kind === 'media') {
      var toks = tokensOf(line0, /^\s*!{1,2}\s+\S+(.*?)(?:\|.*)?$/);
      var h = findToken(toks, /^h=(.+)$/i), w = findToken(toks, /^w=(.+)$/i);
      defs.push({ label: 'height', value: h ? h[1] : '',
        apply: function (v) { return { op: 'set_media_size', line: s, dim: 'h', value: v || null }; } });
      defs.push({ label: 'width', value: w ? w[1] : '',
        apply: function (v) { return { op: 'set_media_size', line: s, dim: 'w', value: v || null }; } });
      fragDef('media');
    } else if (kind === 'row') {
      var toks2 = tokensOf(line0, /^\s*>\s*row\b(.*)$/);
      var h2 = findToken(toks2, /^h=(\d+)/i);
      var gap = toks2.filter(function (t) { return !/^h=/i.test(t) && !/^\+\d*$/.test(t); })[0];
      defs.push({ label: 'height px', value: h2 ? h2[1] : '',
        apply: function (v) { return { op: 'set_row_height', line: s, value: v ? parseInt(v, 10) : null }; } });
      defs.push({ label: 'gap', value: gap || '',
        apply: function (v) { return v ? { op: 'set_row_gap', line: s, value: v } : null; } });
    } else if (kind === 'stack') {
      var h3 = findToken(tokensOf(line0, /^\s*>\s*stack\b(.*)$/), /^h=(\d+)/i);
      defs.push({ label: 'height px', value: h3 ? h3[1] : '',
        apply: function (v) { return { op: 'set_stack_height', line: s, value: v ? parseInt(v, 10) : null }; } });
    } else if (kind === 'region') {
      var toks3 = tokensOf(line0, /^\s*>\s*col\b(.*)$/);
      var size = toks3.filter(function (t) {
        return !/^\+\d*$/.test(t) && ['center', 'relative', 'clip'].indexOf(t.toLowerCase()) === -1;
      })[0];
      defs.push({ label: 'size (2/5, 40%, 300px)', value: size || '',
        apply: function (v) { return { op: 'set_col_size', line: s, new: v || null }; } });
      fragDef('col');
    } else if (kind === 'grid') {
      var gapLine = null;
      for (var i = 1; i < lines.length; i++) {
        var gm = lines[i].match(/^\s*>\s*gap\s*:\s*(.*)$/);
        if (gm) { gapLine = gm[1]; break; }
      }
      defs.push({ label: 'gap', value: gapLine || '',
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
      buildSvgSteps(box, el, s);
      return;
    } else if (kind === 'column') {
      var wm = line0.match(/^\s*\|{1,2}\s*(.*)$/);
      defs.push({ label: 'width', value: wm ? wm[1] : '',
        apply: function (v) { return { op: 'set_block_width', line: s, new: v || null }; } });
    }

    box.innerHTML = defs.length
      ? defs.map(function (d, i) { return fld(d.label, d.value).replace('<label', '<label data-i="' + i + '"'); }).join('')
      : '<div class="rv-pn-hint">No quick parameters for this element — edit its source below.</div>';

    box.querySelectorAll('.rv-pn-fld input').forEach(function (input) {
      var def = defs[parseInt(input.parentElement.getAttribute('data-i'), 10)];
      function commit() {
        var op = def.apply(input.value.trim());
        if (op) F.rvPostEdit([op]);
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

  function buildSvgSteps(box, el, svgLine) {
    var ids = [];
    el.querySelectorAll('svg [id]').forEach(function (n) {
      if (ids.length < 40 && n.id) ids.push({ id: n.id, node: n });
    });
    if (!ids.length) {
      box.innerHTML = '<div class="rv-pn-hint">No id-carrying elements in this SVG — ' +
        'add ids (e.g. in Inkscape) to animate parts.</div>';
      return;
    }
    var sec = Reveal.getCurrentSlide();
    fetch('/__rv__/src?start=' + F.srcOf(sec) + '&end=' + F.srcEndOf(sec) +
          '&token=' + encodeURIComponent(TOKEN))
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
        box.innerHTML = '<div class="rv-pn-hint">Reveal SVG elements as steps ' +
          '(– = always visible):</div>' +
          ids.map(function (it, i) {
            var cur = step[it.id] || '';
            return '<label class="rv-pn-fld" data-id="' + F.escapeHtml(it.id) + '"><span>#' + F.escapeHtml(it.id) +
              '</span><select>' + ['<option value="">–</option>'].concat(
                [1,2,3,4,5,6,7,8].map(function (n) {
                  return '<option value="' + n + '"' + (cur === n ? ' selected' : '') +
                    '>step ' + n + '</option>';
                })).join('') + '</select></label>';
          }).join('') +
          '<button class="rv-pn-svgapply">Apply steps</button>';
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
          F.rvPostEdit([{ op: 'replace_lines', start: svgLine, end: base + end, text: block }]);
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
    if (!target) { F.toast('Already at the ' + (dir < 0 ? 'top' : 'bottom')); return; }
    var container = containerOf(el);
    var cSpan = container ? [F.srcOf(container), F.srcEndOf(container)]
                          : [F.srcOf(el), F.srcEndOf(target)];
    var kindC = container && F.hasCls(container, 'column') ? 'column' : 'col';
    var construct = F.constructOf(el);
    F.rvPostEdit([{
      op: 'move_block',
      src: [F.srcOf(el), F.srcEndOf(el)],
      construct: RV.MOVABLE[construct] ? construct : 'paragraph',
      dest: {
        insert_before: dir < 0 ? F.srcOf(target) : F.srcEndOf(target) + 1,
        container: cSpan,
        container_kind: kindC,
      },
    }]);
  }

  function deleteSelected(el) {
    var construct = F.constructOf(el);
    if (!el.hasAttribute('data-rv-src') || el.tagName === 'SECTION') {
      F.toast('Select a block inside the slide to delete it');
      return;
    }
    F.toast('Deleted ' + F.kindOf(el) + ' — Ctrl+Z to undo');
    RV.set('sel', null);
    F.rvPostEdit([{
      op: 'delete_block',
      src: [F.srcOf(el), F.srcEndOf(el)],
      construct: RV.MOVABLE[construct] ? construct : 'paragraph',
    }]);
  }

  // exports (what other editor/ modules call):
  F.rvPanelSync = rvPanelSync;
  RV.onChange('on', rvPanelSync);
  RV.onChange('sel', rvPanelSync);
  F.deleteSelected = deleteSelected;
  F.containerOf = containerOf;
})();
