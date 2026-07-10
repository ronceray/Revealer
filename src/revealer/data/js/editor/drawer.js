/* drawer: the fragment drawer — list the slide's fragments in reveal order and reorder them */
(function () {
  'use strict';
  if (!window.__RV_DEV__) return;
  var RV = window.RV;
  var S = RV.state;
  var F = RV.fn;

  /* --- fragment drawer -------------------------------------------------------------------- */

  function fragmentsOnSlide() {
    var slide = Reveal.getCurrentSlide();
    if (!slide) return [];
    var els = Array.prototype.slice.call(slide.querySelectorAll('.fragment'));
    els.sort(function (a, b) {
      var ia = parseInt(a.getAttribute('data-fragment-index') || '9999', 10);
      var ib = parseInt(b.getAttribute('data-fragment-index') || '9999', 10);
      return ia - ib;
    });
    return els;
  }

  function fragConstruct(el) {
    var k = F.constructOf(el);
    if (k === 'region') return 'col';
    if (k === 'media') return 'media';
    if (k === 'layer') return 'layer';
    if (k === 'card') return 'card';
    if (k === 'box') return 'box';
    if (k === 'eq') return 'eq';
    if (k === 'pin') return 'pin';
    if (k === 'row') return 'row';
    return 'frag';
  }

  function toggleDrawer() {
    var w = RV.ui.box({ id: 'rv-ed-drawer', title: RV.t('drawer.title') });
    if (!w) return;
    w.body.innerHTML = '<div class="rv-ed-drawer-list"></div>' +
      '<div class="rv-ed-drawer-foot">' + RV.esc(RV.t('drawer.foot')) + '</div>';
    renderDrawer();
  }

  function renderDrawer() {
    var dw = document.getElementById('rv-ed-drawer');
    if (!dw) return;
    var list = dw.querySelector('.rv-ed-drawer-list');
    list.innerHTML = '';
    var frags = fragmentsOnSlide();
    frags.forEach(function (el, i) {
      var row = document.createElement('div');
      row.className = 'rv-ed-drawer-item';
      var mapped = el.hasAttribute('data-rv-src');
      var label = F.kindOf(el) + (mapped ? ' · :' + el.getAttribute('data-rv-src') : ' · ' + RV.t('drawer.unmapped'));
      row.innerHTML = '<span>' + (i + 1) + '. ' + label + '</span>' +
        (mapped ? '<span class="rv-ed-updown"><button data-d="-1">↑</button>' +
                  '<button data-d="1">↓</button></span>' : '');
      row.addEventListener('mouseenter', function () { S.hover = el; F.syncChrome(); });
      row.addEventListener('mouseleave', function () { S.hover = null; F.syncChrome(); });
      row.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          reorderFragment(frags, i, parseInt(b.getAttribute('data-d'), 10));
        });
      });
      list.appendChild(row);
    });
    if (!frags.length) list.innerHTML = '<div class="rv-ed-drawer-item">' + RV.esc(RV.t('drawer.none')) + '</div>';
  }

  function reorderFragment(frags, i, delta) {
    var j = i + delta;
    if (j < 0 || j >= frags.length) return;
    var order = frags.slice();
    var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    var mapped = order.filter(function (el) { return el.hasAttribute('data-rv-src'); });
    if (mapped.length !== order.length) {
      F.toast(RV.t('drawer.rawHtml'));
    }
    if (!mapped.length) return;
    F.rvPostEdit([{
      op: 'reorder_fragments',
      order: mapped.map(function (el) {
        return { line: F.srcOf(el), construct: fragConstruct(el) };
      }),
    }], F.fileOf(mapped[0]));
  }

  // exports (what other editor/ modules call):
  F.toggleDrawer = toggleDrawer;
})();
