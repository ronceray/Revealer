"""P8: multi-file include editing — per-file provenance, edits, undo."""

from __future__ import annotations

import hashlib
import http.client
import json
import threading

import pytest

from revealer import serve as serve_mod

MAIN = """> title: Course

=== Intro
> pin: 40% 40% 20%
main pinned
> end: pin

> include: l1.pres
"""

L1 = """=== Lecture one
> pin: 30% 60% 15%
included pinned
> end: pin

included tail text
"""


@pytest.fixture()
def course(deck):
    pdir = deck(MAIN, name="crs", media={"l1.pres": L1.encode("utf-8")})
    httpd, sess, stop = serve_mod.create_server(pdir / "crs.pres", port=0,
                                                watch=False)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield httpd.server_address[1], sess, pdir
    stop.set()
    httpd.shutdown()


def _req(port, method, path, body=None, token=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    headers = {"X-RV-Token": token} if token else {}
    conn.request(method, path, body=body, headers=headers)
    r = conn.getresponse()
    data = r.read()
    conn.close()
    return r.status, json.loads(data) if data else {}


def _sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def test_src_and_inspect_accept_file(course):
    port, sess, pdir = course
    status, j = _req(port, "GET",
                     "/__rv__/src?start=2&end=2&file=l1.pres&token=" + sess.token)
    assert status == 200
    assert j["lines"] == ["> pin: 30% 60% 15%"]
    assert j["sha256"] == _sha(pdir / "l1.pres")

    status, j = _req(port, "GET",
                     "/__rv__/inspect?start=6&end=6&file=l1.pres&token=" + sess.token)
    assert status == 200
    assert j["lines"][0]["text"] == "included tail text"

    assert _req(port, "GET", "/__rv__/src?start=1&end=1&file=nope.pres&token="
                + sess.token)[0] == 422


def test_edit_routes_to_include_with_per_file_sha(course):
    port, sess, pdir = course
    inc = pdir / "l1.pres"
    body = json.dumps({"file": "l1.pres", "sha256": _sha(inc), "edits": [
        {"op": "set_pin", "line": 2, "x": "55%", "y": "65%", "w": "15%"}]})
    status, j = _req(port, "POST", "/__rv__/edit", body=body.encode(),
                     token=sess.token)
    assert status == 200, j
    assert "> pin: 55% 65% 15%" in inc.read_text()
    assert j["sha256"] == _sha(inc) and j["file"] == "l1.pres"
    # the main file was never touched
    assert "> pin: 40% 40% 20%" in (pdir / "crs.pres").read_text()

    # a stale per-file sha 409s against THAT file
    stale = json.dumps({"file": "l1.pres", "sha256": "0" * 64, "edits": [
        {"op": "set_pin", "line": 2, "x": "1%", "y": "1%"}]})
    assert _req(port, "POST", "/__rv__/edit", body=stale.encode(),
                token=sess.token)[0] == 409

    # unknown files are refused before any read
    bad = json.dumps({"file": "../../etc/passwd", "sha256": "0" * 64,
                      "edits": [{"op": "set_pin", "line": 2, "x": "1%", "y": "1%"}]})
    status, j = _req(port, "POST", "/__rv__/edit", body=bad.encode(),
                     token=sess.token)
    assert status == 422 and j["error"] == "unknown_file"


def test_undo_spans_files(course):
    port, sess, pdir = course
    if sess.history_mode != "git":
        pytest.skip("needs git")
    inc = pdir / "l1.pres"
    body = json.dumps({"file": "l1.pres", "sha256": _sha(inc), "edits": [
        {"op": "set_pin", "line": 2, "x": "55%", "y": "65%", "w": "15%"}]})
    assert _req(port, "POST", "/__rv__/edit", body=body.encode(),
                token=sess.token)[0] == 200
    assert "55% 65% 15%" in inc.read_text()

    # undo walks the shadow git and restores the INCLUDE's previous bytes
    assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 200
    assert "> pin: 30% 60% 15%" in inc.read_text()
    assert _req(port, "POST", "/__rv__/redo", token=sess.token)[0] == 200
    assert "55% 65% 15%" in inc.read_text()


def test_dev_html_marks_included_regions(course):
    port, sess, pdir = course
    html = (pdir / "crs.dev.html").read_text(encoding="utf-8")
    import re
    assert re.search(r'data-rv-src="\d+" data-rv-f="1"', html)
    assert 'rv-src-files' in html


def test_dirty_undo_preserves_uncommitted_include_edit(deck):
    """A hand-edited non-.pres include (watcher-ignored) survives undo->redo."""
    pdir = deck("> title: C\n\n=== Intro\n> pin: 40% 40% 20%\nmain\n> end: pin\n"
                "\n> include: notes.md\n", name="crs",
                media={"notes.md": b"=== Notes\n\noriginal note\n"})
    httpd, sess, stop = serve_mod.create_server(pdir / "crs.pres", port=0,
                                                watch=False)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        if sess.history_mode != "git":
            import pytest
            pytest.skip("needs git")
        port = httpd.server_address[1]
        notes = pdir / "notes.md"
        # hand-edit the include (never auto-committed: .md isn't watched)
        notes.write_text("=== Notes\n\nHAND EDITED note\n")
        # undo: the dirty include state must be kept aside, not destroyed
        assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 200
        assert "original note" in notes.read_text()  # stepped to HEAD
        # redo: the hand edit comes back (was in dirty_keep)
        assert _req(port, "POST", "/__rv__/redo", token=sess.token)[0] == 200
        assert "HAND EDITED note" in notes.read_text()
    finally:
        stop.set()
        httpd.shutdown()


def test_restore_unchanged_considers_includes(course):
    port, sess, pdir = course
    if sess.history_mode != "git":
        import pytest
        pytest.skip("needs git")
    inc = pdir / "l1.pres"
    # snapshot the current (C0) commit hash, then change ONLY the include
    entries0 = serve_mod._history_list(pdir)
    c0 = entries0[0]["hash"]
    body = json.dumps({"file": "l1.pres", "sha256": _sha(inc), "edits": [
        {"op": "set_pin", "line": 2, "x": "55%", "y": "65%", "w": "15%"}]})
    assert _req(port, "POST", "/__rv__/edit", body=body.encode(),
                token=sess.token)[0] == 200
    assert "55% 65%" in inc.read_text()
    # restoring C0 (differs only in the include) must NOT report unchanged
    status, j = _req(port, "POST", "/__rv__/history/restore",
                     body=json.dumps({"hash": c0}).encode(), token=sess.token)
    assert status == 200 and not j.get("unchanged"), j
    assert "> pin: 30% 60% 15%" in inc.read_text()  # include actually restored
