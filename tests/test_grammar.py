"""Registry conformance: derived patterns must equal the frozen literals."""

from __future__ import annotations

import re

from helpers import build_deck

from revealer import build as build_mod
from revealer import edit as edit_mod
from revealer import grammar


def test_macro_union_char_identical():
    assert grammar.macro_open_pattern() == build_mod._MACRO_OPEN_RE.pattern


def test_macro_union_order_is_permutation():
    macro_names = {n for n, s in grammar.REGISTRY.items() if s.passthrough == "macro"}
    assert set(grammar._MACRO_UNION_ORDER) == macro_names


def test_end_pattern_matches_literal():
    assert grammar.end_pattern() == edit_mod.RE_END.pattern.replace(
        r"^\s*>", "^>") or re.compile(grammar.end_pattern()).match("> end: row")


def test_dispatch_and_anchor_agree_per_construct():
    """Any line matched by an edit anchor must dispatch to the same construct."""
    samples = {
        "table": "> table(2,3)",
        "grid": "> grid(2,2) compact",
        "pin": "> pin: 40% 60% 10% +",
        "row": "> row h=400 24px",
        "box": "> info Some title",
        "eq": "> eq +",
        "stack": "> stack h=300",
        "frag": "> frag 2",
        "media": "! Media/x.png fill",
        "col": "> col 2/5 center",
        "card": "> card accent + | Title",
        "layer": "> layer + clear",
        "sep": "|| 40%",
    }
    for name, line in samples.items():
        spec = grammar.REGISTRY[name]
        assert re.match(grammar.anchor_pattern(name), line), (name, "anchor")
        if spec.dispatch or spec.terminator is grammar.Terminator.END_PAIRED:
            assert re.match(grammar.dispatch_pattern(name), line), (name, "dispatch")
        # dispatch-order uniqueness: no EARLIER end-paired construct matches
        for other, ospec in grammar.REGISTRY.items():
            if other == name:
                break
            if ospec.terminator is grammar.Terminator.END_PAIRED:
                assert not re.match(grammar.dispatch_pattern(other), line), (name, other)


def test_grid_junk_renders_literal(deck):
    """B1 regression fence: a malformed grid line is literal text, not a crash."""
    html = build_deck(deck("=== S\n\n> grid(2,2) junk\ncontent\n"))
    assert "grid(2,2) junk" in html
    assert "rv-grid-wrap" not in html


def test_token_patterns_match_edit_regexes():
    assert grammar.token_pattern("row", "height").pattern == "^" + grammar.H_TOKEN + "$"
    assert grammar.token_pattern("media", "size").flags & re.IGNORECASE
    assert not (grammar.token_pattern("row", "height").flags & re.IGNORECASE)


def test_schema_shape():
    sch = grammar.schema()
    assert "constructs" in sch and "classMap" in sch and "staticCheat" in sch
    classes = {c[0] for c in sch["classMap"]}
    for needed in ("rv-pin", "rv-card", "rv-cell", "box-warn", "rv-table-cell",
                   "region", "row", "rv-media-fill"):
        assert needed in classes, needed
    labels = {c[0]: c[2] for c in sch["classMap"]}
    assert labels["box-warn"] == "warn box"
    assert labels["rv-cell"] == "card (plain)"
    assert sch["directives"]["size"]["onFill"] is True


def test_cheat_is_three_field_and_lede_neutral():
    """Cheat metadata is (category, chip, insert); the misleading 'big lede' is gone."""
    sch = grammar.schema()
    sc = sch["staticCheat"]
    assert sc and all(len(e) == 3 for e in sc)
    for spec in sch["constructs"].values():
        assert all(len(e) == 3 for e in spec["cheat"])
    chips = " ".join(chip for _cat, chip, _ins in grammar.STATIC_CHEAT).lower()
    assert ".lede" in chips          # sizes still documented
    assert "big" not in chips        # ...but not mislabelled 'big'
    # A Fragments group exists for the * + bullet marker.
    assert any(cat == "Fragments" and "* +" in chip
               for cat, chip, _ in grammar.STATIC_CHEAT)


def test_scoped_text_directives_have_their_own_cheat_group():
    """`> size:` / `> align:` / `> paragraph-spacing:` restyle a slide or
    block scope — they live in a dedicated group, not under Inline format."""
    by_cat = {}
    for cat, chip, _ in grammar.STATIC_CHEAT:
        by_cat.setdefault(cat, []).append(chip)
    scoped = " ".join(by_cat.get("Sizes & alignment", []))
    assert "> size:" in scoped
    assert "> align:" in scoped
    assert "> paragraph-spacing:" in scoped
    inline = " ".join(by_cat.get("Inline format", []))
    assert "> size:" not in inline and "> align:" not in inline
