/* RVT — tiny in-browser test runner for the Revealer editor.
 *
 * Served only by the dev server in test mode (never injected into decks,
 * excluded from wheels). Loads BEFORE the editor scripts on the runner
 * page so the EventSource stub is in place when the editor boots there;
 * suites that need the real thing drive a deck iframe instead.
 */
(function () {
  'use strict';

  // The runner page itself must never open a real SSE stream: the editor
  // monolith connects on boot, so the stub has to precede it.
  var RealEventSource = window.EventSource;
  function StubEventSource(url) {
    this.url = url;
    this.onmessage = null;
    StubEventSource.instances.push(this);
  }
  StubEventSource.instances = [];
  StubEventSource.prototype.close = function () {};
  window.EventSource = StubEventSource;

  var realFetch = window.fetch.bind(window);
  var fetchStub = null;
  window.fetch = function (input, init) {
    if (fetchStub) {
      var hijacked = fetchStub(input, init);
      if (hijacked) return hijacked;
    }
    return realFetch(input, init);
  };

  var tests = [];

  window.RVT = {
    realEventSource: RealEventSource,
    stubEventSource: StubEventSource,
    fetch: realFetch,

    test: function (name, fn) { tests.push({ name: name, fn: fn }); },

    // handler(input, init) returning a Promise hijacks the call;
    // returning a falsy value passes it through. null restores.
    stubFetch: function (handler) { fetchStub = handler; },

    assert: function (v, msg) {
      if (!v) throw new Error(msg || 'assertion failed');
    },

    // Poll a synchronous condition; resolves with its truthy value.
    until: function (cond, timeoutMs, what) {
      return new Promise(function (resolve, reject) {
        var t0 = Date.now();
        (function poll() {
          var v = null;
          try { v = cond(); } catch (e) { /* keep polling */ }
          if (v) return resolve(v);
          if (Date.now() - t0 > (timeoutMs || 15000)) {
            return reject(new Error('timeout waiting for ' + (what || 'condition')));
          }
          setTimeout(poll, 100);
        })();
      });
    },

    // Load a same-origin page in an iframe; resolve with the iframe once
    // readySel matches in its document.
    iframe: function (src, readySel, timeoutMs) {
      var f = document.createElement('iframe');
      f.style.cssText = 'width:1200px;height:750px;border:0;display:block;';
      f.src = src;
      document.body.appendChild(f);
      return window.RVT.until(function () {
        var doc = f.contentDocument;
        return doc && doc.querySelector(readySel) ? f : null;
      }, timeoutMs || 15000, readySel + ' in iframe ' + src);
    },

    run: function () {
      // Suites share the origin's sessionStorage with deck iframes; start
      // from a clean slate so editor state can't leak between runs.
      try {
        Object.keys(sessionStorage).forEach(function (k) {
          if (k.indexOf('rv-') === 0) sessionStorage.removeItem(k);
        });
      } catch (e) { /* storage may be disabled */ }

      var results = [];
      var chain = Promise.resolve();
      tests.forEach(function (t) {
        chain = chain.then(function () {
          var t0 = Date.now();
          return Promise.resolve().then(t.fn).then(function () {
            results.push({ name: t.name, ok: true, ms: Date.now() - t0 });
          }, function (err) {
            results.push({
              name: t.name, ok: false, ms: Date.now() - t0,
              error: String((err && err.stack) || err),
            });
          });
        });
      });
      return chain.then(function () {
        var failed = results.filter(function (r) { return !r.ok; }).length;
        document.title = 'rv tests: ' + (failed ? failed + ' failed' : 'all passed');
        return realFetch('/__rv__/test-results', {
          method: 'POST',
          headers: {
            'X-RV-Token': (window.__RV_DEV__ || {}).token || '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ done: true, results: results }),
        });
      });
    },
  };
})();
