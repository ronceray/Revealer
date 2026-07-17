/* Session restore across the save-rebuild-reload cycle. restoreState must
 * run only after every editor module has populated RV.fn (a cache-warm
 * reload has Reveal ready before core.js runs; arming there called
 * F.setEdit while it was still undefined and edit mode silently died on
 * every save), and the restore key must only be honored by the reload it
 * was written for — never by a fresh document that happens to find it. */
(function () {
  'use strict';

  RVT.test('edit mode and slide survive saveStateAndReload', function () {
    var f;
    return RVT.iframe('/', '#rv-ed-toolbar').then(function (fr) {
      f = fr;
      return RVT.until(function () {
        var w = f.contentWindow;
        return w.Reveal && w.Reveal.isReady && w.Reveal.isReady() &&
               w.RV && w.RV.fn.setEdit ? f : null;
      }, 15000, 'deck iframe booted');
    }).then(function () {
      var w = f.contentWindow;
      w.RV.fn.setEdit(true);
      w.Reveal.slide(1, 0);
      f.contentDocument.documentElement.setAttribute('data-rvt-pre', '1');
      w.RV.fn.saveStateAndReload();
      return RVT.until(function () {
        var d = f.contentDocument;
        var w2 = f.contentWindow;
        return d && !d.documentElement.hasAttribute('data-rvt-pre') &&
               d.documentElement.classList.contains('rv-edit') &&
               w2.Reveal && w2.Reveal.isReady && w2.Reveal.isReady() ? f : null;
      }, 15000, 'edit mode restored after the reload');
    }).then(function () {
      RVT.assert(f.contentWindow.RV.state.on === true, 'RV.state.on restored');
      RVT.assert(f.contentWindow.Reveal.getIndices().h === 1,
                 'slide restored across the reload');
      RVT.assert(sessionStorage.getItem('rv-dev-restore') === null,
                 'restore key consumed');
      f.remove();
      return true;
    });
  });

  RVT.test('a fresh document drops a stale restore key instead of adopting it', function () {
    sessionStorage.setItem('rv-dev-restore', JSON.stringify({
      h: 1, v: 0, f: -1, editOn: true, selSrc: null,
      drawer: false, outline: false,
    }));
    var f;
    return RVT.iframe('/', '#rv-ed-toolbar').then(function (fr) {
      f = fr;
      return RVT.until(function () {
        var w = f.contentWindow;
        return w.Reveal && w.Reveal.isReady && w.Reveal.isReady() &&
               w.RV ? f : null;
      }, 15000, 'deck iframe booted');
    }).then(function () {
      return RVT.until(function () {
        return sessionStorage.getItem('rv-dev-restore') === null;
      }, 15000, 'stale key dropped');
    }).then(function () {
      RVT.assert(f.contentWindow.RV.state.on === false,
                 'a fresh load must not adopt another session’s edit mode');
      RVT.assert(!f.contentDocument.documentElement.classList.contains('rv-edit'),
                 'no rv-edit chrome on a fresh load');
      f.remove();
      return true;
    });
  });
})();
