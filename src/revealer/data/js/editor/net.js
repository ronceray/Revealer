/* net: edit POST FIFO queue, reload deferral, undo/redo, panel /src fetches */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;
  var TOKEN = RV.token;

  /* --- editing machinery: POST plumbing, toasts, undo ----------------------- */


  /* --- edit POST plumbing: a FIFO queue for line-preserving ops --------------
     Rapid line-preserving edits (drag + nudge storms) queue and chain on the
     previous response's sha — nothing is silently dropped. Structural ops
     renumber lines, so they never queue behind anything: issuing one drops
     whatever is still waiting (with a toast) and runs next. Any rejected
     edit clears the queue: the deck state is the truth, resync to it. */
  var STRUCTURAL_OPS = { move_block: 1, delete_block: 1, insert_media: 1,
                         insert_lines: 1, replace_lines: 1, set_grid_gap: 1 };
  var editQueue = [];        // waiting line-preserving batches {edits, file}
  var nextStructural = null; // at most one structural batch {edits, file}, runs next
  var editInFlight = false;
  // P8: fresh shas tracked PER FILE ("" = main). A queued include edit must
  // chain on ITS OWN file's response sha, never on a main-file edit's — the
  // main sha (F.curSha) is meaningless for an include and would 409 or, worse,
  // steer the write to the wrong file. Cleared with the queue on any reject.
  var freshShaByFile = {};

  function editsBusy() {
    return editInFlight || editQueue.length > 0 || nextStructural !== null;
  }

  function clearEditQueue() {
    editQueue.length = 0;
    nextStructural = null;
    freshShaByFile = {};
  }

  // The sha to open a file's edit chain with, before any response for it.
  function initialShaFor(file) {
    return file ? F.fileSha(file) : F.curSha();
  }

  function rvPostEdit(edits, file) {
    file = file || '';
    var structural = edits.some(function (e) { return STRUCTURAL_OPS[e.op] === 1; });
    if (!editsBusy()) return sendEdit(edits, file);
    var entry = { edits: edits, file: file };
    if (structural) {
      if (editQueue.length) F.toast('Dropped ' + editQueue.length + ' pending edit(s) — layout changed');
      editQueue.length = 0;
      nextStructural = entry;
    } else if (nextStructural) {
      F.toast('Edit dropped — the layout is about to change');
    } else {
      editQueue.push(entry);
    }
    return Promise.resolve(true);
  }

  function sendEdit(edits, file) {
    file = file || '';
    editInFlight = true;
    F.rvStatus('saving', 'Saving to ' + (file || RV.PRES_NAME) + '…');
    var baseSha = freshShaByFile[file] != null ? freshShaByFile[file] : initialShaFor(file);
    return fetch('/__rv__/edit', {
      method: 'POST',
      headers: { 'X-RV-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha256: baseSha, edits: edits, file: file }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        editInFlight = false;
        if (!r.ok) {
          clearEditQueue();
          F.rvStatus('error', 'Not saved ✗');
          try { sessionStorage.removeItem('rv-ed-lastsave'); } catch (e2) {}
          F.toast(j.error === 'sha_mismatch'
            ? 'Deck changed on disk — resyncing'
            : 'Edit rejected: ' + (j.error || r.status));
          if (j.error === 'sha_mismatch') F.saveStateAndReload();
          else maybeReload();  // a deferred reload must not stay stuck
          return false;
        }
        // Chain the NEXT edit for this same file on this response's sha.
        freshShaByFile[file] = j.sha256 || null;
        var next = nextStructural || editQueue.shift() || null;
        nextStructural = (next === nextStructural) ? null : nextStructural;
        if (next) sendEdit(next.edits, next.file);
        else maybeReload();
        return true;  // the rebuild's SSE reload refreshes everything
      });
    }).catch(function () {
      editInFlight = false;
      clearEditQueue();
      F.toast('Edit failed: server unreachable');
      maybeReload();
      return false;
    });
  }

  /* --- reload deferral: never yank the DOM mid-interaction -------------------
     SSE reloads wait for the edit queue and any active drag/drop to finish,
     with a 5 s force-fire so a wedged state can't suppress reloads forever. */
  var pendingReload = false;
  var reloadForceTimer = null;

  function maybeReload() {
    if (!pendingReload) return;
    if (editsBusy() || S.drag || S.dropState) return;
    pendingReload = false;
    if (reloadForceTimer) { clearTimeout(reloadForceTimer); reloadForceTimer = null; }
    F.hideError();
    F.saveStateAndReload();
  }

  function scheduleReload() {
    F.flushNudge();  // an uncommitted nudge would be lost by the reload
    pendingReload = true;
    if (!reloadForceTimer) {
      reloadForceTimer = setTimeout(function () {
        reloadForceTimer = null;
        if (pendingReload) { pendingReload = false; F.hideError(); F.saveStateAndReload(); }
      }, 5000);
    }
    maybeReload();
  }

  function rvUndoRedo(which) {
    fetch('/__rv__/' + which, { method: 'POST', headers: { 'X-RV-Token': TOKEN } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) F.toast(j.error === 'external_edit'
          ? 'File changed outside the editor — use your editor’s undo'
          : 'Nothing to ' + which);
      }); });
  }

  /* Panel /src loads: only the newest render may fill the box. Older
     in-flight requests are aborted and epoch-guarded (an abort alone can't
     protect against a response already in the microtask queue). */
  var srcEpoch = 0;
  var srcCtl = null;

  function fetchSrc(start, end, cb, file) {
    srcEpoch += 1;
    var epoch = srcEpoch;
    if (srcCtl) { try { srcCtl.abort(); } catch (e) {} }
    var ctl = window.AbortController ? new AbortController() : null;
    srcCtl = ctl;
    fetch('/__rv__/src?start=' + start + '&end=' + end +
          '&token=' + encodeURIComponent(TOKEN) +
          (file ? '&file=' + encodeURIComponent(file) : ''),
          ctl ? { signal: ctl.signal } : undefined)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (epoch !== srcEpoch) return;
        cb(j);
      })
      .catch(function () { /* aborted or unreachable — nothing to fill */ });
  }

  // exports (what other editor/ modules call):
  F.rvPostEdit = rvPostEdit;
  F.maybeReload = maybeReload;
  F.scheduleReload = scheduleReload;
  F.rvUndoRedo = rvUndoRedo;
  F.fetchSrc = fetchSrc;
})();
