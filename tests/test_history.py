"""Shadow-git save history: helpers + the undo cursor (P3b)."""

from __future__ import annotations

import hashlib
import http.client
import json
import shutil
import threading

import pytest

from revealer import serve as serve_mod
from revealer.serve import (
    HISTORY_DIR,
    _blob_bytes,
    _history_commit,
    _history_init,
    _history_list,
    _history_show,
    _resolve_position,
)

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="needs git")

PRES = """> title: History test

=== One
> row
> col 2/5
hello
> end: row

=== Two

Some text.
"""


# --------------------------------------------------------------- helpers

def test_history_cycle(tmp_path):
    pdir = tmp_path / "deck"
    pdir.mkdir()
    pres = pdir / "talk.pres"
    pres.write_text("=== One\n\nv1\n")
    assert _history_init(pdir)
    assert (pdir / HISTORY_DIR / "HEAD").exists()
    assert not (pdir / ".git").exists()  # never touches a real repo

    assert _history_commit(pdir, pres, "first", auto=True)
    assert not _history_commit(pdir, pres, "again", auto=True)  # no change → no commit
    pres.write_text("=== One\n\nv2\n")
    assert _history_commit(pdir, pres, "note", auto=False)

    entries = _history_list(pdir)
    assert len(entries) == 2
    assert entries[0]["msg"] == "save: note" and entries[0]["auto"] is False
    assert entries[1]["auto"] is True

    old = _history_show(pdir, pres, entries[1]["hash"])
    assert old == "=== One\n\nv1\n"
    assert _history_show(pdir, pres, "nothex!") is None


def test_bytes_fidelity_crlf_and_utf8(tmp_path):
    """History round-trips are byte-exact: CRLF and accents survive."""
    pdir = tmp_path / "deck"
    pdir.mkdir()
    pres = pdir / "talk.pres"
    original = "=== Théorème\r\n\r\nv1 — café\r\n".encode("utf-8")
    pres.write_bytes(original)
    assert _history_commit(pdir, pres, "crlf", auto=True)
    pres.write_bytes(b"=== One\n\nv2\n")
    assert _history_commit(pdir, pres, "lf", auto=True)
    first = _history_list(pdir)[-1]["hash"]
    assert _blob_bytes(pdir, pres, first) == original


# ------------------------------------------------- server-level fixtures

@pytest.fixture()
def server(deck):
    pdir = deck(PRES, name="srv")
    httpd, sess, stop = serve_mod.create_server(pdir / "srv.pres", port=0, watch=False)
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


def _sha(pdir):
    return hashlib.sha256((pdir / "srv.pres").read_bytes()).hexdigest()


def _edit(port, pdir, sess, size):
    body = json.dumps({"sha256": _sha(pdir), "edits": [
        {"op": "set_col_size", "line": 5, "new": size}]})
    return _req(port, "POST", "/__rv__/edit", body=body.encode(), token=sess.token)


def _commits(pdir):
    return _history_list(pdir)


# ------------------------------------------------------- the undo cursor

def test_cursor_walk_and_commit_counts(server):
    port, sess, pdir = server
    assert _edit(port, pdir, sess, "1/2")[0] == 200
    assert _edit(port, pdir, sess, "1/3")[0] == 200
    n = len(_commits(pdir))
    assert n >= 3  # initial build + two edits

    # undo steps back without creating commits
    status, j = _req(port, "POST", "/__rv__/undo", token=sess.token)
    assert status == 200 and j["cursor"]
    assert "> col 1/2" in (pdir / "srv.pres").read_text()
    assert len(_commits(pdir)) == n

    status, j = _req(port, "POST", "/__rv__/undo", token=sess.token)
    assert status == 200
    assert "> col 2/5" in (pdir / "srv.pres").read_text()
    assert len(_commits(pdir)) == n

    # redo walks forward; reaching HEAD clears the cursor
    status, j = _req(port, "POST", "/__rv__/redo", token=sess.token)
    assert status == 200 and "> col 1/2" in (pdir / "srv.pres").read_text()
    status, j = _req(port, "POST", "/__rv__/redo", token=sess.token)
    assert status == 200 and j["cursor"] is None
    assert "> col 1/3" in (pdir / "srv.pres").read_text()
    assert _req(port, "POST", "/__rv__/redo", token=sess.token)[0] == 409
    assert len(_commits(pdir)) == n

    # the drawer payload carries the cursor
    status, j = _req(port, "GET", "/__rv__/history?token=" + sess.token)
    assert status == 200 and j["cursor"] is None


