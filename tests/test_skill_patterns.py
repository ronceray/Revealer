"""Every ```pres snippet in the skill's patterns.md builds warning-free.

The fence language IS the contract: ```pres blocks are extracted verbatim,
each built as a standalone deck against the stub assets below, and must
produce zero `Warning:` lines. Illustrative-only examples (build hooks,
includes, PDF figures) use ```text fences and are not built.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from helpers import build_deck

REPO = Path(__file__).resolve().parents[1]
PATTERNS = REPO / ".claude" / "skills" / "revealer-slides" / "references" / "patterns.md"

_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63f8ffff3f0300050001a5f645400000000049454e44ae426082"
)
_SVG = (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
        b'<rect id="box" width="10" height="10" fill="#cccccc"/>'
        b'<circle id="dot" cx="5" cy="5" r="2"/>'
        b'<path id="arrow" d="M0 5h10" stroke="#000"/></svg>')
_BIB = (b"@article{smith2026,\n"
        b"  author  = {Smith, Ada},\n"
        b"  title   = {A key result},\n"
        b"  journal = {Nature},\n"
        b"  year    = {2026},\n"
        b"}\n")

# The asset contract stated at the top of patterns.md — keep the two in sync.
MEDIA = {
    "Media/figure.png": _PNG,
    "Media/photo.jpg": _PNG,
    "Media/logo.png": _PNG,
    "Media/base.png": _PNG,
    "Media/overlay.png": _PNG,
    "Media/movie.mp4": b"\x00fakemp4",
    "Media/diagram.svg": _SVG,
    "refs.bib": _BIB,
}


def _snippets() -> list[str]:
    assert PATTERNS.is_file(), "patterns.md missing"
    return re.findall(r"```pres\n(.*?)```", PATTERNS.read_text(encoding="utf-8"),
                      re.DOTALL)


def _warnings(capsys):
    return [l for l in capsys.readouterr().out.splitlines()
            if l.startswith("Warning:")]


def test_patterns_has_a_real_library():
    assert len(_snippets()) >= 10


@pytest.mark.parametrize("idx", range(40))
def test_pattern_snippet_builds_warning_free(deck, capsys, idx):
    snippets = _snippets()
    if idx >= len(snippets):
        pytest.skip("no snippet #{0}".format(idx))
    html = build_deck(deck(snippets[idx], media=MEDIA))
    assert _warnings(capsys) == [], "snippet #{0} warned".format(idx)
    assert "<section" in html
