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
  var TOKEN = window.__RV_DEV__.token;

  /* --- position-preserving reload ---------------------------------------- */

  var RESTORE_KEY = 'rv-dev-restore';

  function saveStateAndReload() {
    try {
      var idx = (window.Reveal && Reveal.getIndices) ? Reveal.getIndices() : {};
      sessionStorage.setItem(RESTORE_KEY, JSON.stringify({
        h: idx.h || 0, v: idx.v || 0, f: (idx.f === undefined ? -1 : idx.f)
      }));
    } catch (e) { /* sessionStorage unavailable — hash restore still works */ }
    location.reload();
  }

  function restoreState() {
    var raw = null;
    try { raw = sessionStorage.getItem(RESTORE_KEY); } catch (e) {}
    if (!raw) return;
    try { sessionStorage.removeItem(RESTORE_KEY); } catch (e) {}
    try {
      var s = JSON.parse(raw);
      // `hash: true` usually restores the slide already; this also restores
      // the fragment when fragmentInURL is off, and wins over a stale hash.
      Reveal.slide(s.h, s.v, s.f === -1 ? undefined : s.f);
    } catch (e) {}
  }

  if (window.Reveal && Reveal.on) {
    if (Reveal.isReady && Reveal.isReady()) restoreState();
    else Reveal.on('ready', restoreState);
  }

  /* --- build-error overlay ------------------------------------------------ */

  function errorOverlay() {
    var el = document.getElementById('rv-dev-error');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rv-dev-error';
      el.innerHTML =
        '<div class="rv-dev-error-box">' +
        '<div class="rv-dev-error-title">Build failed</div>' +
        '<pre class="rv-dev-error-msg"></pre>' +
        '<pre class="rv-dev-error-tb"></pre>' +
        '<div class="rv-dev-error-actions">' +
        '<button class="rv-dev-open">Open in editor</button>' +
        '<span class="rv-dev-hint">fix + save to dismiss</span>' +
        '</div></div>';
      document.body.appendChild(el);
      el.querySelector('.rv-dev-open').addEventListener('click', function () {
        var line = el.getAttribute('data-line') || '1';
        fetch('/__rv__/open?line=' + encodeURIComponent(line), {
          headers: { 'X-RV-Token': TOKEN }
        });
      });
    }
    return el;
  }

  function showError(ev) {
    var el = errorOverlay();
    el.querySelector('.rv-dev-error-msg').textContent = ev.message || '';
    el.querySelector('.rv-dev-error-tb').textContent = ev.traceback || '';
    el.setAttribute('data-line', ev.line == null ? '1' : String(ev.line));
    el.style.display = 'flex';
  }

  function hideError() {
    var el = document.getElementById('rv-dev-error');
    if (el) el.style.display = 'none';
  }

  /* --- SSE ----------------------------------------------------------------- */

  // The server bakes an active build error into the bootstrap, so a page
  // opened while the build is broken shows the overlay immediately.
  if (window.__RV_DEV__.buildError) {
    if (document.body) showError(window.__RV_DEV__.buildError);
    else document.addEventListener('DOMContentLoaded', function () {
      showError(window.__RV_DEV__.buildError);
    });
  }

  function connect() {
    var es = new EventSource('/__rv__/events?token=' + encodeURIComponent(TOKEN));
    es.onmessage = function (msg) {
      var ev;
      try { ev = JSON.parse(msg.data); } catch (e) { return; }
      if (ev.type === 'reload') { hideError(); saveStateAndReload(); }
      else if (ev.type === 'build-error') { showError(ev); }
    };
    // EventSource reconnects on its own; nothing else to do.
  }

  connect();
})();
