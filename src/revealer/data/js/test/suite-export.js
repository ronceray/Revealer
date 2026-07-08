/* Export suite: the cancellable PDF export WIRING (no real Chrome/img2pdf).
 *
 * Runs on the runner page (the editor monolith boots here, so RV and the
 * toolbar are live). A stubbed fetch stands in for the server: the job POST
 * returns {ok, job}, and the cancel POST is observed. SSE events are injected
 * by calling the F.onExport* handlers directly — exactly what boot.js's
 * connect() does — so this stays deterministic and browser-tool-independent.
 */
(function () {
  'use strict';
  var F = window.RV.fn;

  RVT.test('PDF export: progress box + Cancel, live counter, cancel POST', function () {
    var seen = { jobPost: 0, cancelPost: 0 };
    RVT.stubFetch(function (input) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/__rv__/export?kind=pdf&job=1') !== -1) {
        seen.jobPost += 1;
        return Promise.resolve({
          status: 200,
          json: function () { return Promise.resolve({ ok: true, job: 't1' }); },
        });
      }
      if (url.indexOf('/__rv__/export/cancel') !== -1) {
        seen.cancelPost += 1;
        return Promise.resolve({
          status: 200,
          json: function () { return Promise.resolve({ ok: true }); },
        });
      }
      return null;  // pass everything else through
    });
    function cleanup(v) { RVT.stubFetch(null); return v; }
    function fail(e) { RVT.stubFetch(null); throw e; }

    // Clean slate: no leftover export box from a previous run.
    var stale = document.getElementById('rv-ed-export');
    if (stale) stale.remove();

    // Export ▸ Export PDF: the progress box + Cancel button appear synchronously.
    RVT.assert(RVT.menuClick(document, 'Export', 'Export PDF'), 'Export menu has a PDF item');

    return RVT.until(function () {
      var box = document.getElementById('rv-ed-export');
      return box && box.querySelector('.rv-xp-cancel') ? box : null;
    }, 5000, 'export progress box with Cancel').then(function (box) {
      RVT.assert(seen.jobPost === 1, 'clicking ⬇PDF POSTs the job once');

      // An SSE export-progress updates the live slide counter.
      F.onExportProgress({ job: 't1', done: 2, total: 5 });
      RVT.assert(box.querySelector('.rv-xp-msg').textContent === 'Exporting slide 2/5',
                 'progress text got: ' + box.querySelector('.rv-xp-msg').textContent);

      // Cancel POSTs /__rv__/export/cancel (observed via the fetch stub).
      box.querySelector('.rv-xp-cancel').click();
      RVT.assert(seen.cancelPost === 1, 'Cancel POSTs /__rv__/export/cancel');

      // The server's export-cancelled event closes the box.
      F.onExportCancelled({ job: 't1' });
      RVT.assert(!document.getElementById('rv-ed-export'),
                 'export-cancelled closes the progress box');
      return true;
    }).then(cleanup, fail);
  });
})();
