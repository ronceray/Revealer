/* templates: the visual "new slide" gallery — pick a starter layout, which is
 * inserted (via insert_lines) right after a chosen slide. */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var F = RV.fn;

  // --- tiny thumbnail vocabulary (a light mini-slide) ---------------------
  function bar(w) { return '<div style="height:6px;width:' + w + ';background:#44506f;border-radius:2px"></div>'; }
  function line(w) { return '<div style="height:4px;width:' + w + ';background:#c6cfe0;border-radius:2px"></div>'; }
  function bul(w) { return '<div style="display:flex;gap:5px;align-items:center"><span style="width:4px;height:4px;border-radius:50%;background:#2a76dd;flex:0 0 auto"></span>' + line(w) + '</div>'; }
  function img(flex) { return '<div style="flex:' + (flex || 1) + ';background:#d9e0ef;border-radius:3px;display:flex;align-items:center;justify-content:center;color:#9aa8c6;font-size:13px">▲</div>'; }
  function row(inner) { return '<div style="display:flex;gap:6px;flex:1">' + inner + '</div>'; }
  function col(w, inner) { return '<div style="flex:' + w + ';display:flex;flex-direction:column;gap:4px;justify-content:center">' + inner + '</div>'; }
  function centre(inner) { return '<div style="flex:1;display:flex;align-items:center;justify-content:center">' + inner + '</div>'; }
  function box(border, inner) { return '<div style="flex:1;border-top:3px solid ' + border + ';background:#eef2f8;border-radius:3px;padding:4px;display:flex;flex-direction:column;gap:4px">' + inner + '</div>'; }

  // --- the templates ------------------------------------------------------
  // body = the .pres lines inserted (a blank separator line is prepended).
  var TEMPLATES = [
    { id: 'content', group: 'Structure', name: 'Content slide', desc: 'Title + a paragraph',
      body: ['=== Title', '', 'Your text here.'],
      thumb: bar('55%') + line('90%') + line('80%') + line('60%') },
    { id: 'section', group: 'Structure', name: 'Section divider', desc: 'Full-bleed section break',
      body: ['%%% Section title'],
      thumb: centre('<div style="height:8px;width:64%;background:#44506f;border-radius:2px"></div>') },
    { id: 'statement', group: 'Structure', name: 'Big statement', desc: 'Centred, title-size line',
      body: ['=== ', '> align: center', '> size: title', '', 'Your key message.'],
      thumb: centre('<div style="height:11px;width:78%;background:#44506f;border-radius:2px"></div>') },

    { id: 'bullets', group: 'Text', name: 'Bulleted list', desc: 'Title + bullet points',
      body: ['=== Title', '', '* First point', '* Second point', '* Third point'],
      thumb: bar('55%') + bul('80%') + bul('70%') + bul('75%') },
    { id: 'twocol', group: 'Text', name: 'Two columns', desc: 'Side-by-side text',
      body: ['=== Title', '', '|| 50%', 'Left column.', '| 50%', 'Right column.', '||'],
      thumb: bar('55%') + row(col(1, line('90%') + line('70%')) + col(1, line('90%') + line('70%'))) },

    { id: 'figure', group: 'Media', name: 'Image + caption', desc: 'Full-width figure',
      body: ['=== Title', '', '! image.png fill | Caption'],
      thumb: bar('40%') + img(1) + line('45%') },
    { id: 'figtext', group: 'Media', name: 'Image + text', desc: 'Figure beside prose',
      body: ['=== Title', '', '|| 55%', '! image.png fill', '| 45%', 'Explanatory text.', '||'],
      thumb: bar('40%') + row(img(1.2) + col(1, line('90%') + line('80%') + line('60%'))) },

    { id: 'compare', group: 'Emphasis', name: 'Comparison', desc: 'Good vs. warn callouts',
      body: ['=== Title', '', '|| 50%', '> good Strengths', '* point', '> end: good',
             '| 50%', '> warn Watch out', '* point', '> end: warn', '||'],
      thumb: bar('40%') + row(box('#3f9a6d', line('90%') + line('70%')) + box('#c8913a', line('90%') + line('70%'))) },
    { id: 'equation', group: 'Emphasis', name: 'Equation focus', desc: 'Centred display math',
      body: ['=== Title', '', '$$ E = mc^2 $$'],
      thumb: bar('40%') + centre('<div style="font:italic 15px Georgia,serif;color:#3a4568">E = mc²</div>') },

    { id: 'grid', group: 'Structured & special', name: 'Grid 2×2', desc: 'Four cards',
      body: ['=== Title', '', '> grid(2,2)', '> card', 'A', '> card', 'B',
             '> card', 'C', '> card', 'D', '> end: grid'],
      thumb: bar('40%') + '<div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:4px">' +
             '<div style="background:#d9e0ef;border-radius:2px"></div><div style="background:#d9e0ef;border-radius:2px"></div>' +
             '<div style="background:#d9e0ef;border-radius:2px"></div><div style="background:#d9e0ef;border-radius:2px"></div></div>' },
    { id: 'table', group: 'Structured & special', name: 'Table', desc: 'Rows × columns',
      body: ['=== Title', '', '> table(3,3)'],
      thumb: bar('40%') + '<div style="flex:1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px">' +
             '<div style="background:#b7c1d6;border-radius:1px"></div><div style="background:#b7c1d6;border-radius:1px"></div><div style="background:#b7c1d6;border-radius:1px"></div>' +
             '<div style="background:#d9e0ef;border-radius:1px"></div><div style="background:#d9e0ef;border-radius:1px"></div><div style="background:#d9e0ef;border-radius:1px"></div>' +
             '<div style="background:#d9e0ef;border-radius:1px"></div><div style="background:#d9e0ef;border-radius:1px"></div><div style="background:#d9e0ef;border-radius:1px"></div></div>' },
    { id: 'vsub', group: 'Structured & special', name: 'Vertical sub-slide', desc: 'Stacks under current (---)',
      body: ['--- Sub-slide title', '', 'Continues below the current slide.'],
      thumb: '<div style="flex:1;position:relative">' +
             '<div style="position:absolute;inset:10px 0 0 10px;background:#e0e5f0;border-radius:3px"></div>' +
             '<div style="position:absolute;inset:0 10px 10px 0;background:#f4f6fb;border:1px solid #dfe4f0;border-radius:3px"></div>' +
             '<div style="position:absolute;right:5px;bottom:3px;color:#8593ad;font-size:12px">↓</div></div>' },
    { id: 'title', group: 'Structured & special', name: 'Title slide', desc: 'Deck opener (>>>)',
      body: ['>>> first: Deck title', '>>> subtitle: A subtitle', '>>> author: You'],
      thumb: '<div style="flex:1;background:#20304f;border-radius:3px;display:flex;flex-direction:column;gap:6px;align-items:center;justify-content:center">' +
             '<div style="height:8px;width:60%;background:#cdd9f0;border-radius:2px"></div>' +
             '<div style="height:5px;width:40%;background:#7f93bd;border-radius:2px"></div></div>' },
  ];

  function openTemplateGallery(afterSpan, file) {
    var w = RV.ui.box({ id: 'rv-ed-templates', title: RV.t('templates.title') });
    if (!w) return;                                  // toggled closed
    var groups = [];
    TEMPLATES.forEach(function (t) {
      var g = null;
      groups.forEach(function (x) { if (x.name === t.group) g = x; });
      if (!g) { g = { name: t.group, items: [] }; groups.push(g); }
      g.items.push(t);
    });
    w.body.innerHTML = '<div class="rv-tpl-groups">' + groups.map(function (g) {
      return '<div class="rv-tpl-gh">' + RV.esc(g.name) + '</div><div class="rv-tpl-grid">' +
        g.items.map(function (t) {
          return '<div class="rv-tpl-card" data-id="' + t.id + '">' +
            '<div class="rv-tpl-thumb">' + t.thumb + '</div>' +
            '<div class="nm">' + RV.esc(t.name) + '</div>' +
            '<div class="ds">' + RV.esc(t.desc) + '</div></div>';
        }).join('') + '</div>';
    }).join('') + '</div>';
    w.body.querySelectorAll('.rv-tpl-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var t = null;
        TEMPLATES.forEach(function (x) { if (x.id === card.getAttribute('data-id')) t = x; });
        if (!t || !afterSpan) return;
        F.rvPostEdit([{ op: 'insert_lines',
          at: { insert_before: afterSpan.e + 1, container_kind: 'deck' },
          text: [''].concat(t.body) }], file || '');
        var b = document.getElementById('rv-ed-templates');
        if (b) b.remove();
      });
    });
  }

  // exports (what other editor/ modules call):
  F.openTemplateGallery = openTemplateGallery;
  F.TEMPLATES = TEMPLATES;   // suite-palette.js asserts the roster
})();
