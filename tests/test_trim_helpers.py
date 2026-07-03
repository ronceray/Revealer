"""Fuzz the lockstep trim helpers against the string ops they replicate."""

from __future__ import annotations

import random

from revealer.build import _trim_empty_edges, _trim_ws_edges

_PIECES = ["", " ", "  ", "\t", "a", " a", "a ", " a ", "* x", "> col 2/5",
           "text  here", "\t \t", "  nested", "end"]


def _random_lines(rng, n):
    return [rng.choice(_PIECES) for _ in range(n)]


def test_trim_empty_edges_matches_strip_newlines():
    rng = random.Random(1234)
    for _ in range(2000):
        lines = _random_lines(rng, rng.randint(0, 8))
        src = list(range(1, len(lines) + 1))
        out, out_src = _trim_empty_edges(lines, src)
        assert "\n".join(out) == "\n".join(lines).strip("\n")
        assert len(out) == len(out_src)
        # surviving entries keep their original mapping
        for line, ln in zip(out, out_src):
            assert lines[ln - 1] == line


def test_trim_ws_edges_matches_strip():
    rng = random.Random(5678)
    for _ in range(2000):
        lines = _random_lines(rng, rng.randint(0, 8))
        src = list(range(1, len(lines) + 1))
        out, out_src = _trim_ws_edges(lines, src)
        joined = "\n".join(lines).strip()
        assert "\n".join(out) == ("" if joined == "" else joined)
        assert len(out) == len(out_src)
        # interior entries keep their original mapping; edges may be
        # lstripped/rstripped but map to the same source line
        for i, (line, ln) in enumerate(zip(out, out_src)):
            if ln is None:
                assert joined == ""
                continue
            orig = lines[ln - 1]
            if 0 < i < len(out) - 1:
                assert orig == line
            else:
                assert orig.strip() == line.strip()
