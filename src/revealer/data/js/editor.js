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
      F.toggleDrawer();
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
        var cont = F.containerOf(sel) || sec;
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
      if (params.get('rv-drawer') === '1') F.toggleDrawer();
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
  F.rvStatus = rvStatus;
  RV.PRES_NAME = PRES_NAME;
  F.applyLayout = applyLayout;
})();
