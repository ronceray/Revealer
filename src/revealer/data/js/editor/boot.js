/* boot: arms the editor once every module is loaded — toolbar, ?rv-* debug/test hooks, and the SSE reload connection */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;
  var TOKEN = RV.token;

  // Debug/testing hook: ?rv-edit=1 auto-enters edit mode (and selects the
  // first annotated element on the current slide with ?rv-select=1).


  F.buildToolbar();

  // Restore a saved editing session (slide, edit mode, selection) — armed
  // HERE, after every module has populated RV.fn, never in core.js: on a
  // cache-warm reload Reveal is ready before the editor modules run, and
  // restoreState needs F.setEdit / F.toggleDrawer / F.toggleOutline.
  if (window.Reveal && Reveal.on) {
    if (Reveal.isReady && Reveal.isReady()) F.restoreState();
    else Reveal.on('ready', F.restoreState);
  }

  // The grammar schema drives the side-panel command palette. Load it once;
  // re-sync the panel if it is already open when the schema lands.
  RV.schema = null;
  fetch('/__rv__/schema?token=' + encodeURIComponent(TOKEN))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j) return;
      RV.schema = j;
      if (F.rvPanelSync) { S.panelFor = null; F.rvPanelSync(); }
    })
    .catch(function () { /* palette stays hidden until the next reload */ });

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
  if (params.get('rv-split') === '1') RV.set('splitPref', true);
  if (params.get('rv-edit') === '1') {
    var arm = function () {
      F.setEdit(true);
      var selParam = params.get('rv-select');
      if (selParam) {
        var slide = Reveal.getCurrentSlide();
        RV.set('sel', slide && (selParam === '1'
          ? slide.querySelector('[data-rv-src]')
          : slide.querySelector('[data-rv-src="' + selParam + '"]')));
        F.syncChrome();
      }
      if (params.get('rv-drawer') === '1') F.toggleDrawer();
      if (params.get('rv-outline') === '1') F.toggleOutline();
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
      else if (ev.type === 'export-progress') { F.onExportProgress(ev); }
      else if (ev.type === 'export-done') { F.onExportDone(ev); }
      else if (ev.type === 'export-cancelled') { F.onExportCancelled(ev); }
      else if (ev.type === 'export-error') { F.onExportError(ev); }
    };
    // EventSource reconnects on its own; nothing else to do.
  }

  connect();

})();
