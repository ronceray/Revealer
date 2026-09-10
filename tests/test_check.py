"""`revealer check`: the layout-time diagnostics (#6).

The unit tests cover the plumbing (variant injection, source-line resolution,
report formatting) and run everywhere. The end-to-end test renders a deliberately
broken deck in headless Chrome and asserts each fault is found — and, just as
importantly, that a sound deck reports nothing. It skips without Chrome or a
reveal.js checkout, like the browser-suite bridge.
"""

from __future__ import annotations

import shutil
import struct
import zlib
from pathlib import Path

import pytest

from revealer import check as C
from revealer.build import build
from revealer.pdf import _find_chrome

REPO = Path(__file__).resolve().parents[1]
REVEAL = REPO / "Demo" / "reveal.js"


def _png(w: int, h: int, rgb: tuple[int, int, int]) -> bytes:
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))


# Every fault the issue reported that a build cannot see, one per slide, plus
# a sound slide that must stay silent.
BROKEN = """> title: Broken
> theme: revealer

=== Callout past its pinned row
> fill
> row h=200
> col
> info A callout with far more text than the row can hold
This callout is pinned into a 200px row but carries several long sentences of
body text, so it runs past the bottom of its box and lands on top of whatever
the next row draws. More text to be sure it does not fit. And more again,
well past the box, so the overflow is unambiguous.
> end: info
> end: row
> row
> col
! Media/fig.png fill contain
> end: row

=== Cover crops the figure
> fill
> row
> col
! Media/wide.png fill cover
> end: row

=== An empty column
> fill
> row
> col 1/3
> col 2/3
Only the right column has content.
> end: row

=== A sound slide
> fill
> row
> col
Just a line of text.
> end: row
"""

MEDIA = {"Media/wide.png": _png(1600, 200, (60, 110, 200)),
         "Media/fig.png": _png(800, 600, (200, 90, 60))}


@pytest.fixture()
def rendered_deck(deck):
    """A deck with a real reveal.js, so headless Chrome can lay it out."""
    if _find_chrome() is None:
        pytest.skip("needs a Chrome/Chromium binary")
    if not (REVEAL / "dist" / "reveal.js").is_file():
        pytest.skip("needs a reveal.js checkout at Demo/reveal.js")

    def make(text: str, name: str = "t", media: dict | None = None) -> Path:
        pdir = deck(text, name=name, media=media or MEDIA)
        shutil.rmtree(pdir / "reveal.js")
        shutil.copytree(REVEAL, pdir / "reveal.js",
                        ignore=shutil.ignore_patterns(
                            "examples", "test", "node_modules", ".git"))
        return pdir / (name + ".pres")

    return make


# --- plumbing ----------------------------------------------------------------

def test_variant_shows_fragments_and_injects_the_probe(deck):
    pdir = deck("=== T\n\n* + one\n* + two\n")
    dev = Path(build(str(pdir / "test.pres"), dev=True))
    variant = C._make_variant(dev, {"deadSpace": True})
    try:
        text = variant.read_text(encoding="utf-8")
        assert "Reveal.initialize({ fragments: false," in text
        assert "opacity:1!important" in text          # fragments forced visible
        assert "transition:none !important" in text   # nothing measured mid-fade
        assert '"deadSpace": true' in text
        assert "__RV_CHECK__" in text                 # the probe itself
    finally:
        variant.unlink()


def test_variant_refuses_html_without_the_anchor(tmp_path):
    stub = tmp_path / "x.dev.html"
    stub.write_text("<html><head></head><body></body></html>")
    with pytest.raises(C.CheckError, match="injection anchor"):
        C._make_variant(stub, {})


def test_at_resolves_included_files():
    files = ["", "part.pres"]
    assert C._at(12, "", files) == "line 12"
    assert C._at(12, "1", files) == "part.pres:12"
    assert C._at(None, "", files) == ""
    assert C._at(5, "9", files) == "line 5"      # index out of range: still useful


def test_format_findings_reads_like_a_build_warning():
    payload = {"findings": [
        {"where": "slide 8/1", "title": "Results", "at": "line 214",
         "message": "column overflows its box by 38px", "kind": "overflow"},
        {"where": "deck", "title": "", "at": "",
         "message": "logo strip is cut off by the window edge (20px outside)",
         "kind": "offslide"},
    ]}
    lines = C.format_findings(payload)
    assert lines[0] == ("Warning: slide 8/1 (Results) line 214: "
                        "column overflows its box by 38px")
    assert lines[1].startswith("Warning: deck: logo strip is cut off")


# --- end to end ---------------------------------------------------------------

def test_broken_deck_reports_every_fault(rendered_deck, capsys):
    pres = rendered_deck(BROKEN)
    # The parser sees nothing wrong with this deck: that is the whole problem.
    build(str(pres))
    assert [ln for ln in capsys.readouterr().out.splitlines()
            if ln.startswith("Warning:")] == []

    payload = C.check(str(pres))
    kinds = {}
    for f in payload["findings"]:
        kinds.setdefault(f["kind"], []).append(f)
    assert set(kinds) == {"overflow", "crop", "empty"}, payload["findings"]

    over = kinds["overflow"][0]
    assert over["where"] == "slide 0"
    assert over["px"] > 50 and "overflows its box" in over["message"]
    assert over["at"].startswith("line ")

    assert kinds["crop"][0]["where"] == "slide 1"
    assert "cover crops" in kinds["crop"][0]["message"]
    assert kinds["empty"][0]["where"] == "slide 2"

    # The sound slide stays silent, and the dev build is cleaned up again.
    assert all(f["where"] != "slide 3" for f in payload["findings"])
    assert not pres.with_name(pres.stem + ".dev.html").exists()
    assert not list(pres.parent.glob("._check-*.html"))


def test_a_sound_deck_reports_nothing(rendered_deck):
    pres = rendered_deck(
        "> title: Fine\n\n=== One\n\nA short line.\n\n"
        "=== Two\n> fill\n> row\n> col\n! Media/fig.png fill contain\n> end: row\n",
        name="fine")
    payload = C.check(str(pres))
    assert payload["findings"] == []
    assert len(payload["slides"]) == 2


def test_run_check_counts_and_prints(rendered_deck, capsys):
    pres = rendered_deck(BROKEN, name="counted")
    n = C.run_check(str(pres))
    out = capsys.readouterr().out
    assert n == len([ln for ln in out.splitlines() if ln.startswith("Warning:")])
    assert "finding(s) over 4 slides" in out


def test_skip_silences_a_kind(rendered_deck):
    pres = rendered_deck(BROKEN, name="skipped")
    payload = C.check(str(pres), skip=("crop", "empty"))
    assert {f["kind"] for f in payload["findings"]} == {"overflow"}


def test_check_keeps_an_existing_dev_build(rendered_deck):
    """A running `revealer serve` owns <stem>.dev.html — the check must not
    delete it out from under the server."""
    pres = rendered_deck(BROKEN, name="served")
    dev = Path(build(str(pres), dev=True))
    C.check(str(pres))
    assert dev.exists()
