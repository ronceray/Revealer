/* Revealer dev-mode client — served ONLY by `revealer serve` (never copied
 * into decks: excluded in assets.inject_revealer_assets).
 *
 * Stage A: live-reload over SSE, position-preserving reloads, and a build
 * error overlay. The layout-editing overlay builds on top of this file in
 * later stages.
 */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;
  var TOKEN = RV.token;


  /* --- fragment drawer -------------------------------------------------------------------- */

  function fragmentsOnSlide() {
    var slide = Reveal.getCurrentSlide();
    if (!slide) return [];
    var els = Array.prototype.slice.call(slide.querySelectorAll('.fragment'));
    els.sort(function (a, b) {
      var ia = parseInt(a.getAttribute('data-fragment-index') || '9999', 10);
      var ib = parseInt(b.getAttribute('data-fragment-index') || '9999', 10);
      return ia - ib;
    });
    return els;
  }

  function fragConstruct(el) {
    var k = F.constructOf(el);
    if (k === 'region') return 'col';
    if (k === 'media') return 'media';
    if (k === 'layer') return 'layer';
    if (k === 'card') return 'card';
    if (k === 'box') return 'box';
    if (k === 'eq') return 'eq';
    if (k === 'pin') return 'pin';
    if (k === 'row') return 'row';
    return 'frag';
  }

  function toggleDrawer() {
    var w = RV.ui.box({ id: 'rv-ed-drawer', title: 'Fragments (reveal order)' });
    if (!w) return;
    w.body.innerHTML = '<div class="rv-ed-drawer-list"></div>' +
      '<div class="rv-ed-drawer-foot">↑↓ reorder · writes explicit +1..+n</div>';
    renderDrawer();
  }

  function renderDrawer() {
    var dw = document.getElementById('rv-ed-drawer');
    if (!dw) return;
    var list = dw.querySelector('.rv-ed-drawer-list');
    list.innerHTML = '';
    var frags = fragmentsOnSlide();
    frags.forEach(function (el, i) {
      var row = document.createElement('div');
      row.className = 'rv-ed-drawer-item';
      var mapped = el.hasAttribute('data-rv-src');
      var label = F.kindOf(el) + (mapped ? ' · :' + el.getAttribute('data-rv-src') : ' · (unmapped)');
      row.innerHTML = '<span>' + (i + 1) + '. ' + label + '</span>' +
        (mapped ? '<span class="rv-ed-updown"><button data-d="-1">↑</button>' +
                  '<button data-d="1">↓</button></span>' : '');
      row.addEventListener('mouseenter', function () { S.hover = el; F.syncChrome(); });
      row.addEventListener('mouseleave', function () { S.hover = null; F.syncChrome(); });
      row.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          reorderFragment(frags, i, parseInt(b.getAttribute('data-d'), 10));
        });
      });
      list.appendChild(row);
    });
    if (!frags.length) list.innerHTML = '<div class="rv-ed-drawer-item">no fragments on this slide</div>';
  }

  function reorderFragment(frags, i, delta) {
    var j = i + delta;
    if (j < 0 || j >= frags.length) return;
    var order = frags.slice();
    var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    var mapped = order.filter(function (el) { return el.hasAttribute('data-rv-src'); });
    if (mapped.length !== order.length) {
      F.toast('Some fragments are raw HTML — their order can’t be rewritten');
    }
    F.rvPostEdit([{
      op: 'reorder_fragments',
      order: mapped.map(function (el) {
        return { line: F.srcOf(el), construct: fragConstruct(el) };
      }),
    }]);
  }


  // Debug/testing hook: ?rv-edit=1 auto-enters edit mode (and selects the
  // first annotated element on the current slide with ?rv-select=1).
  /* --- editor shell: toolbar, status chip, side panel ------------------------ */

  var PRES_NAME = (function () {
    var m = document.querySelector('meta[name="rv-src-file"]');
    return m ? m.getAttribute('content') : 'the .pres file';
  })();

  function rvStatus(state, msg) {
    var chip = document.querySelector('#rv-ed-toolbar .rv-tb-status');
    if (!chip) return;
    chip.className = 'rv-tb-status rv-st-' + state;
    chip.textContent = msg;
    try {
      if (state === 'saving') sessionStorage.setItem('rv-ed-lastsave', 'pending');
    } catch (e) {}
  }

  function buildToolbar() {
    if (document.getElementById('rv-ed-toolbar')) return;
    var tb = document.createElement('div');
    tb.id = 'rv-ed-toolbar';
    tb.innerHTML =
      '<button class="rv-tb-edit" title="Toggle edit mode (E)">✏ Edit</button>' +
      '<button class="rv-tb-undo" title="Undo (Ctrl+Z)">↶</button>' +
      '<button class="rv-tb-redo" title="Redo (Ctrl+Shift+Z)">↷</button>' +
      '<button class="rv-tb-frag" title="Fragments (F)">☰</button>' +
      '<button class="rv-tb-media" title="Import an image / movie into Media/">＋ Media</button>' +
      '<button class="rv-tb-view" title="Toggle split view">⇔</button>' +
      '<button class="rv-tb-hist" title="Save history (time machine)">🕐</button>' +
      '<button class="rv-tb-xhtml" title="Export the final HTML next to the .pres">⬇ HTML</button>' +
      '<button class="rv-tb-xpdf" title="Export a PDF next to the .pres">⬇ PDF</button>' +
      '<span class="rv-tb-status rv-st-idle">' + F.escapeHtml(PRES_NAME) + '</span>' +
      '<button class="rv-tb-help" title="Help">?</button>';
    document.body.appendChild(tb);
    tb.querySelector('.rv-tb-edit').addEventListener('click', function () { F.setEdit(!S.on); });
    tb.querySelector('.rv-tb-undo').addEventListener('click', function () { F.rvUndoRedo('undo'); });
    tb.querySelector('.rv-tb-redo').addEventListener('click', function () { F.rvUndoRedo('redo'); });
    tb.querySelector('.rv-tb-frag').addEventListener('click', function () {
      if (!S.on) F.setEdit(true);
      toggleDrawer();
    });
    tb.querySelector('.rv-tb-help').addEventListener('click', toggleHelp);
    function doExport(kind) {
      F.toast(kind === 'pdf' ? 'Exporting PDF… (can take a minute)' : 'Exporting HTML…', 60000);
      fetch('/__rv__/export?kind=' + kind, { method: 'POST', headers: { 'X-RV-Token': TOKEN } })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          F.toast(j.ok ? 'Exported → ' + j.path : 'Export failed: ' + (j.error || '?'), 6000);
        })
        .catch(function () { F.toast('Export failed', 4000); });
    }
    tb.querySelector('.rv-tb-xhtml').addEventListener('click', function () { doExport('html'); });
    if (window.__RV_DEV__.history === 'fallback') {
      var hb = tb.querySelector('.rv-tb-hist');
      hb.disabled = true;
      hb.title = 'Save history needs git on the server\u2019s PATH';
      hb.style.opacity = '0.4';
      if (!window.__rvHistToastShown) {
        window.__rvHistToastShown = true;
        F.toast('git not found \u2014 undo limited to the last edit, no save history', 6000);
      }
    } else {
      tb.querySelector('.rv-tb-hist').addEventListener('click', toggleHistory);
    }
    tb.querySelector('.rv-tb-xpdf').addEventListener('click', function () { doExport('pdf'); });
    tb.querySelector('.rv-tb-media').addEventListener('click', function () {
      if (!S.on) F.setEdit(true);
      importMedia();
    });
    tb.querySelector('.rv-tb-view').addEventListener('click', function () {
      S.splitPref = !S.splitPref;
      try { localStorage.setItem('rv-ed-split', S.splitPref ? '1' : '0'); } catch (e) {}
      if (!S.on && S.splitPref) F.setEdit(true);
      applyLayout();
    });
    try {
      if (sessionStorage.getItem('rv-ed-lastsave') === 'pending') {
        sessionStorage.removeItem('rv-ed-lastsave');
        rvStatus('saved', 'Saved to ' + PRES_NAME + ' ✓');
        setTimeout(function () { rvStatus('idle', PRES_NAME); }, 2500);
      }
    } catch (e) {}
  }

  function toggleHelp() {
    var w = RV.ui.box({ id: 'rv-ed-help', title: 'How editing works',
                        closes: ['rv-ed-history'] });
    if (!w) return;
    w.body.innerHTML =
      '<p>You are editing <code>' + F.escapeHtml(PRES_NAME) + '</code> — the source text file, ' +
      'not the HTML. Every change is written to it immediately as a minimal ' +
      'edit, the deck rebuilds, and this preview reloads in place. There is ' +
      'no separate save step.</p>' +
      '<ul>' +
      '<li><b>✏ Edit / E</b> — toggle edit mode; click any element to select it</li>' +
      '<li><b>Panel</b> — edit the selection\'s parameters, move it, edit its source lines, or the whole slide when nothing is selected</li>' +
      '<li><b>⇔</b> — split view (deck left, panel right, draggable divider)</li>' +
      '<li><b>＋ Media</b> — pick a file: it is copied into Media/ and inserted</li>' +
      '<li><b>Del</b> — delete the selected block (undo with Ctrl+Z)</li>' +
      '<li><b>Drag</b> — blue handles resize/move; the square grip drags a block to another column</li>' +
      '<li><b>↶ ↷ / Ctrl+Z</b> — undo/redo edits made here</li>' +
      '<li><b>☰ / F</b> — reorder the slide\'s fragments</li>' +
      '<li><b>Drop a file</b> — insert an image/movie into a column</li>' +
      '</ul>';
  }

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
      '<div class="rv-pn-sub">' + F.escapeHtml(PRES_NAME) + ' : ' + s + (e !== s ? '–' + e : '') + '</div>' +
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
        if (t) { S.sel = t; F.syncChrome(); }
      });
    });
    p.querySelector('.rv-pn-up').addEventListener('click', function () { moveSibling(el, -1); });
    p.querySelector('.rv-pn-down').addEventListener('click', function () { moveSibling(el, 1); });
    p.querySelector('.rv-pn-del').addEventListener('click', function () { deleteSelected(el); });

    var slot1 = p.querySelector('.rv-fmt-slot');
    if (slot1) slot1.appendChild(formatBar(p.querySelector('.rv-pn-src')));
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
      ' <span class="rv-pn-sub">' + F.escapeHtml(PRES_NAME) + ' : ' + s0 + '–' + e0 + '</span></div>' +
      '<div class="rv-pn-hint">Click an element for its parameters, or edit the whole slide here.</div>' +
      '<div class="rv-pn-srctitle">Slide source (editable)</div>' +
      '<div class="rv-fmt-slot"></div>' +
      '<textarea class="rv-pn-src rv-pn-src-slide" spellcheck="false"></textarea>' +
      '<button class="rv-pn-apply">Apply source</button>' +
      '<div class="rv-pn-foot">Changes save automatically to the .pres — no save button needed.</div>';
    var slot0 = p.querySelector('.rv-fmt-slot');
    if (slot0) slot0.appendChild(formatBar(p.querySelector('.rv-pn-src')));
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

  /* --- time machine ------------------------------------------------------------------ */

  function relTime(ts) {
    var d = Math.max(0, Date.now() / 1000 - ts);
    if (d < 90) return Math.round(d) + 's ago';
    if (d < 5400) return Math.round(d / 60) + 'min ago';
    if (d < 129600) return Math.round(d / 3600) + 'h ago';
    return Math.round(d / 86400) + 'd ago';
  }

  function toggleHistory() {
    var w = RV.ui.box({
      id: 'rv-ed-history', title: '🕐 Save history',
      closes: ['rv-ed-help'],
      buttons: [{
        label: 'Snapshot…', cls: 'rv-hi-snap',
        title: 'Snapshot the current state with a note',
        onClick: function () {
          var msg = window.prompt('Snapshot note:', 'before big rework');
          if (msg === null) return;
          fetch('/__rv__/history/commit', {
            method: 'POST', headers: { 'X-RV-Token': TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg }),
          }).then(function () {
            var hd = document.getElementById('rv-ed-history');
            if (hd) loadHistory(hd);
          });
        },
      }],
    });
    if (!w) return;
    w.body.innerHTML =
      '<div class="rv-hi-hint">Every save is committed automatically to a shadow git ' +
      'repo (.rv-history/) inside the deck folder. Restoring first snapshots the ' +
      'current state — nothing is ever lost. Ctrl+Z also undoes a restore.</div>' +
      '<div class="rv-hi-list">loading…</div>';
    loadHistory(w.box);
  }

  function loadHistory(hd) {
    fetch('/__rv__/history?token=' + encodeURIComponent(TOKEN))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var list = hd.querySelector('.rv-hi-list');
        if (!j.entries || !j.entries.length) {
          list.innerHTML = '<div class="rv-hi-item">no snapshots yet — save once</div>';
          return;
        }
        var cur = j.cursor || (j.entries[0] && j.entries[0].hash);
        list.innerHTML = j.entries.map(function (e) {
          return '<div class="rv-hi-item' + (e.hash === cur ? ' rv-hi-current' : '') + '">' +
            (e.hash === cur ? '<span class="rv-hi-cur">◀ current</span>' : '') +
            '<span class="rv-hi-badge' + (e.auto ? '' : ' rv-hi-manual') + '">' +
            (e.auto ? 'auto' : 'save') + '</span>' +
            '<span class="rv-hi-when">' + relTime(e.ts) + '</span>' +
            '<span class="rv-hi-msg">' + F.escapeHtml(e.msg.replace(/^(auto|save): /, '')) + '</span>' +
            '<button class="rv-hi-diff" data-h="' + e.hash + '">Diff</button>' +
            '<button class="rv-hi-peek" data-h="' + e.hash + '">Peek</button>' +
            '<button data-h="' + e.hash + '">Restore</button></div>' +
            '<pre class="rv-hi-diffbox" data-h="' + e.hash + '" hidden></pre>';
        }).join('');
        list.querySelectorAll('.rv-hi-diff').forEach(function (b) {
          b.addEventListener('click', function () {
            var box = list.querySelector('.rv-hi-diffbox[data-h="' + b.getAttribute('data-h') + '"]');
            if (!box.hidden) { box.hidden = true; return; }
            fetch('/__rv__/history/diff?hash=' + b.getAttribute('data-h') +
                  '&token=' + encodeURIComponent(TOKEN))
              .then(function (r) { return r.json(); })
              .then(function (jj) {
                box.innerHTML = (jj.diff || '(no diff)').split('\n').map(function (ln) {
                  var esc = ln.replace(/&/g, '&amp;').replace(/</g, '&lt;');
                  if (/^\+(?!\+\+)/.test(ln)) return '<span class="rv-d-add">' + esc + '</span>';
                  if (/^-(?!--)/.test(ln)) return '<span class="rv-d-del">' + esc + '</span>';
                  return esc;
                }).join('\n');
                box.hidden = false;
              });
          });
        });
        list.querySelectorAll('.rv-hi-peek').forEach(function (b) {
          b.addEventListener('click', function () {
            fetch('/__rv__/history/preview', {
              method: 'POST', headers: { 'X-RV-Token': TOKEN, 'Content-Type': 'application/json' },
              body: JSON.stringify({ hash: b.getAttribute('data-h') }),
            }).then(function (r) { return r.json(); }).then(function (jj) {
              if (!jj.ok) { F.toast('Preview failed: ' + (jj.error || '?')); return; }
              openPeek(jj.url, b.getAttribute('data-h'));
            });
          });
        });
        list.querySelectorAll('button[data-h]:not(.rv-hi-diff):not(.rv-hi-peek)').forEach(function (b) {
          b.addEventListener('click', function () {
            fetch('/__rv__/history/restore', {
              method: 'POST', headers: { 'X-RV-Token': TOKEN, 'Content-Type': 'application/json' },
              body: JSON.stringify({ hash: b.getAttribute('data-h') }),
            }).then(function (r) { return r.json(); }).then(function (jj) {
              if (jj.unchanged) F.toast('Already at that version');
              else if (jj.ok) F.toast('Restored — Ctrl+Z to undo');
              else F.toast('Restore failed: ' + (jj.error || '?'));
            });
          });
        });
      });
  }

  function openPeek(url, hash) {
    var w = RV.ui.box({
      id: 'rv-ed-peek', replace: true, headCls: 'rv-pk-bar',
      title: '🕐 Peek: past version',
      hint: 'read-only preview — the deck is unchanged',
      buttons: [{
        label: 'Restore this version', cls: 'rv-pk-restore',
        onClick: function () {
          fetch('/__rv__/history/restore', {
            method: 'POST', headers: { 'X-RV-Token': TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ hash: hash }),
          }).then(function (r) { return r.json(); }).then(function (jj) {
            var ov = document.getElementById('rv-ed-peek');
            if (ov) ov.remove();
            F.toast(jj.ok ? 'Restored — Ctrl+Z to undo' : 'Restore failed');
          });
        },
      }],
    });
    var fr = document.createElement('iframe');
    fr.src = url;
    w.body.appendChild(fr);
  }

  /* --- media import (file picker) -------------------------------------------------- */

  function importMedia() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*,audio/*,.pdf,.svg';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (file) uploadAndInsert(file);
    });
    input.click();
  }

  function uploadAndInsert(file) {
    var isVideo = /^video\//.test(file.type) || /\.(mp4|webm|ogv|mov)$/i.test(file.name);
    fetch('/__rv__/upload?name=' + encodeURIComponent(file.name), {
      method: 'PUT', headers: { 'X-RV-Token': TOKEN }, body: file,
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { F.toast('Upload rejected: ' + (j.error || '?')); return; }
      var sel = S.sel, at = null, flags = [];
      var sec = window.Reveal && Reveal.getCurrentSlide();
      function spanDest(container, kind) {
        return { insert_before: F.srcEndOf(container) + 1,
                 container: [F.srcOf(container), F.srcEndOf(container)],
                 container_kind: kind };
      }
      if (sel && sel.hasAttribute('data-rv-src') &&
          (F.hasCls(sel, 'region') || F.hasCls(sel, 'rv-card') || F.hasCls(sel, 'rv-cell') ||
           F.hasCls(sel, 'rv-layer') || F.hasCls(sel, 'column'))) {
        at = spanDest(sel, F.hasCls(sel, 'column') ? 'column' : 'col');
        flags = F.hasCls(sel, 'column') ? [] : ['fill'];
      } else if (sel && sel.hasAttribute('data-rv-src') && sel.tagName !== 'SECTION') {
        var cont = containerOf(sel) || sec;
        at = { insert_before: F.srcEndOf(sel) + 1,
               container: [F.srcOf(cont), F.srcEndOf(cont)],
               container_kind: F.hasCls(cont, 'column') ? 'column' :
                               (cont.tagName === 'SECTION' ? 'slide' : 'col') };
        flags = cont.tagName === 'SECTION' || F.hasCls(cont, 'column') ? [] : ['fill'];
      } else if (sec && sec.hasAttribute('data-rv-src')) {
        at = spanDest(sec, 'slide');
      }
      if (!at) { F.toast('Uploaded to ' + j.path + ' — add a “! ' + j.path + '” line'); return; }
      F.rvPostEdit([{ op: 'insert_media', at: at, kind: isVideo ? 'video' : 'img',
                    path: j.path, flags: flags }]);
    }).catch(function () { F.toast('Upload failed'); });
  }

  /* --- docked / split view ------------------------------------------------------------ */

  try { S.splitPref = localStorage.getItem('rv-ed-split') === '1'; } catch (e) {}

  function applyLayout() {
    var on = S.splitPref && S.on;
    document.body.classList.toggle('rv-split', on);
    var div = document.getElementById('rv-ed-divider');
    if (on && !div) {
      div = document.createElement('div');
      div.id = 'rv-ed-divider';
      document.body.appendChild(div);
      div.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        function mv(e2) {
          var w = Math.min(Math.max(window.innerWidth - e2.clientX, 240), window.innerWidth * 0.6);
          document.documentElement.style.setProperty('--rv-pw', w + 'px');
          try { localStorage.setItem('rv-ed-pw', String(w)); } catch (e3) {}
          relayout();
        }
        function up() {
          document.removeEventListener('pointermove', mv, true);
          document.removeEventListener('pointerup', up, true);
        }
        document.addEventListener('pointermove', mv, true);
        document.addEventListener('pointerup', up, true);
      });
    }
    if (div) div.style.display = on ? 'block' : 'none';
    var btn = document.querySelector('#rv-ed-toolbar .rv-tb-view');
    if (btn) btn.classList.toggle('rv-active', S.splitPref);
    relayout();
  }

  var relayoutRaf = null;
  function relayout() {
    if (relayoutRaf) return;
    relayoutRaf = requestAnimationFrame(function () {
      relayoutRaf = null;
      if (window.Reveal && Reveal.layout) Reveal.layout();
      var cur = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
      if (cur && typeof window.fitSlide === 'function') window.fitSlide(cur);
      F.syncChrome();
    });
  }

  try {
    var pw = parseInt(localStorage.getItem('rv-ed-pw') || '', 10);
    if (pw) document.documentElement.style.setProperty('--rv-pw', pw + 'px');
  } catch (e) {}

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
    S.sel = null;
    F.rvPostEdit([{
      op: 'delete_block',
      src: [F.srcOf(el), F.srcEndOf(el)],
      construct: RV.MOVABLE[construct] ? construct : 'paragraph',
    }]);
  }


  buildToolbar();

  var params = new URLSearchParams(location.search);
  if (params.get('rv-test-edit')) {
    // Headless smoke hook: POST the given ops through the real pipeline.
    var testArm = function () {
      setTimeout(function () {
        try { F.rvPostEdit(JSON.parse(params.get('rv-test-edit'))); }
        catch (e) { F.toast('bad rv-test-edit'); }
      }, 200);
    };
    if (Reveal.isReady && Reveal.isReady()) testArm();
    else Reveal.on('ready', testArm);
  }
  if (params.get('rv-split') === '1') S.splitPref = true;
  if (params.get('rv-edit') === '1') {
    var arm = function () {
      F.setEdit(true);
      var selParam = params.get('rv-select');
      if (selParam) {
        var slide = Reveal.getCurrentSlide();
        S.sel = slide && (selParam === '1'
          ? slide.querySelector('[data-rv-src]')
          : slide.querySelector('[data-rv-src="' + selParam + '"]'));
        F.syncChrome();
      }
      if (params.get('rv-drawer') === '1') toggleDrawer();
    };
    if (window.Reveal && Reveal.on) {
      if (Reveal.isReady && Reveal.isReady()) setTimeout(arm, 100);
      else Reveal.on('ready', function () { setTimeout(arm, 100); });
    }
  }

  function connect() {
    var es = new EventSource('/__rv__/events?token=' + encodeURIComponent(TOKEN));
    es.onmessage = function (msg) {
      var ev;
      try { ev = JSON.parse(msg.data); } catch (e) { return; }
      if (ev.type === 'reload') { F.scheduleReload(); }
      else if (ev.type === 'build-error') { F.showError(ev); }
    };
    // EventSource reconnects on its own; nothing else to do.
  }

  connect();

  /* transitional exports — still-unextracted functions consumed by
     already-extracted modules; each moves out as the split proceeds. */
  F.toggleDrawer = toggleDrawer;
  F.rvStatus = rvStatus;
  RV.PRES_NAME = PRES_NAME;
  F.deleteSelected = deleteSelected;
  F.rvPanelSync = rvPanelSync;
  F.applyLayout = applyLayout;
})();
