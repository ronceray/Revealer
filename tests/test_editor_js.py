"""Bridge to the in-browser JS suites: headless Chrome drives /__rv__/test.

Needs a Chrome binary and a real reveal.js checkout (Demo/reveal.js —
`revealer update Demo` provides it; CI's browser job caches one). Skips
cleanly when either is missing so the unit job stays offline.
"""

from __future__ import annotations

import http.client
import json
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from revealer import serve as serve_mod
from revealer.pdf import _find_chrome

REPO = Path(__file__).resolve().parents[1]
REVEAL = REPO / "Demo" / "reveal.js"

PRES = """> title: JS harness

=== One
> pin: 40% 40% 20%
pinned text
> end: pin

Some text below the pin.

=== Two

Second slide.

=== Three
Style **bold** middle plain tail.

Editable target line here.

Math check $x^2$ trails words.

> include: inc.pres
"""

# A second source file, pulled in via `> include:`. Its pin (line 2) and
# plain paragraph (line 6) let suite-multifile.js exercise per-file editing.
INC = b"""=== Included
> pin: 30% 30% 10%
inc text
> end: pin

plain included paragraph
"""


@pytest.fixture(scope="session")
def chrome():
    path = _find_chrome()
    if path is None:
        pytest.skip("needs a Chrome/Chromium binary")
    return path


@pytest.fixture()
def js_deck(deck):
    if not (REVEAL / "dist" / "reveal.js").is_file():
        pytest.skip("needs a reveal.js checkout at Demo/reveal.js")
    pdir = deck(PRES, name="js", media={"inc.pres": INC})
    shutil.rmtree(pdir / "reveal.js")
    shutil.copytree(REVEAL, pdir / "reveal.js",
                    ignore=shutil.ignore_patterns(
                        "examples", "test", "node_modules", ".git"))
    return pdir


def _get_json(port, path):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request("GET", path)
    r = conn.getresponse()
    data = r.read()
    conn.close()
    return r.status, json.loads(data)


def test_js_suites(js_deck, chrome, tmp_path):
    port, sess, shutdown = serve_mod.start_for_tests(js_deck / "js.pres",
                                                     test_mode=True)
    proc = None
    try:
        proc = subprocess.Popen(
            [chrome, "--headless=new", "--disable-gpu", "--no-first-run",
             "--no-default-browser-check", "--window-size=1400,900",
             "--user-data-dir=" + str(tmp_path / "chrome-profile"),
             "http://127.0.0.1:{0}/__rv__/test".format(port)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 90
        results = None
        while time.monotonic() < deadline:
            status, j = _get_json(
                port, "/__rv__/test-results?token=" + sess.token)
            assert status == 200
            if j["results"] is not None:
                results = j["results"]
                break
            if proc.poll() is not None:
                pytest.fail("chrome exited before posting results")
            time.sleep(0.5)
        assert results is not None, "JS runner never posted results"
        assert results.get("done") is True
        suite = results["results"]
        assert len(suite) >= 2
        failed = [r for r in suite if not r["ok"]]
        assert not failed, "\n".join(
            "{0}: {1}".format(r["name"], r.get("error")) for r in failed)
    finally:
        if proc is not None:
            proc.kill()
            proc.wait(timeout=10)
        shutdown()
