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
      var selFile = F.fileOf(S.sel);
      el.querySelector('.rv-ed-line').textContent =
        (selFile || '.pres') + ':' + s + (e ? '–' + e : '');
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

  /* --- touch: long-press to select, double-tap to reach the panel ----------
     A tap already selects via the synthesized click; touch adds two gestures.
     LONG-PRESS (~500 ms stationary) selects under the finger — the same as a
     click but reachable without a hover. DOUBLE-TAP on the already-selected
     element scrolls the side panel into view and focuses its first control.
     Everything here is guarded on pointerType==='touch', so mouse/pen keep
     the exact click/hover behavior above. */
  var LONG_PRESS_MS = 500;
  var TAP_MOVE = 10;            // px of drift that turns a press into a scroll
  var DBL_TAP_MS = 320;
  var touch = { timer: null, x: 0, y: 0, el: null, moved: false,
                lastT: 0, lastEl: null };

  function clearLongPress() {
    if (touch.timer) { clearTimeout(touch.timer); touch.timer = null; }
  }

  function focusPanel() {
    if (F.rvPanelSync) F.rvPanelSync();
    var p = document.getElementById('rv-ed-panel');
    if (!p) return;
    try { p.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    var ctl = p.querySelector('input, textarea, select, button');
    if (ctl && ctl.focus) { try { ctl.focus(); } catch (e) {} }
  }

  function onTouchDown(ev) {
    if (ev.pointerType !== 'touch') return;
    clearLongPress();
    var el = pickable(ev.target);
    touch.el = el;
    touch.x = ev.clientX; touch.y = ev.clientY; touch.moved = false;
    if (!el) return;
    touch.timer = setTimeout(function () {
      touch.timer = null;
      touch.moved = true;          // the trailing pointerup is not a tap
      if (el !== S.sel) F.flushNudge();
      RV.set('sel', el);
      syncChrome();
    }, LONG_PRESS_MS);
  }

  function onTouchMove(ev) {
    if (ev.pointerType !== 'touch' || !touch.el) return;
    if (Math.abs(ev.clientX - touch.x) > TAP_MOVE ||
        Math.abs(ev.clientY - touch.y) > TAP_MOVE) {
      touch.moved = true;
      clearLongPress();
    }
  }

  function onTouchUp(ev) {
    if (ev.pointerType !== 'touch') return;
    clearLongPress();
    var el = touch.el;
    touch.el = null;
    if (touch.moved || !el) { touch.lastT = 0; touch.lastEl = null; return; }
    var now = Date.now();
    if (touch.lastEl === el && el === S.sel && now - touch.lastT < DBL_TAP_MS) {
      focusPanel();               // double-tap on the selection → open panel
      touch.lastT = 0; touch.lastEl = null;
    } else {
      touch.lastT = now; touch.lastEl = el;
    }
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
      document.addEventListener('pointerdown', onTouchDown, true);
      document.addEventListener('pointermove', onTouchMove, true);
      document.addEventListener('pointerup', onTouchUp, true);
      document.addEventListener('pointercancel', onTouchUp, true);
    } else {
      if (window.Reveal && S.keyboardWas !== null) {
        Reveal.configure({ keyboard: S.keyboardWas });
        S.keyboardWas = null;
      }
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointerdown', onTouchDown, true);
      document.removeEventListener('pointermove', onTouchMove, true);
      document.removeEventListener('pointerup', onTouchUp, true);
      document.removeEventListener('pointercancel', onTouchUp, true);
      clearLongPress();
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
    return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                    t.tagName === 'SELECT' || t.isContentEditable));
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
    } else if (S.on && ev.key === 'o') {
      F.toggleOutline();
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
