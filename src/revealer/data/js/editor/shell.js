/* shell: the mode-aware command chrome (preview Edit pill + edit menubar band),
 * the status chip, the help box, deck export, and media import. */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;
  var TOKEN = RV.token;

  /* --- editor shell ---------------------------------------------------------- */

  var PRES_NAME = (function () {
    var m = document.querySelector('meta[name="rv-src-file"]');
    return m ? m.getAttribute('content') : 'the .pres file';
  })();

  function rvStatus(state, msg) {
    var chip = document.querySelector('#rv-ed-toolbar .rv-tb-status');
    if (chip) { chip.className = 'rv-tb-status rv-st-' + state; chip.textContent = msg; }
    var dot = document.querySelector('#rv-ed-pill .rv-pill-dot');   // preview save indicator
    if (dot) dot.className = 'rv-pill-dot rv-st-' + state;
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

  /* --- the command chrome: a mode-aware menubar + a preview Edit pill -------- */

  function closeMenus() {
    var open = document.querySelectorAll('#rv-ed-toolbar .rv-menu-wrap.rv-open');
    Array.prototype.forEach.call(open, function (w) { w.classList.remove('rv-open'); });
  }
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenus(); });

  // items: {label, onClick[, checked][, disabled, title][, cls]} or {sep:true}
  function makeMenu(label, items) {
    var wrap = document.createElement('div');
    wrap.className = 'rv-menu-wrap';
    var btn = document.createElement('button');
    btn.className = 'rv-menu-btn';
    btn.textContent = label;
    wrap.appendChild(btn);
    var dd = document.createElement('div');
    dd.className = 'rv-menu';
    items.forEach(function (it) {
      if (it.sep) { var s = document.createElement('div'); s.className = 'rv-menu-sep'; dd.appendChild(s); return; }
      var mi = document.createElement('button');
      mi.className = 'rv-menu-item' + (it.cls ? ' ' + it.cls : '');
      mi.textContent = (it.checked ? '✓ ' : '') + it.label;
      if (it.disabled) { mi.disabled = true; if (it.title) mi.title = it.title; }
      mi.addEventListener('click', function () { closeMenus(); if (!it.disabled) it.onClick(); });
      dd.appendChild(mi);
    });
    wrap.appendChild(dd);
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var wasOpen = wrap.classList.contains('rv-open');
      closeMenus();
      if (!wasOpen) wrap.classList.add('rv-open');
    });
    return wrap;
  }

  function currentSlideLabel() {
    if (!(window.Reveal && Reveal.getIndices)) return PRES_NAME;
    var i = Reveal.getIndices().h;
    var sec = Reveal.getCurrentSlide();
    var h = sec && sec.querySelector('.slide_header,h1,h2,h3');
    var t = (h && h.textContent) ? h.textContent.trim() : '';
    return (i + 1) + (t ? ' · ' + t : '');
  }

  function updateSlideChip() {
    var chip = document.querySelector('#rv-ed-toolbar .rv-tb-slide');
    if (chip) chip.textContent = currentSlideLabel();
  }

  function gripDrag(el) {
    el.querySelector('.rv-tb-grip').addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      var r = el.getBoundingClientRect();
      var offX = ev.clientX - r.left, offY = ev.clientY - r.top;
      function mv(e2) {
        var x = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, e2.clientX - offX));
        var y = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, e2.clientY - offY));
        el.style.left = x + 'px'; el.style.top = y + 'px';
        try { localStorage.setItem('rv-ed-tbpos', JSON.stringify({ x: x, y: y })); } catch (e3) {}
      }
      function up() {
        document.removeEventListener('pointermove', mv, true);
        document.removeEventListener('pointerup', up, true);
      }
      document.addEventListener('pointermove', mv, true);
      document.addEventListener('pointerup', up, true);
    });
  }

  function buildToolbar() {
    if (document.getElementById('rv-ed-toolbar')) return;
    var hist = window.__RV_DEV__.history === 'fallback';

    // --- preview pill (CSS shows it only when NOT editing) ---
    var pill = document.createElement('div');
    pill.id = 'rv-ed-pill';
    pill.innerHTML =
      '<span class="rv-tb-grip" title="' + RV.esc(RV.t('toolbar.dragTitle')) + '">⠿</span>' +
      '<span class="rv-pill-dot rv-st-idle"></span>' +
      '<button class="rv-tb-edit" title="' + RV.esc(RV.t('toolbar.editTitle')) + '">' + RV.t('toolbar.edit') + '</button>';
    document.body.appendChild(pill);
    try {
      var saved = JSON.parse(localStorage.getItem('rv-ed-tbpos') || 'null');
      if (saved) { pill.style.left = saved.x + 'px'; pill.style.top = saved.y + 'px'; }
    } catch (e) {}
    gripDrag(pill);
    pill.querySelector('.rv-tb-edit').addEventListener('click', function () { F.setEdit(true); });

    // --- edit command band (CSS shows it only when editing) ---
    var tb = document.createElement('div');
    tb.id = 'rv-ed-toolbar';

    var editBtn = document.createElement('button');
    editBtn.className = 'rv-tb-edit rv-active';
    editBtn.title = RV.t('toolbar.editTitle');
    editBtn.textContent = RV.t('toolbar.edit');
    editBtn.addEventListener('click', function () { F.setEdit(false); });
    tb.appendChild(editBtn);

    var slideChip = document.createElement('button');
    slideChip.className = 'rv-tb-slide';
    slideChip.title = RV.t('toolbar.outlineTitle');
    slideChip.textContent = currentSlideLabel();
    slideChip.addEventListener('click', function () { F.toggleOutline(); });
    tb.appendChild(slideChip);

    var bar = document.createElement('nav');
    bar.className = 'rv-menubar';
    bar.appendChild(makeMenu(RV.t('menu.insert'), [
      { label: RV.t('menu.media'), onClick: function () { if (!S.on) F.setEdit(true); importMedia(); } },
      { label: RV.t('menu.fragments'), onClick: function () { if (!S.on) F.setEdit(true); F.toggleDrawer(); } },
    ]));
    bar.appendChild(makeMenu(RV.t('menu.slide'), [
      { label: RV.t('menu.newSlide'), onClick: function () {
          var span = F.currentSlideSpan && F.currentSlideSpan();
          if (span) F.openTemplateGallery(span); else F.toast(RV.t('outline.unmapped')); } },
      { label: RV.t('menu.selector'), onClick: function () { F.toggleOutline(); } },
    ]));
    bar.appendChild(makeMenu(RV.t('menu.history'), [
      { label: RV.t('menu.undo'), onClick: function () { F.rvUndoRedo('undo'); } },
      { label: RV.t('menu.redo'), onClick: function () { F.rvUndoRedo('redo'); } },
      { sep: true },
      { label: RV.t('menu.versionHistory'), disabled: hist,
        title: hist ? RV.t('toolbar.histDisabledTitle') : '',
        onClick: function () { F.toggleHistory(); } },
    ]));
    bar.appendChild(makeMenu(RV.t('menu.view'), [
      { label: RV.t('menu.splitView'), checked: S.splitPref, cls: 'rv-mi-split',
        onClick: function () {
          RV.set('splitPref', !S.splitPref);
          try { localStorage.setItem('rv-ed-split', S.splitPref ? '1' : '0'); } catch (e) {} } },
      { label: RV.t('menu.docSource'), onClick: function () { F.openDocSettings(); } },
    ]));
    bar.appendChild(makeMenu(RV.t('menu.export'), [
      { label: RV.t('menu.exportHtml'), onClick: exportHtml },
      { label: RV.t('menu.exportPdf'), onClick: startPdfExport },
    ]));
    bar.appendChild(makeMenu(RV.t('menu.help'), [
      { label: RV.t('menu.howEditing'), onClick: toggleHelp },
    ]));
    tb.appendChild(bar);

    var spacer = document.createElement('span');
    spacer.className = 'rv-tb-spacer';
    tb.appendChild(spacer);

    var status = document.createElement('span');
    status.className = 'rv-tb-status rv-st-idle';
    status.textContent = PRES_NAME;
    tb.appendChild(status);

    document.body.appendChild(tb);

    // Keep the Split-view checkmark honest as the preference changes.
    RV.onChange('splitPref', function () {
      var mi = tb.querySelector('.rv-mi-split');
      if (mi) mi.textContent = (S.splitPref ? '✓ ' : '') + RV.t('menu.splitView');
    });
    if (window.Reveal && Reveal.on) Reveal.on('slidechanged', updateSlideChip);

    if (hist && !window.__rvHistToastShown) {
      window.__rvHistToastShown = true;
      F.toast(RV.t('toast.gitMissing'), 6000);
    }
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
  F.updateSlideChip = updateSlideChip;
  F.onExportProgress = onExportProgress;
  F.onExportDone = onExportDone;
  F.onExportCancelled = onExportCancelled;
  F.onExportError = onExportError;
  RV.PRES_NAME = PRES_NAME;
})();
