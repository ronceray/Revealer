/* shell: the editor toolbar, the status chip, the help box, and media import via the file picker */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;
  var TOKEN = RV.token;

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

  /* --- deck export -----------------------------------------------------------
     HTML export is one synchronous build. PDF export runs as a cancellable
     background job: POST kind=pdf&job=1 returns {job} at once, then the server
     streams export-progress / -done / -cancelled / -error over SSE. boot.js's
     connect() dispatches those to the F.onExport* handlers below; this module
     owns the progress box (title + live slide counter + a Cancel button). */

  function exportHtml() {
    F.toast(RV.t('toast.exportingHtml'), 60000);
    fetch('/__rv__/export?kind=html', { method: 'POST', headers: { 'X-RV-Token': TOKEN } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        F.toast(j.ok ? RV.t('toast.exported', { path: j.path })
                     : RV.t('toast.exportFailedErr', { error: j.error || '?' }), 6000);
      })
      .catch(function () { F.toast(RV.t('toast.exportFailed'), 4000); });
  }

  var exportJob = null;   // id of the running PDF export, if any

  function exportBoxMsg() {
    var b = document.getElementById('rv-ed-export');
    return b && b.querySelector('.rv-xp-msg');
  }

  function closeExportBox() {
    var b = document.getElementById('rv-ed-export');
    if (b) b.remove();
    exportJob = null;
  }

  function showExportBox(text) {
    var w = RV.ui.box({
      id: 'rv-ed-export', replace: true, close: false,
      title: RV.t('export.pdfTitle'),
      buttons: [{ label: RV.t('export.cancel'), cls: 'rv-xp-cancel',
                  title: RV.t('export.cancelTitle'), onClick: cancelExport }],
    });
    w.body.innerHTML = '<div class="rv-xp-msg"></div>';
    w.body.querySelector('.rv-xp-msg').textContent = text;
  }

  function startPdfExport() {
    showExportBox(RV.t('export.starting'));
    fetch('/__rv__/export?kind=pdf&job=1', { method: 'POST', headers: { 'X-RV-Token': TOKEN } })
      .then(function (r) {
        return r.json().then(function (j) { return { status: r.status, j: j }; });
      })
      .then(function (res) {
        if (res.status === 409) {
          closeExportBox();
          F.toast(RV.t('toast.exportRunning'), 4000);
        } else if (res.j && res.j.ok && res.j.job) {
          exportJob = res.j.job;
        } else {
          closeExportBox();
          F.toast(RV.t('toast.exportFailedErr', { error: (res.j && res.j.error) || '?' }), 6000);
        }
      })
      .catch(function () { closeExportBox(); F.toast(RV.t('toast.exportFailed'), 4000); });
  }

  function cancelExport() {
    var msg = exportBoxMsg();
    if (msg) msg.textContent = RV.t('export.cancelling');
    fetch('/__rv__/export/cancel', { method: 'POST', headers: { 'X-RV-Token': TOKEN } })
      .catch(function () {});
  }

  // SSE handlers (dispatched from boot.js). Ignore events for a stale job.
  function onExportProgress(ev) {
    if (exportJob && ev.job !== exportJob) return;
    var msg = exportBoxMsg();
    if (msg) msg.textContent = RV.t('export.slide', { done: ev.done, total: ev.total });
  }

  function onExportDone(ev) {
    if (exportJob && ev.job !== exportJob) return;
    closeExportBox();
    F.toast(RV.t('toast.exported', { path: ev.path }), 6000);
  }

  function onExportCancelled(ev) {
    if (exportJob && ev.job !== exportJob) return;
    closeExportBox();
    F.toast(RV.t('toast.exportCancelled'), 3000);
  }

  function onExportError(ev) {
    if (exportJob && ev.job !== exportJob) return;
    closeExportBox();
    F.toast(RV.t('toast.exportFailedErr', { error: ev.error || '?' }), 6000);
  }

  function buildToolbar() {
    if (document.getElementById('rv-ed-toolbar')) return;
    var tb = document.createElement('div');
    tb.id = 'rv-ed-toolbar';
    tb.innerHTML =
      '<button class="rv-tb-edit" title="' + RV.esc(RV.t('toolbar.editTitle')) + '">' + RV.t('toolbar.edit') + '</button>' +
      '<button class="rv-tb-undo" title="' + RV.esc(RV.t('toolbar.undoTitle')) + '">↶</button>' +
      '<button class="rv-tb-redo" title="' + RV.esc(RV.t('toolbar.redoTitle')) + '">↷</button>' +
      '<button class="rv-tb-frag" title="' + RV.esc(RV.t('toolbar.fragTitle')) + '">☰</button>' +
      '<button class="rv-tb-outline" title="' + RV.esc(RV.t('toolbar.outlineTitle')) + '">▤</button>' +
      '<button class="rv-tb-media" title="' + RV.esc(RV.t('toolbar.mediaTitle')) + '">' + RV.t('toolbar.media') + '</button>' +
      '<button class="rv-tb-view" title="' + RV.esc(RV.t('toolbar.viewTitle')) + '">⇔</button>' +
      '<button class="rv-tb-hist" title="' + RV.esc(RV.t('toolbar.histTitle')) + '">🕐</button>' +
      '<button class="rv-tb-xhtml" title="' + RV.esc(RV.t('toolbar.xhtmlTitle')) + '">' + RV.t('toolbar.xhtml') + '</button>' +
      '<button class="rv-tb-xpdf" title="' + RV.esc(RV.t('toolbar.xpdfTitle')) + '">' + RV.t('toolbar.xpdf') + '</button>' +
      '<span class="rv-tb-status rv-st-idle">' + F.escapeHtml(PRES_NAME) + '</span>' +
      '<button class="rv-tb-help" title="' + RV.esc(RV.t('toolbar.helpTitle')) + '">?</button>';
    document.body.appendChild(tb);
    tb.querySelector('.rv-tb-edit').addEventListener('click', function () { F.setEdit(!S.on); });
    tb.querySelector('.rv-tb-undo').addEventListener('click', function () { F.rvUndoRedo('undo'); });
    tb.querySelector('.rv-tb-redo').addEventListener('click', function () { F.rvUndoRedo('redo'); });
    tb.querySelector('.rv-tb-frag').addEventListener('click', function () {
      if (!S.on) F.setEdit(true);
      F.toggleDrawer();
    });
    tb.querySelector('.rv-tb-outline').addEventListener('click', F.toggleOutline);
    tb.querySelector('.rv-tb-help').addEventListener('click', toggleHelp);
    tb.querySelector('.rv-tb-xhtml').addEventListener('click', exportHtml);
    if (window.__RV_DEV__.history === 'fallback') {
      var hb = tb.querySelector('.rv-tb-hist');
      hb.disabled = true;
      hb.title = RV.t('toolbar.histDisabledTitle');
      hb.style.opacity = '0.4';
      if (!window.__rvHistToastShown) {
        window.__rvHistToastShown = true;
        F.toast(RV.t('toast.gitMissing'), 6000);
      }
    } else {
      tb.querySelector('.rv-tb-hist').addEventListener('click', F.toggleHistory);
    }
    tb.querySelector('.rv-tb-xpdf').addEventListener('click', startPdfExport);
    tb.querySelector('.rv-tb-media').addEventListener('click', function () {
      if (!S.on) F.setEdit(true);
      importMedia();
    });
    tb.querySelector('.rv-tb-view').addEventListener('click', function () {
      RV.set('splitPref', !S.splitPref);
      try { localStorage.setItem('rv-ed-split', S.splitPref ? '1' : '0'); } catch (e) {}
      if (!S.on && S.splitPref) F.setEdit(true);
    });
    try {
      if (sessionStorage.getItem('rv-ed-lastsave') === 'pending') {
        sessionStorage.removeItem('rv-ed-lastsave');
        rvStatus('saved', RV.t('status.saved', { name: PRES_NAME }));
        setTimeout(function () { rvStatus('idle', PRES_NAME); }, 2500);
      }
    } catch (e) {}
  }

  function toggleHelp() {
    var w = RV.ui.box({ id: 'rv-ed-help', title: RV.t('help.title'),
                        closes: ['rv-ed-history'] });
    if (!w) return;
    w.body.innerHTML = RV.t('help.body', { name: F.escapeHtml(PRES_NAME) });
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
      if (!j.ok) { F.toast(RV.t('toast.uploadRejected', { error: j.error || '?' })); return; }
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
      if (!at) { F.toast(RV.t('toast.uploadHint', { path: j.path })); return; }
      F.rvPostEdit([{ op: 'insert_media', at: at, kind: isVideo ? 'video' : 'img',
                    path: j.path, flags: flags }]);
    }).catch(function () { F.toast(RV.t('toast.uploadFailed')); });
  }

  // exports (what other editor/ modules call):
  F.rvStatus = rvStatus;
  F.buildToolbar = buildToolbar;
  F.onExportProgress = onExportProgress;
  F.onExportDone = onExportDone;
  F.onExportCancelled = onExportCancelled;
  F.onExportError = onExportError;
  RV.PRES_NAME = PRES_NAME;
})();
