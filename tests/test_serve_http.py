"""HTTP-layer tests for the dev server (token/Host gates, edit cycle, upload)."""

from __future__ import annotations

import hashlib
import http.client
import json
import threading

import pytest

from revealer import serve as serve_mod

PRES = """> title: Serve test

=== One
> row
> col 2/5
hello
> end: row

=== Two

Some text.
"""

_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63f8ffff3f0300050001a5f645400000000049454e44ae426082"
)


@pytest.fixture()
def server(deck):
    pdir = deck(PRES, name="srv")
    httpd, sess, stop = serve_mod.create_server(pdir / "srv.pres", port=0, watch=False)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield httpd.server_address[1], sess, pdir
    stop.set()
    httpd.shutdown()


def _req(port, method, path, body=None, token=None, host=None, ctype=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    headers = {}
    if token:
        headers["X-RV-Token"] = token
    if host:
        headers["Host"] = host
    if ctype:
        headers["Content-Type"] = ctype
    conn.request(method, path, body=body, headers=headers)
    r = conn.getresponse()
    data = r.read()
    conn.close()
    return r.status, data


def _sha(pdir):
    return hashlib.sha256((pdir / "srv.pres").read_bytes()).hexdigest()


def test_host_gate(server):
    port, sess, pdir = server
    assert _req(port, "GET", "/", host="evil.example.com")[0] == 403
    assert _req(port, "HEAD", "/srv.pres", host="evil.example.com")[0] == 403
    assert _req(port, "GET", "/")[0] == 200
    assert _req(port, "HEAD", "/srv.pres")[0] == 200


def test_token_gate(server):
    port, sess, pdir = server
    assert _req(port, "GET", "/__rv__/src?start=1&end=1")[0] == 403
    status, data = _req(port, "GET",
                        "/__rv__/src?start=1&end=1&token=" + sess.token)
    assert status == 200
    assert json.loads(data)["lines"] == ["> title: Serve test"]
    assert _req(port, "POST", "/__rv__/edit", body=b"{}")[0] == 403


def test_edit_cycle_and_errors(server):
    port, sess, pdir = server
    ok = json.dumps({"sha256": _sha(pdir), "edits": [
        {"op": "set_col_size", "line": 5, "new": "1/2"}]})
    status, data = _req(port, "POST", "/__rv__/edit", body=ok.encode(),
                        token=sess.token, ctype="application/json")
    assert status == 200, data
    assert "> col 1/2" in (pdir / "srv.pres").read_text()

    stale = json.dumps({"sha256": "0" * 64, "edits": [
        {"op": "set_col_size", "line": 5, "new": "2/5"}]})
    assert _req(port, "POST", "/__rv__/edit", body=stale.encode(),
                token=sess.token)[0] == 409

    bad = json.dumps({"sha256": _sha(pdir), "edits": [
        {"op": "set_pin", "line": 5, "x": "1%", "y": "1%"}]})
    assert _req(port, "POST", "/__rv__/edit", body=bad.encode(),
                token=sess.token)[0] == 422

    assert _req(port, "POST", "/__rv__/undo", token=sess.token)[0] == 200
    assert "> col 2/5" in (pdir / "srv.pres").read_text()


def test_upload_sniff_subdirs_and_dedupe(server):
    port, sess, pdir = server
    # image magic mismatch rejected
    assert _req(port, "PUT", "/__rv__/upload?name=fake.png", body=b"not a png",
                token=sess.token)[0] == 400
    # real png routed into auto-created Media/Images
    status, data = _req(port, "PUT", "/__rv__/upload?name=fig.png", body=_PNG,
                        token=sess.token)
    assert status == 200
    assert json.loads(data)["path"] == "Media/Images/fig.png"
    assert (pdir / "Media" / "Images" / "fig.png").is_file()
    # threaded dedupe: every upload gets a distinct name (O_EXCL)
    results = []

    def up(i):
        results.append(json.loads(_req(
            port, "PUT", "/__rv__/upload?name=same.png", body=_PNG,
            token=sess.token)[1])["path"])

    threads = [threading.Thread(target=up, args=(i,)) for i in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(set(results)) == 8


def test_history_and_export_html(server):
    port, sess, pdir = server
    status, data = _req(port, "POST", "/__rv__/history/commit",
                        body=json.dumps({"message": "m"}).encode(),
                        token=sess.token)
    assert status == 200
    status, data = _req(port, "GET", "/__rv__/history?token=" + sess.token)
    assert status == 200 and isinstance(json.loads(data)["entries"], list)

    status, data = _req(port, "POST", "/__rv__/export?kind=html", token=sess.token)
    assert status == 200
    assert (pdir / "srv.html").is_file()


def test_concurrency_hammer(server):
    port, sess, pdir = server
    outcomes = []

    def edit(i):
        body = json.dumps({"sha256": _sha(pdir), "edits": [
            {"op": "set_col_size", "line": 5, "new": "{0}/12".format(1 + i % 11)}]})
        outcomes.append(_req(port, "POST", "/__rv__/edit", body=body.encode(),
                             token=sess.token)[0])

    def snap(i):
        outcomes.append(_req(port, "POST", "/__rv__/history/commit",
                             body=b'{"message":"s"}', token=sess.token)[0])

    def up(i):
        outcomes.append(_req(port, "PUT", "/__rv__/upload?name=h{0}.png".format(i),
                             body=_PNG, token=sess.token)[0])

    threads = [threading.Thread(target=f, args=(i,))
               for i in range(6) for f in (edit, snap, up)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    # server alive, no 5xx, file still parseable (every edit either applied or 409'd)
    assert all(s in (200, 409) for s in outcomes), outcomes
    text = (pdir / "srv.pres").read_text()
    assert text.count("> col ") == 1 and text.count("> end: row") == 1
    assert _req(port, "GET", "/")[0] == 200


def test_schema_endpoint(server):
    port, sess, pdir = server
    assert _req(port, "GET", "/__rv__/schema")[0] == 403
    status, data = _req(port, "GET", "/__rv__/schema?token=" + sess.token)
    assert status == 200
    sch = json.loads(data)
    assert "constructs" in sch and "classMap" in sch
    assert sch["constructs"]["pin"]["movable"] is True


def test_export_job_cancel(server):
    port, sess, pdir = server
    # Start an async PDF job with a stubbed slow renderer, then cancel it.
    import time

    from revealer import pdf as pdf_mod
    started = threading.Event()
    released = threading.Event()

    def fake_export(html, log=None, progress=None, should_cancel=None, **kw):
        started.set()
        # spin until cancelled (the endpoint sets the flag) or a timeout
        for _ in range(200):
            if should_cancel and should_cancel():
                raise pdf_mod.ExportCancelled("cancelled")
            released.wait(0.02)
        raise AssertionError("should have been cancelled")

    orig = pdf_mod.export_pdf
    pdf_mod.export_pdf = fake_export
    try:
        status, data = _req(port, "POST", "/__rv__/export?kind=pdf&job=1",
                            token=sess.token)
        assert status == 200
        assert json.loads(data)["job"]
        assert started.wait(2)
        # second job refused while one runs
        assert _req(port, "POST", "/__rv__/export?kind=pdf&job=1",
                    token=sess.token)[0] == 409
        # cancel it
        status, data = _req(port, "POST", "/__rv__/export/cancel",
                            token=sess.token)
        assert status == 200
        # the job slot frees up
        for _ in range(100):
            if sess.export_job is None:
                break
            time.sleep(0.02)
        assert sess.export_job is None
    finally:
        released.set()
        pdf_mod.export_pdf = orig
