"""P7 foundation: inline source map, wrap_span, /__rv__/inspect."""

from __future__ import annotations

import hashlib
import http.client
import json

import pytest

from revealer import build as build_mod
from revealer import edit as edit_mod
from revealer import serve as serve_mod
from revealer.build import _inline_md, inline_segments

CASES = [
    "plain text",
    "some **bold** and *ital* text",
    "a `code` span",
    "x [label](http://e.x/p) y",
    "[big]{.lede} start",
    "[c]{color=#ff0000} tinted",
    "esc \\*not bold\\* here",
    "math $x^2 + y$ stays and $$E=mc^2$$ too",
    'tag <span class="q">inside</span> here',
    "**a *b* c**",
    "mix `in **code**` out",
    "[t]{junk} literal fallthrough",
    "**bold with `code` inside**",
    "trailing *",
    "$a$ then **b** then <i>c</i>",
]


@pytest.mark.parametrize("text", CASES)
def test_map_is_exact_or_refused(text):
    segs = inline_segments(text)
    if segs is None:
        return  # refusal is always legal — never a wrong map
    assert "".join(s[2] for s in segs) == _inline_md(text)
    assert segs[0][0] == 0 and segs[-1][1] == len(text)
    for a, b in zip(segs, segs[1:]):
        assert a[1] == b[0]  # gap-free coverage
    for s, e, _r, kind in segs:
        assert s < e
        assert kind in ("text", "markup", "math-opaque", "tag-opaque")


def test_map_over_demo_corpus():
    """Every content line of the real demo decks maps exactly or refuses."""
    from pathlib import Path
    repo = Path(__file__).resolve().parents[1]
    refused = total = 0
    for name in ("Demo.pres", "Simple.pres"):
        for line in (repo / "Demo" / name).read_text(encoding="utf-8").split("\n"):
            total += 1
            segs = inline_segments(line)
            if segs is None:
                refused += 1
                continue
            assert "".join(s[2] for s in segs) == _inline_md(line), line
    assert total > 100
    assert refused / total < 0.05, "map refuses too much real content"


def test_wrap_span_op(tmp_path):
    p = tmp_path / "w.pres"
    p.write_text("=== S\n\nmake this word bold\n", encoding="utf-8")
    sha = hashlib.sha256(p.read_bytes()).hexdigest()
    edit_mod.apply_edits(p, sha, [{
        "op": "wrap_span", "line": 3, "start_col": 10, "end_col": 14,
        "before": "**", "after": "**"}])
    assert "make this **word** bold" in p.read_text()

    sha = hashlib.sha256(p.read_bytes()).hexdigest()
    for bad in (
        {"op": "wrap_span", "line": 3, "start_col": 5, "end_col": 5,
         "before": "*", "after": "*"},
        {"op": "wrap_span", "line": 3, "start_col": 0, "end_col": 999,
         "before": "*", "after": "*"},
        {"op": "wrap_span", "line": 3, "start_col": 0, "end_col": 4,
         "before": "a\nb", "after": ""},
        {"op": "wrap_span", "line": 3, "start_col": 0, "end_col": 4,
         "before": "", "after": ""},
    ):
        with pytest.raises(edit_mod.EditError) as ei:
            edit_mod.apply_edits(p, sha, [bad])
        assert ei.value.status == 422


def test_inspect_endpoint(deck):
    pdir = deck("> title: T\n\n=== One\n\nsome **bold** here\n", name="ins")
    port, sess, shutdown = serve_mod.start_for_tests(pdir / "ins.pres")
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        conn.request("GET", "/__rv__/inspect?start=5&end=5&token=" + sess.token)
        r = conn.getresponse()
        j = json.loads(r.read())
        conn.close()
        assert r.status == 200
        (ln,) = j["lines"]
        assert ln["text"] == "some **bold** here"
        kinds = [s[3] for s in ln["segments"]]
        assert kinds == ["text", "markup", "text", "markup", "text"]
        rendered = "".join(s[2] for s in ln["segments"])
        assert rendered == "some <b>bold</b> here"
        # unauthenticated access refused
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        conn.request("GET", "/__rv__/inspect?start=5&end=5")
        assert conn.getresponse().status == 403
        conn.close()
    finally:
        shutdown()


def test_markdown_disabled_maps_identity(deck, monkeypatch):
    monkeypatch.setattr(build_mod, "_MARKDOWN", False)
    segs = inline_segments("some **bold** here")
    assert segs == [[0, 18, "some **bold** here", "text"]]
