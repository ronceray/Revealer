/* docsettings: edit the .pres settings block (the "document header" — the
 * lines above the first slide: > title / > author / > logo / > theme …). */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var F = RV.fn;

  // The settings block is every source line before the first slide marker.
  function firstSlideLine() {
    var sec = document.querySelector('.reveal .slides > section[data-rv-src]');
    return sec ? parseInt(sec.getAttribute('data-rv-src'), 10) : null;
  }

  function openSettings() {
    var first = firstSlideLine() || 1;
    var hasBlock = first > 1;             // false when the deck opens on a slide
    var w = RV.ui.box({ id: 'rv-ed-docset', title: RV.t('docset.title') });
    if (!w) return;                        // toggled closed
    w.body.innerHTML =
      '<div class="rv-pn-hint">' + RV.esc(RV.t('docset.hint')) + '</div>' +
      '<textarea class="rv-pn-src rv-ds-src" spellcheck="false"></textarea>' +
      '<button class="rv-pn-apply rv-ds-apply">' + RV.t('docset.apply') + '</button>';
    var ta = w.body.querySelector('.rv-ds-src');
    var applyBtn = w.body.querySelector('.rv-ds-apply');
    var bounds = null;                     // {start, end} to replace, or null = insert

    if (hasBlock) {
      applyBtn.disabled = true;
      F.fetchSrc(1, first - 1, function (j) {
        if (!j.lines || !document.getElementById('rv-ed-docset')) return;
        ta.value = j.lines.join('\n');
        bounds = { start: j.start, end: j.end };
        applyBtn.disabled = false;
      });
    } else {
      ta.placeholder = '> title: My talk\n> author: First author\n> theme: revealer';
    }

    applyBtn.addEventListener('click', function () {
      var lines = ta.value.split('\n');
      if (bounds) {
        F.rvPostEdit([{ op: 'replace_lines', start: bounds.start, end: bounds.end,
                        text: lines }]);
      } else {
        // no settings block yet: insert one (plus a blank separator) above
        // the first slide. Ignore an empty box.
        if (!ta.value.replace(/\s/g, '')) return;
        F.rvPostEdit([{ op: 'insert_lines',
                        at: { insert_before: 1, container_kind: 'deck' },
                        text: lines.concat(['']) }]);
      }
      // the rebuild's reload tears the box down and re-reads authoritative src
    });
    ta.focus();
  }

  F.openDocSettings = openSettings;
})();