def test_edit_at_detached_cursor_rewinds_and_cuts_redo(server):
    port, sess, pdir = server
    assert _edit(port, pdir, sess, "1/2")[0] == 200
    assert _edit(port, pdir, sess, "1/3")[0] == 200
    n = len(_commits(pdir))
    assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 200
    assert sess.cursor is not None

    # editing while detached appends a rewind commit + the new content
    assert _edit(port, pdir, sess, "3/4")[0] == 200
    assert sess.cursor is None
    entries = _commits(pdir)
    assert len(entries) == n + 2
    assert entries[1]["msg"] == "auto: rewind"
    assert "> col 3/4" in (pdir / "srv.pres").read_text()
    # the branch-point is gone: redo has nothing to walk to
    assert _req(port, "POST", "/__rv__/redo", token=sess.token)[0] == 409
    # but nothing was lost: undo reaches 1/2 (the rewind), then 1/3 below it
    assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 200
    assert "> col 1/2" in (pdir / "srv.pres").read_text()
    assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 200
    assert "> col 1/3" in (pdir / "srv.pres").read_text()


def test_hand_edit_dirty_slot_double_undo_redo(server):
    port, sess, pdir = server
    assert _edit(port, pdir, sess, "1/2")[0] == 200
    hand = PRES.replace("hello", "hand-edited").replace("2/5", "1/2")
    (pdir / "srv.pres").write_text(hand)
    assert _resolve_position(sess) == "dirty"

    # dirty undo: the unbuilt state is kept aside, file goes to HEAD
    assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 200
    assert "hello" in (pdir / "srv.pres").read_text()
    assert sess.dirty_keep is not None
    # a second undo keeps walking history; the slot survives
    assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 200
    assert "> col 2/5" in (pdir / "srv.pres").read_text()
    assert sess.dirty_keep is not None
    # redo back to HEAD, then redo restores the hand-edited state
    assert _req(port, "POST", "/__rv__/redo", token=sess.token)[0] == 200
    status, j = _req(port, "POST", "/__rv__/redo", token=sess.token)
    assert status == 200
    assert (pdir / "srv.pres").read_text() == hand
    assert sess.dirty_keep is None
    assert _req(port, "POST", "/__rv__/redo", token=sess.token)[0] == 409


def test_restart_persistence(deck):
    pdir = deck(PRES, name="srv")
    httpd, sess, stop = serve_mod.create_server(pdir / "srv.pres", port=0, watch=False)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    port = httpd.server_address[1]
    assert _edit(port, pdir, sess, "1/2")[0] == 200
    stop.set()
    httpd.shutdown()

    # a fresh session on the same deck can still undo — history is on disk
    httpd2, sess2, stop2 = serve_mod.create_server(pdir / "srv.pres", port=0, watch=False)
    t2 = threading.Thread(target=httpd2.serve_forever, daemon=True)
    t2.start()
    try:
        port2 = httpd2.server_address[1]
        assert sess2.cursor is None
        assert _req(port2, "POST", "/__rv__/undo", token=sess2.token)[0] == 200
        assert "> col 2/5" in (pdir / "srv.pres").read_text()
    finally:
        stop2.set()
        httpd2.shutdown()


