/* blockmove: drop targets + slot bar + drag ghost for moving blocks between columns, and OS-file drop insertion */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;
  var TOKEN = RV.token;

  /* --- block move: ghost, drop targets, commit ------------------------------------------ */


  function mappedChildren(container) {
    return Array.prototype.filter.call(container.children, function (c) {
      return c.hasAttribute && c.hasAttribute('data-rv-src');
    });
  }

  function buildDropTargets(exclude) {
    var slide = Reveal.getCurrentSlide();
    if (!slide) return;
    var targets = [];
    slide.querySelectorAll('.region[data-rv-src], .column[data-rv-src]').forEach(function (c) {
      if (c === exclude || c.contains(exclude) || exclude.contains(c)) return;
      var kids = mappedChildren(c).filter(function (k) { return k !== exclude; });
      var slots = kids.map(function (k) {
        return { line: F.srcOf(k), y: k.getBoundingClientRect().top };
      });
      slots.push({ line: F.srcEndOf(c) + 1, y: c.getBoundingClientRect().bottom });
      targets.push({ el: c, slots: slots,
                     kind: F.hasCls(c, 'column') ? 'column' : 'col' });
      c.classList.add('rv-ed-droptarget');
    });
    S.dropState = { targets: targets, active: null };
  }

  function clearDropTargets() {
    document.querySelectorAll('.rv-ed-droptarget').forEach(function (c) {
      c.classList.remove('rv-ed-droptarget');
    });
    var bar = document.getElementById('rv-ed-slotbar');
    if (bar) bar.remove();
    var ghost = document.getElementById('rv-ed-ghost');
    if (ghost) ghost.remove();
    S.dropState = null;
    F.maybeReload();
  }

  function moveGhost(ev) {
    var g = document.getElementById('rv-ed-ghost');
    if (!g) {
      g = document.createElement('div');
      g.id = 'rv-ed-ghost';
      g.textContent = F.kindOf(S.drag.el);
      document.body.appendChild(g);
    }
    g.style.left = (ev.clientX + 12) + 'px';
    g.style.top = (ev.clientY + 12) + 'px';
  }

  function pickDropSlot(ev) {
    if (!S.dropState) return;
    var hit = null;
    S.dropState.targets.forEach(function (t) {
      var r = t.el.getBoundingClientRect();
      if (ev.clientX >= r.left && ev.clientX <= r.right &&
          ev.clientY >= r.top - 8 && ev.clientY <= r.bottom + 8) hit = t;
    });
    var bar = document.getElementById('rv-ed-slotbar');
    if (!hit) { if (bar) bar.remove(); S.dropState.active = null; return; }
    var slot = hit.slots[0], dist = Infinity;
    hit.slots.forEach(function (s) {
      var d = Math.abs(ev.clientY - s.y);
      if (d < dist) { dist = d; slot = s; }
    });
    S.dropState.active = { target: hit, slot: slot };
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'rv-ed-slotbar';
      document.body.appendChild(bar);
    }
    var rr = hit.el.getBoundingClientRect();
    bar.style.left = rr.left + 'px';
    bar.style.width = rr.width + 'px';
    bar.style.top = (slot.y - 2) + 'px';
  }

  function commitBlockMove(d, ev) {
    var choice = S.dropState && S.dropState.active;
    var el = d.el;
    clearDropTargets();
    if (!choice) { F.syncChrome(); return; }
    var construct = F.constructOf(el);
    if (construct === 'region') construct = 'paragraph';
    F.rvPostEdit([{
      op: 'move_block',
      src: [F.srcOf(el), F.srcEndOf(el)],
      construct: RV.MOVABLE[construct] ? construct : 'paragraph',
      dest: {
        insert_before: choice.slot.line,
        container: [F.srcOf(choice.target.el), F.srcEndOf(choice.target.el)],
        container_kind: choice.target.kind,
      },
    }]);
  }

  /* --- OS file drag-drop --------------------------------------------------------------------- */

  window.addEventListener('dragover', function (ev) {
    if (!S.on) return;
    if (!ev.dataTransfer || Array.prototype.indexOf.call(ev.dataTransfer.types, 'Files') === -1) return;
    ev.preventDefault();
    if (!S.dropState) buildDropTargets(document.createElement('div'));
    pickDropSlot(ev);
  });

  window.addEventListener('drop', function (ev) {
    if (!S.on || !ev.dataTransfer || !ev.dataTransfer.files.length) return;
    ev.preventDefault();
    var choice = S.dropState && S.dropState.active;
    var file = ev.dataTransfer.files[0];
    clearDropTargets();
    if (!choice) { F.toast('Drop inside a column to insert media'); return; }
    var isVideo = /^video\//.test(file.type) || /\.(mp4|webm|ogv|mov)$/i.test(file.name);
    fetch('/__rv__/upload?name=' + encodeURIComponent(file.name), {
      method: 'PUT', headers: { 'X-RV-Token': TOKEN }, body: file,
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { F.toast('Upload rejected: ' + (j.error || '?')); return; }
      F.rvPostEdit([{
        op: 'insert_media',
        at: { insert_before: choice.slot.line,
              container: [F.srcOf(choice.target.el), F.srcEndOf(choice.target.el)],
              container_kind: choice.target.kind },
        kind: isVideo ? 'video' : 'img',
        path: j.path,
        flags: choice.target.kind === 'col' ? ['fill'] : [],
      }]);
    }).catch(function () { F.toast('Upload failed'); });
  });

  window.addEventListener('dragleave', function (ev) {
    if (S.on && !ev.relatedTarget && S.dropState && !S.drag) clearDropTargets();
  });

  // exports (what other editor/ modules call):
  F.mappedChildren = mappedChildren;
  F.buildDropTargets = buildDropTargets;
  F.moveGhost = moveGhost;
  F.pickDropSlot = pickDropSlot;
  F.commitBlockMove = commitBlockMove;
})();
