/* history: the save-history time machine — snapshot list, diffs, read-only peek previews, restores */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;
  var TOKEN = RV.token;

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

  // exports (what other editor/ modules call):
  F.toggleHistory = toggleHistory;
})();
