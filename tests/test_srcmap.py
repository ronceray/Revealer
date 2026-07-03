"""Source-provenance invariants.

1. Dev builds differ from prod builds ONLY by the documented dev additions
   (`strip_dev(dev) == prod`, byte-for-byte).
2. Every `data-rv-src` annotation points to the `.pres` line that actually
   opens the construct (checked against the construct's own syntax).
"""

from __future__ import annotations

import re

import pytest

from helpers import build_deck, strip_dev

# A deck exercising every annotated construct. Line numbers are asserted
# against the *content* of the referenced line, so this fixture can evolve
# freely.
FULL = """# comment line
> title: Srcmap test
> author: A. Author
> affiliation: Test Lab
> event: Testville, 2026
> width: 1920
> height: 1080

>>> first: Source map test
> subtitle: fixtures

=== Bullets, code, highlight

Some plain text.

* bullet one
  * nested bullet

@@ python
print("hi")
@@

[ highlighted line ]

=== Media and layout
> fill
> row h=400
> col 2/5 center
! Media/img.png fill | A caption
> col 3/5
!! Media/mov.mp4 loop
> end: row

=== Grid
> grid(2,2) compact
> gap: 18px
> card
Card one
> card plain +
Card two
> end: grid

=== Stack pin box eq frag
> row
> col
> stack h=300
> layer
! Media/img.png fill
> layer +
! Media/img.png fill
> end: stack
> col
> info Title here
Info body
> end: info
> warn
Warn body
> end: warn
> good
Good body
> end: good
> eq +
E = mc^2
> end: eq
> frag 2
Wrapped fragment
> end: frag
> end: row
> pin: 70% 20% 10% +
Pinned note
> end: pin

=== Table
> table(2,2)
> cell: #eee
T11
> cell
T12
> row
T21
> cell
T22
> end: table

=== Columns

|| 40%
Left column text
| 55%
Right column text
||

=== Sizes

> size: 0.8
A sized paragraph.

Another paragraph.
"""

# Tiny valid PNG + a fake mp4 (content is never decoded at build time).
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63f8ffff3f0300050001a5f645400000000049454e44ae426082"
)
MEDIA = {"Media/img.png": _PNG, "Media/mov.mp4": b"\x00fakemp4"}


@pytest.fixture()
def full_deck(deck):
    return deck(FULL, media=MEDIA)


def test_dev_prod_invariant(full_deck):
    prod = build_deck(full_deck)
    dev = build_deck(full_deck, dev=True)
    assert strip_dev(dev) == prod


def test_dev_build_has_meta(full_deck):
    dev = build_deck(full_deck, dev=True)
    assert '<meta name="rv-src-file" content="test.pres">' in dev
    assert re.search(r'<meta name="rv-src-sha" content="[0-9a-f]{64}">', dev)


# --- annotation validity ------------------------------------------------------

# element marker (as found in the HTML) -> regex its data-rv-src line must match
CONSTRUCT_LINE_RE = {
    "rv-fig": r"^\s*!{1,2} ",
    "rv-media": r"^\s*!{1,2} ",
    "rv-pin": r"^>\s*pin\s*:",
    "rv-stack": r"^>\s*stack\b",
    "rv-layer": r"^>\s*layer\b",
    "rv-grid-wrap": r"^>\s*grid\(",
    "rv-card": r"^>\s*card\b",
    "rv-cell": r"^>\s*card\b",
    "box-info": r"^>\s*info\b",
    "box-warn": r"^>\s*warn\b",
    "box-good": r"^>\s*good\b",
    "math-box": r"^>\s*eq\b",
    "rv-table-wrap": r"^>\s*table\(",
    "row": r"^>\s*row\b",
    "region": r"^>\s*col\b",
}


def _annotated_elements(html):
    """Yield (class_attr, src, src_end) for annotated elements."""
    for m in re.finditer(
        r'<\w+ class="([^"]*)"[^>]*? data-rv-src="(\d+)"(?: data-rv-src-end="(\d+)")?',
        html,
    ):
        yield m.group(1), int(m.group(2)), (int(m.group(3)) if m.group(3) else None)


def test_annotations_point_at_their_constructs(full_deck):
    dev = build_deck(full_deck, dev=True)
    pres_lines = FULL.split("\n")

    seen = set()
    count = 0
    for classes, src, src_end in _annotated_elements(dev):
        line = pres_lines[src - 1]
        for marker, pattern in CONSTRUCT_LINE_RE.items():
            if marker in classes.split() or marker in classes:
                assert re.match(pattern, line), (
                    "element {0!r}: data-rv-src={1} points at {2!r}, "
                    "expected match for {3!r}".format(classes, src, line, pattern)
                )
                seen.add(marker)
                count += 1
        if src_end is not None:
            assert src_end >= src
            end_line = pres_lines[src_end - 1]
            # span constructs end on their `> end:` (or `> col`-delimited) line
            assert end_line.strip() != ""

    # Every construct class in the map must actually occur in the fixture.
    missing = set(CONSTRUCT_LINE_RE) - seen
    assert not missing, "constructs never seen annotated: {0}".format(missing)
    assert count >= 20


def test_sections_carry_marker_lines(full_deck):
    dev = build_deck(full_deck, dev=True)
    pres_lines = FULL.split("\n")
    sections = re.findall(r'<section [^>]*data-rv-src="(\d+)"', dev)
    assert len(sections) >= 6
    for src in sections:
        line = pres_lines[int(src) - 1]
        assert re.match(r"^(>>> first:|===|---|%%%|>>> biblio)", line), line
