"""P3a seams: editor asset manifest, test-mode gate, start_for_tests."""

from __future__ import annotations

import http.client
from pathlib import Path

import pytest

from revealer import build as build_mod
from revealer import serve as serve_mod

PRES = """> title: Harness test

=== One

Some text.
"""

JS_DIR = Path(serve_mod.__file__).parent / "data" / "js"


def _get(port, path):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request("GET", path)
    r = conn.getresponse()
    data = r.read()
    conn.close()
    return r.status, data


@pytest.fixture()
def harness(deck):
    pdir = deck(PRES, name="hrn")
    port, sess, shutdown = serve_mod.start_for_tests(pdir / "hrn.pres",
                                                     test_mode=True)
    yield port, sess, pdir
    shutdown()


def test_manifest_files_exist():
    for name in serve_mod.EDITOR_JS:
        assert (JS_DIR / name).is_file(), name


def test_injected_page_loads_manifest_in_order(harness):
    port, sess, pdir = harness
    status, data = _get(port, "/")
    assert status == 200
    html = data.decode("utf-8")
    positions = [html.index('src="/__rv__/{0}"'.format(n))
                 for n in serve_mod.EDITOR_JS]
    assert positions == sorted(positions)
    assert html.index("window.__RV_DEV__") < positions[0]
    # every manifest entry is actually served
    for name in serve_mod.EDITOR_JS:
        assert _get(port, "/__rv__/" + name)[0] == 200


def test_asset_whitelist(harness):
    port, sess, pdir = harness
    assert _get(port, "/__rv__/editor.css")[0] == 200
    assert _get(port, "/__rv__/serve.py")[0] == 404
    assert _get(port, "/__rv__/../serve.py")[0] == 404


def test_test_runner_gated_by_test_mode(deck):
    pdir = deck(PRES, name="hrn")
    port, sess, shutdown = serve_mod.start_for_tests(pdir / "hrn.pres",
                                                     test_mode=False)
    try:
        assert sess.test_mode is False
        assert _get(port, "/__rv__/test")[0] == 404
    finally:
        shutdown()
    port2, sess2, shutdown2 = serve_mod.start_for_tests(pdir / "hrn.pres",
                                                        test_mode=True)
    try:
        assert _get(port2, "/__rv__/test")[0] == 200
    finally:
        shutdown2()


def test_prod_build_has_no_dev_hooks(deck):
    pdir = deck(PRES, name="hrn")
    out = build_mod.build(str(pdir / "hrn.pres"))
    html = Path(out).read_text(encoding="utf-8")
    assert "__rv__" not in html
    assert "__RV_DEV__" not in html
    assert "data-rv-src" not in html


def test_deck_reveal_js_ships_no_editor_assets(deck):
    """Editor modules (editor/*.js, editor.css) and the test harness (rvt*,
    suite-*) are dev-server-only: a built deck's reveal.js must have none."""
    pdir = deck(PRES, name="hrn")
    build_mod.build(str(pdir / "hrn.pres"))
    shipped = [p for p in (pdir / "reveal.js").rglob("*")
               if p.name.startswith(("editor", "rvt", "suite-"))]
    assert shipped == [], shipped
