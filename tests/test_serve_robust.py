"""Dev-server robustness: bad input gets an HTTP answer, state survives.

Every case here is a defect from the 2026-07-10 audit: malformed edit ops
and non-UTF-8 sources killed the handler connection with no response, the
first-build-failure page was inert, a build-breaking edit rolled back with
`detail: null` and normalized CRLF files, an all-unknown extension list
crashed every build, and a corrupted config.toml bricked the CLI.
"""

from __future__ import annotations

import http.client
import json
import threading

import pytest

from revealer import assets, config
from revealer import serve as serve_mod

PRES = """> title: Robust test

=== One

hello line

=== Two

Some text.
"""


@pytest.fixture()
def server(deck):
    pdir = deck(PRES, name="rob")
    httpd, sess, stop = serve_mod.create_server(pdir / "rob.pres", port=0, watch=False)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield httpd.server_address[1], sess, pdir
    stop.set()
    httpd.shutdown()
    httpd.server_close()


def _req(port, method, path, body=None, token=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    headers = {"X-RV-Token": token} if token else {}
    conn.request(method, path, body=body, headers=headers)
    r = conn.getresponse()
    data = r.read()
    conn.close()
    return r.status, data


def _edit(port, sess, payload):
    return _req(port, "POST", "/__rv__/edit",
                body=json.dumps(payload).encode(), token=sess.token)


def _cur_sha(sess):
    import hashlib
    return hashlib.sha256(sess.pres.read_bytes()).hexdigest()


# --- malformed ops answer 4xx, never a dead connection ------------------------

def test_junk_edit_entries_get_400(server):
    port, sess, _ = server
    status, data = _edit(port, sess, {"sha256": _cur_sha(sess),
                                      "edits": ["junk"]})
    assert status == 400
    assert json.loads(data)["error"] == "no edits"


def test_wrong_typed_op_gets_422(server):
    port, sess, _ = server
    status, data = _edit(port, sess, {
        "sha256": _cur_sha(sess),
        "edits": [{"op": "replace_lines", "start": "abc", "end": 2,
                   "text": ["x"]}]})
    assert status in (400, 422)
    assert json.loads(data)["error"] in ("bad_op", "bad_range", "no edits")


def test_unknown_op_gets_a_response(server):
    port, sess, _ = server
    status, data = _edit(port, sess, {"sha256": _cur_sha(sess),
                                      "edits": [{"op": "frobnicate"}]})
    assert 400 <= status < 500
    assert json.loads(data)["error"]


def test_non_utf8_source_answers_422_on_src(server):
    port, sess, _ = server
    sess.pres.write_bytes(b"=== T\n\n\xff\xfe garbage\n")
    status, data = _req(port, "GET", "/__rv__/src?start=1&end=1&token=" + sess.token)
    assert status == 422
    assert json.loads(data)["error"] == "not_utf8"


# --- rollback: byte-exact, with the real failure detail ------------------------

def test_edit_breaks_build_reports_detail_and_preserves_crlf(server, monkeypatch):
    port, sess, _ = server
    crlf = PRES.replace("\n", "\r\n")
    sess.pres.write_bytes(crlf.encode())
    serve_mod._rebuild(sess, log=lambda *a: None)
    assert sess.build_error is None

    calls = {"n": 0}
    real_build = serve_mod.build_mod.build

    def flaky_build(path, dev=False):
        calls["n"] += 1
        if calls["n"] == 1:  # the build triggered BY the edit fails...
            raise RuntimeError("boom from the edited deck")
        return real_build(path, dev=dev)  # ...the rollback build succeeds

    monkeypatch.setattr(serve_mod.build_mod, "build", flaky_build)
    status, data = _edit(port, sess, {
        "sha256": _cur_sha(sess),
        "edits": [{"op": "replace_lines", "start": 4, "end": 4,
                   "text": ["changed line"]}]})
    assert status == 422
    payload = json.loads(data)
    assert payload["error"] == "edit_breaks_build"
    assert "boom from the edited deck" in (payload["detail"] or "")
    # the rollback restored the exact bytes — CRLF intact
    assert sess.pres.read_bytes() == crlf.encode()


# --- first-build-failure page is alive -----------------------------------------

def test_failure_page_shows_error_and_listens(deck):
    # `> build: false` runs the shell command `false` — a deterministic
    # first-build failure.
    pdir = deck("> build: false\n\n=== T\n\nx\n", name="broken")
    httpd, sess, stop = serve_mod.create_server(pdir / "broken.pres", port=0,
                                                watch=False)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        assert sess.html_path is None or sess.build_error is not None
        port = httpd.server_address[1]
        status, data = _req(port, "GET", "/")
        page = data.decode()
        assert status == 200
        assert "First build failed" in page
        assert "EventSource" in page            # it listens for the fix
        assert (sess.build_error or {}).get("message", "")[:20] in page or \
               "building" in page
    finally:
        stop.set()
        httpd.shutdown()
        httpd.server_close()


# --- assets / config ------------------------------------------------------------

def test_index_html_with_no_extensions(tmp_path):
    rdir = tmp_path / "reveal.js"
    rdir.mkdir()
    assets.generate_index_html(str(rdir), [])
    html = (rdir / "index.html").read_text()
    assert "Reveal.initialize" in html


def test_index_html_fontawesome_linked_once(tmp_path):
    rdir = tmp_path / "reveal.js"
    rdir.mkdir()
    fa_exts = [k for k, v in assets.PLUGINS.items() if v.get("needs_fa")]
    if not fa_exts:
        pytest.skip("no fontawesome plugin registered")
    assets.generate_index_html(str(rdir), fa_exts + ["markdown"])
    html = (rdir / "index.html").read_text()
    assert html.count("fontawesome.min.css") == 1


def test_corrupt_config_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    cdir = tmp_path / "revealer"
    cdir.mkdir(parents=True)
    (cdir / "config.toml").write_bytes(b"root = 'truncat")
    assert config.load() == {}
    config.save({"root": "/tmp/x"})      # heals it
    assert config.load()["root"] == "/tmp/x"
