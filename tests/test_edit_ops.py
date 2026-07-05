"""Round-trip tests for the semantic edit engine (edit.py)."""

from __future__ import annotations

import hashlib

import pytest

from revealer.edit import EditError, apply_edits

PRES = """> title: Edit test

=== Layout
> fill
> row h=400 24px
> col 2/5 center
! Media/img.png fill h=120px | A caption
> col 3/5 +2
!! Media/mov.mp4 loop
> end: row
> stack h=300
> layer
! Media/img.png fill
> layer +
! Media/img.png fill
> end: stack
> pin: 70% 20% 10% +
Pinned
> end: pin

=== Grid
> grid(2,2) compact
> card +1
Card one
> card
Card two
> end: grid

=== Boxes
> info + Title
Body text
> end: info
> eq
E = mc^2
> end: eq
> frag 2
Wrapped
> end: frag

=== Columns

|| 40%
Left text
| 55%
Right text
||
"""


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


@pytest.fixture()
def pres(tmp_path):
    p = tmp_path / "deck.pres"
    p.write_text(PRES)
    return p


def _apply(p, ops):
    return apply_edits(p, _sha(p.read_text()), ops)


def _diff_lines(before: str, after: str):
    b, a = before.split("\n"), after.split("\n")
    return [(i + 1, x, y) for i, (x, y) in enumerate(zip(b, a)) if x != y], len(a) - len(b)


# --- parametric ops -----------------------------------------------------------

@pytest.mark.parametrize("op,line,expect", [
    ({"op": "set_col_size", "line": 6, "new": "1/2"}, 6, "> col 1/2 center"),
    ({"op": "set_col_size", "line": 8, "new": "45"}, 8, "> col 45 +2"),
    ({"op": "set_row_height", "line": 5, "value": 520}, 5, "> row h=520 24px"),
    ({"op": "set_row_height", "line": 5, "value": None}, 5, "> row 24px"),
    ({"op": "set_stack_height", "line": 11, "value": 260}, 11, "> stack h=260"),
    ({"op": "set_pin", "line": 17, "x": "62%", "y": "31.5%", "w": "24%"}, 17,
     "> pin: 62% 31.5% 24% +"),
    ({"op": "set_media_size", "line": 7, "dim": "h", "value": "200px"}, 7,
     "! Media/img.png fill h=200px | A caption"),
    ({"op": "set_media_size", "line": 9, "dim": "w", "value": "50%"}, 9,
     "!! Media/mov.mp4 loop w=50%"),
    ({"op": "set_row_gap", "line": 5, "value": "32px"}, 5, "> row h=400 32px"),
    ({"op": "set_block_width", "line": 42, "new": "30%"}, 42, "|| 30%"),
    ({"op": "set_fragment_index", "line": 23, "construct": "card", "index": 3}, 23,
     "> card +3"),
    ({"op": "set_fragment_index", "line": 36, "construct": "frag", "index": 5}, 36,
     "> frag 5"),
])
def test_parametric_single_line(pres, op, line, expect):
    before = pres.read_text()
    _apply(pres, [op])
    after = pres.read_text()
    changed, delta = _diff_lines(before, after)
    assert delta == 0
    assert len(changed) == 1 and changed[0][0] == line
    assert changed[0][2] == expect


def test_pin_line_number_matches_fixture(pres):
    assert PRES.split("\n")[16].startswith("> pin:")
    assert PRES.split("\n")[41].startswith("|| 40%")
    assert PRES.split("\n")[22].startswith("> card +1")
    assert PRES.split("\n")[35].startswith("> frag 2")


def test_revert_idempotence(pres):
    original = pres.read_text()
    _apply(pres, [{"op": "set_col_size", "line": 6, "new": "1/2"}])
    _apply(pres, [{"op": "set_col_size", "line": 6, "new": "2/5"}])
    assert pres.read_text() == original


def test_grid_gap_insert_and_replace(pres):
    _apply(pres, [{"op": "set_grid_gap", "line": 22, "end": 27, "value": "24px"}])
    lines = pres.read_text().split("\n")
    assert lines[22] == "> gap: 24px"          # inserted right after the opener
    _apply(pres, [{"op": "set_grid_gap", "line": 22, "end": 28, "value": "12px"}])
    lines = pres.read_text().split("\n")
    assert lines[22] == "> gap: 12px"          # replaced in place
    assert lines.count("> gap: 12px") == 1


def test_multi_edit_batch(pres):
    before = pres.read_text()
    _apply(pres, [
        {"op": "set_col_size", "line": 6, "new": "1/2"},
        {"op": "set_col_size", "line": 8, "new": "1/2"},
    ])
    changed, delta = _diff_lines(before, pres.read_text())
    assert delta == 0 and [c[0] for c in changed] == [6, 8]


