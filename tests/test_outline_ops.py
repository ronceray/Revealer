"""P5a engine: insert_lines + whole-slide move/delete spans."""

from __future__ import annotations

import hashlib

import pytest

from revealer import edit as edit_mod

PRES = """> title: Outline

=== Alpha

first slide body

=== Beta

second slide body

--- Beta child

stacked body

=== Gamma

third slide body
"""


@pytest.fixture()
def pres(tmp_path):
    p = tmp_path / "o.pres"
    p.write_text(PRES, encoding="utf-8")
    return p


def _sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _apply(p, edits):
    return edit_mod.apply_edits(p, _sha(p), edits)


def test_insert_lines_appends_a_slide(pres):
    total = len(pres.read_text().split("\n"))
    _apply(pres, [{"op": "insert_lines",
                   "at": {"insert_before": total, "container_kind": "deck"},
                   "text": ["", "=== New slide", "", "…"]}])
    text = pres.read_text()
    assert text.rstrip().endswith("…")
    assert "=== New slide" in text


def test_insert_lines_rejects_bad_text(pres):
    for bad in ([], ["a\nb"], "notalist", [42]):
        with pytest.raises(edit_mod.EditError) as ei:
            _apply(pres, [{"op": "insert_lines",
                           "at": {"insert_before": 1}, "text": bad}])
        assert ei.value.status == 422


def test_move_whole_slide_reorders(pres):
    # move Gamma (lines 15-17) before Alpha (line 3)
    _apply(pres, [{"op": "move_block", "construct": "slide",
                   "src": [15, 17],
                   "dest": {"insert_before": 3, "container_kind": "deck"}}])
    text = pres.read_text()
    assert text.index("=== Gamma") < text.index("=== Alpha") < text.index("=== Beta")
    # exactly one of each survives
    assert text.count("=== Gamma") == 1 and text.count("third slide body") == 1


def test_move_stack_as_parent_plus_children(pres):
    # Beta + its vertical child move as one span (lines 7-13)
    _apply(pres, [{"op": "move_block", "construct": "slide",
                   "src": [7, 13],
                   "dest": {"insert_before": 3, "container_kind": "deck"}}])
    text = pres.read_text()
    assert text.index("=== Beta") < text.index("=== Alpha")
    assert text.index("--- Beta child") < text.index("=== Alpha")
    beta = text.index("=== Beta")
    child = text.index("--- Beta child")
    assert beta < child  # stack order preserved


def test_slide_anchor_mismatch(pres):
    with pytest.raises(edit_mod.EditError) as ei:
        _apply(pres, [{"op": "move_block", "construct": "slide",
                       "src": [5, 5],
                       "dest": {"insert_before": 1}}])
    assert ei.value.status == 422
    assert ei.value.payload["error"] == "anchor_mismatch"


def test_delete_whole_slide(pres):
    _apply(pres, [{"op": "delete_block", "construct": "slide",
                   "src": [15, 17]}])
    text = pres.read_text()
    assert "=== Gamma" not in text and "third slide body" not in text
    assert "=== Beta" in text  # neighbours intact