def test_restore_then_undo(server):
    port, sess, pdir = server
    assert _edit(port, pdir, sess, "1/2")[0] == 200
    first = _commits(pdir)[-1]["hash"]  # the initial 2/5 state

    body = json.dumps({"hash": first}).encode()
    status, j = _req(port, "POST", "/__rv__/history/restore", body=body,
                     token=sess.token)
    assert status == 200 and j["ok"] and "bib_differs" in j
    assert "> col 2/5" in (pdir / "srv.pres").read_text()
    # a restore is itself a history entry: undo returns to the 1/2 state
    assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 200
    assert "> col 1/2" in (pdir / "srv.pres").read_text()


def test_failed_edit_at_detached_cursor_keeps_cursor(server):
    port, sess, pdir = server
    assert _edit(port, pdir, sess, "1/2")[0] == 200
    assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 200
    cursor = sess.cursor
    assert cursor

    # a rejected edit (bad op target) must not move the cursor or commit
    n = len(_commits(pdir))
    bad = json.dumps({"sha256": _sha(pdir), "edits": [
        {"op": "set_pin", "line": 5, "x": "1%", "y": "1%"}]})
    assert _req(port, "POST", "/__rv__/edit", body=bad.encode(),
                token=sess.token)[0] == 422
    assert sess.cursor == cursor and len(_commits(pdir)) == n
    # redo still works
    assert _req(port, "POST", "/__rv__/redo", token=sess.token)[0] == 200
    assert "> col 1/2" in (pdir / "srv.pres").read_text()


def test_manual_snapshot_at_detached_cursor(server):
    port, sess, pdir = server
    assert _edit(port, pdir, sess, "1/2")[0] == 200
    assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 200
    n = len(_commits(pdir))

    body = json.dumps({"message": "keep this"}).encode()
    status, j = _req(port, "POST", "/__rv__/history/commit", body=body,
                     token=sess.token)
    assert status == 200 and j["committed"]
    entries = _commits(pdir)
    # exactly one rewind commit, carrying the user's message; cursor cleared
    assert len(entries) == n + 1
    assert entries[0]["msg"] == "save: keep this"
    assert sess.cursor is None
    assert _resolve_position(sess) == "at_head"


def test_no_git_fallback(deck, monkeypatch):
    real_which = shutil.which
    monkeypatch.setattr(serve_mod.shutil, "which",
                        lambda cmd: None if cmd == "git" else real_which(cmd))
    pdir = deck(PRES, name="srv")
    httpd, sess, stop = serve_mod.create_server(pdir / "srv.pres", port=0, watch=False)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        port = httpd.server_address[1]
        assert sess.history_mode == "fallback"
        assert not (pdir / HISTORY_DIR).exists()
        # no undo before any edit
        assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 409
        assert _edit(port, pdir, sess, "1/2")[0] == 200
        # single-slot undo swaps; a second undo re-does; redo endpoint 409s
        assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 200
        assert "> col 2/5" in (pdir / "srv.pres").read_text()
        assert _req(port, "POST", "/__rv__/redo", token=sess.token)[0] == 409
        assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 200
        assert "> col 1/2" in (pdir / "srv.pres").read_text()
    finally:
        stop.set()
        httpd.shutdown()


def test_bib_differs_flag(deck):
    pdir = deck(PRES, name="srv")
    (pdir / "refs.bib").write_text("@article{a, title={One}}\n")
    httpd, sess, stop = serve_mod.create_server(pdir / "srv.pres", port=0, watch=False)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        port = httpd.server_address[1]
        assert _edit(port, pdir, sess, "1/2")[0] == 200
        # same bib in both commits → no warning
        status, j = _req(port, "POST", "/__rv__/undo", token=sess.token)
        assert status == 200 and j["bib_differs"] is False
        assert _req(port, "POST", "/__rv__/redo", token=sess.token)[0] == 200
        # change the bib after the last commit → the undo target's bib differs
        (pdir / "refs.bib").write_text("@article{a, title={Two}}\n")
        status, j = _req(port, "POST", "/__rv__/undo", token=sess.token)
        assert status == 200 and j["bib_differs"] is True
    finally:
        stop.set()
        httpd.shutdown()