# --- structural ops -----------------------------------------------------------

def test_move_block_between_cells(pres):
    # Move the stack (lines 11-16) inside the first column (before line 8's `> col`).
    _apply(pres, [{
        "op": "move_block", "src": [11, 16], "construct": "stack",
        "dest": {"insert_before": 8, "container": [6, 7], "container_kind": "col"},
    }])
    lines = pres.read_text().split("\n")
    i = lines.index("> stack h=300")
    assert lines[i - 1].startswith("! Media/img.png fill h=120px")
    assert lines[i + 5] == "> end: stack"
    assert lines[i + 6] == "> col 3/5 +2"
    # the old location no longer has the stack
    assert lines.count("> stack h=300") == 1


def test_move_then_move_back_is_identity(pres):
    original = pres.read_text()
    _apply(pres, [{
        "op": "move_block", "src": [11, 16], "construct": "stack",
        "dest": {"insert_before": 8, "container": [6, 7], "container_kind": "col"},
    }])
    lines = pres.read_text().split("\n")
    s = lines.index("> stack h=300") + 1
    _apply(pres, [{
        "op": "move_block", "src": [s, s + 5], "construct": "stack",
        "dest": {"insert_before": lines.index("> pin: 70% 20% 10% +") + 1,
                 "container": [4, 20], "container_kind": "slide-ish-col",
                 },
    }])
    assert pres.read_text() == original


def test_delete_block_collapses_seam(pres):
    _apply(pres, [{"op": "delete_block", "src": [22, 27], "construct": "grid"}])
    text = pres.read_text()
    assert "> grid(2,2)" not in text
    assert "\n\n\n" not in text  # no double blank left behind


def test_insert_media_paragraph_padding(pres):
    # Insert into the legacy left column (paragraph container → blank padding).
    _apply(pres, [{
        "op": "insert_media",
        "at": {"insert_before": 44, "container": [42, 43], "container_kind": "column"},
        "kind": "img", "path": "Media/new.png", "flags": [], "caption": "New",
    }])
    lines = pres.read_text().split("\n")
    i = lines.index("! Media/new.png | New")
    assert lines[i - 1].strip() == "" or lines[i - 1].startswith("||")
    assert lines[i + 1].strip() == ""


def test_reorder_fragments_normalizes(pres):
    _apply(pres, [{
        "op": "reorder_fragments",
        "order": [
            {"line": 9, "construct": "media"},
            {"line": 8, "construct": "col"},
        ],
    }])
    lines = pres.read_text().split("\n")
    assert lines[8] == "!! Media/mov.mp4 loop +1"
    assert lines[7] == "> col 3/5 +2"


# --- failure paths --------------------------------------------------------------

def test_sha_mismatch_is_409(pres):
    with pytest.raises(EditError) as e:
        apply_edits(pres, "0" * 64, [{"op": "set_col_size", "line": 6, "new": "1/2"}])
    assert e.value.status == 409
    assert e.value.payload["error"] == "sha_mismatch"


def test_anchor_mismatch_is_422_and_atomic(pres):
    before = pres.read_text()
    with pytest.raises(EditError) as e:
        _apply(pres, [
            {"op": "set_col_size", "line": 6, "new": "1/2"},   # valid
            {"op": "set_pin", "line": 6, "x": "1%", "y": "2%"},  # wrong line
        ])
    assert e.value.status == 422
    assert e.value.payload["error"] == "anchor_mismatch"
    assert pres.read_text() == before  # nothing applied


def test_overlap_rejected(pres):
    with pytest.raises(EditError) as e:
        _apply(pres, [
            {"op": "delete_block", "src": [11, 16], "construct": "stack"},
            {"op": "set_stack_height", "line": 11, "value": 100},
        ])
    assert e.value.payload["error"] == "overlap"


def test_move_onto_itself_rejected(pres):
    with pytest.raises(EditError):
        _apply(pres, [{
            "op": "move_block", "src": [11, 16], "construct": "stack",
            "dest": {"insert_before": 12, "container": [11, 16], "container_kind": "col"},
        }])


def test_crlf_and_no_trailing_newline_preserved(tmp_path):
    p = tmp_path / "crlf.pres"
    p.write_bytes(b"> title: X\r\n\r\n=== S\r\n> row\r\n> col 2/5\r\nhi\r\n> end: row")
    sha = hashlib.sha256(p.read_bytes()).hexdigest()
    apply_edits(p, sha, [{"op": "set_col_size", "line": 5, "new": "1/2"}])
    data = p.read_bytes()
    assert b"> col 1/2\r\n" in data
    assert not data.endswith(b"\n")
    assert b"\n" not in data.replace(b"\r\n", b"")
