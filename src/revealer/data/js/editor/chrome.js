/* chrome: build-error overlay, edit-mode chrome (outlines, breadcrumb, picking), the editor keydown handler, fit/resize hooks */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;
  var TOKEN = RV.token;

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
        '<button class="rv-dev-open">Open in text editor</button>' +
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

  /* --- inspector: edit mode, picking, breadcrumb --------------------------- */


  function layer() {
    var el = document.getElementById('rv-editor-layer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rv-editor-layer';
      el.innerHTML =
        '<div class="rv-ed-outline rv-ed-hover" hidden></div>' +
        '<div class="rv-ed-outline rv-ed-select" hidden></div>' +
        '<div class="rv-ed-bar" hidden>' +
        '<span class="rv-ed-kind"></span>' +
        '<span class="rv-ed-line"></span>' +
        '<span class="rv-ed-hint">click: select · Esc: parent / exit · Del: delete · E: exit</span>' +
        '</div>';
      document.body.appendChild(el);
    }
    return el;
  }


  function placeOutline(box, el) {
    if (!el || !document.contains(el)) { box.hidden = true; return; }
    var r = el.getBoundingClientRect();
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    box.hidden = false;
  }

  function syncChrome() {
    if (!S.on) return;
    var el = layer();
    placeOutline(el.querySelector('.rv-ed-hover'), S.hover !== S.sel ? S.hover : null);
    placeOutline(el.querySelector('.rv-ed-select'), S.sel);
    F.rvRenderHandles();
    F.rvPanelSync();
    var bar = el.querySelector('.rv-ed-bar');
    if (S.sel && document.contains(S.sel)) {
      var s = S.sel.getAttribute('data-rv-src');
      var e = S.sel.getAttribute('data-rv-src-end');
      el.querySelector('.rv-ed-kind').textContent = F.kindOf(S.sel);
      el.querySelector('.rv-ed-line').textContent =
        '.pres:' + s + (e ? '–' + e : '');
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
  }

  function pickable(target) {
    if (!target || !target.closest) return null;
    var el = target.closest('[data-rv-src]');
    var slide = window.Reveal && Reveal.getCurrentSlide && Reveal.getCurrentSlide();
    if (el && slide && !slide.contains(el) && el.tagName !== 'SECTION') return null;
    return el;
  }

  function onMove(ev) {
    S.hover = pickable(ev.target);
    syncChrome();
  }

  function onClick(ev) {
    var el = pickable(ev.target);
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (el !== S.sel) F.flushNudge();
    RV.set('sel', el);
    syncChrome();
  }

  function selectParent() {
    if (!S.sel) { setEdit(false); return; }
    var parent = S.sel.parentElement && S.sel.parentElement.closest('[data-rv-src]');
    RV.set('sel', parent || null);
    syncChrome();
  }

  function setEdit(on) {
    if (on === S.on) return;
    S.on = on;
    var el = layer();
    document.documentElement.classList.toggle('rv-edit', on);
    if (on) {
      if (window.Reveal && Reveal.getConfig) {
        S.keyboardWas = Reveal.getConfig().keyboard;
        Reveal.configure({ keyboard: false });
      }
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
    } else {
      if (window.Reveal && S.keyboardWas !== null) {
        Reveal.configure({ keyboard: S.keyboardWas });
        S.keyboardWas = null;
      }
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      RV.set('sel', null);
      S.hover = null;
      el.querySelectorAll('.rv-ed-outline').forEach(function (b) { b.hidden = true; });
      el.querySelector('.rv-ed-bar').hidden = true;
      var tag = document.getElementById('rv-ed-hovertag');
      if (tag) tag.style.display = 'none';
    }
    var tbBtn = document.querySelector('#rv-ed-toolbar .rv-tb-edit');
    if (tbBtn) tbBtn.classList.toggle('rv-active', on);
    RV.emit('on');  // panel + split view subscribe to this transition
    syncChrome();
  }

  /* ONE document-level keydown handler for all editor shortcuts. A single
     typing guard keeps every shortcut away from inputs/textareas — arrows
     must not nudge and Ctrl+Z must stay the field's own undo. */
  function isTypingTarget(t) {
    return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
  }

  document.addEventListener('keydown', function (ev) {
    if (isTypingTarget(ev.target)) return;
    if (ev.ctrlKey || ev.metaKey) {
      if (S.on && !ev.altKey && (ev.key === 'z' || ev.key === 'Z')) {
        F.rvUndoRedo(ev.shiftKey ? 'redo' : 'undo');
        ev.preventDefault();
      }
      return;
    }
    if (ev.altKey) return;
    if (ev.key === 'e') {
      setEdit(!S.on);
      ev.preventDefault();
    } else if (S.on && ev.key === 'f') {
      F.toggleDrawer();
      ev.preventDefault();
    } else if (S.on && ev.key === 'Escape') {
      selectParent();
      ev.preventDefault();
      ev.stopPropagation();
    } else if (S.on && S.sel && (ev.key === 'Delete' || ev.key === 'Backspace')) {
      F.flushNudge();
      F.deleteSelected(S.sel);
      ev.preventDefault();
      ev.stopPropagation();
    } else if (S.on && S.sel && RV.NUDGE_ARROWS[ev.key]) {
      F.nudgeSelected(ev);
    }
  }, true);

  // Keep the chrome glued to its targets across fits, slides and resizes.
  function hookFit() {
    if (typeof window.fitSlide === 'function' && !window.fitSlide.__rvWrapped) {
      var orig = window.fitSlide;
      var wrapped = function (s) { orig(s); syncChrome(); };
      wrapped.__rvWrapped = true;
      window.fitSlide = wrapped;
    }
  }
  hookFit();
  window.addEventListener('load', hookFit);
  window.addEventListener('resize', syncChrome);
  if (window.Reveal && Reveal.on) {
    Reveal.on('slidechanged', function () {
      F.flushNudge();
      RV.set('sel', null);
      S.hover = null;
      syncChrome();
    });
  }

  /* --- hover kind tag --------------------------------------------------------------------- */

  function hoverTag(ev) {
    var tag = document.getElementById('rv-ed-hovertag');
    if (!S.on || !S.hover || S.hover === S.sel || S.drag) {
      if (tag) tag.style.display = 'none';
      return;
    }
    if (!tag) {
      tag = document.createElement('div');
      tag.id = 'rv-ed-hovertag';
      document.body.appendChild(tag);
    }
    tag.textContent = F.kindOf(S.hover);
    tag.style.display = 'block';
    tag.style.left = (ev.clientX + 14) + 'px';
    tag.style.top = (ev.clientY + 16) + 'px';
  }

  document.addEventListener('mousemove', function (ev) {
    if (S.on) hoverTag(ev);
  }, true);

  // exports (what other editor/ modules call):
  F.syncChrome = syncChrome;
  F.setEdit = setEdit;
  F.layer = layer;
  F.showError = showError;
  F.hideError = hideError;
})();
