"""Build diagnostics: anything the parser drops must say so — and sanctioned
styles must stay silent (a noisy channel is an ignored channel)."""

from __future__ import annotations

from helpers import build_deck

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63f8ffff3f0300050001a5f645400000000049454e44ae426082"
)


def _warnings(capsys):
    return [l for l in capsys.readouterr().out.splitlines()
            if l.startswith("Warning:")]


def test_malformed_opener_warns(deck, capsys):
    build_deck(deck("=== T\n\n> grid(a,b)\n\ntext\n"))
    w = _warnings(capsys)
    assert any("unrecognized directive dropped: > grid(a,b)" in l for l in w)


def test_orphan_card_warns_with_hint(deck, capsys):
    build_deck(deck("=== T\n\n> card | orphan\n\ntext\n"))
    w = _warnings(capsys)
    assert any("> card belongs inside a > grid" in l for l in w)


def test_stray_end_warns(deck, capsys):
    build_deck(deck("=== T\n\ntext\n\n> end: grid\n"))
    w = _warnings(capsys)
    assert any("stray '> end: grid'" in l for l in w)


def test_unclosed_callout_swallowing_construct_warns(deck, capsys):
    build_deck(deck("=== T\n\n> info Box\n\nbody\n\n> warn Second\n\nmore\n"))
    w = _warnings(capsys)
    assert any("'> info' is never closed and swallowed '> warn'" in l
               for l in w)


def test_callout_autoclosed_by_column_boundary_is_silent(deck, capsys):
    # The sanctioned style: a callout inside a column, closed by the next
    # `> col` / `> end: row` — used by real decks, must not warn.
    build_deck(deck(
        "=== T\n\n> row\n> col\n\n> info Left\n\nbody\n\n> col\n\n"
        "> warn Right\n\nbody\n\n> end: row\n"))
    assert _warnings(capsys) == []


def test_bare_space_outside_fill_warns(deck, capsys):
    build_deck(deck("=== T\n\nabove\n\n> space\n\nbelow\n"))
    w = _warnings(capsys)
    assert any("bare '> space' fills only inside a '> fill' slide" in l
               for l in w)


def test_bare_space_inside_fill_is_silent(deck, capsys):
    build_deck(deck("=== T\n> fill\n\nabove\n\n> space\n\nbelow\n"))
    assert _warnings(capsys) == []


def test_sized_space_never_warns(deck, capsys):
    build_deck(deck("=== T\n\nabove\n\n> space: 2em\n\nbelow\n"))
    assert _warnings(capsys) == []


def test_missing_media_warns(deck, capsys):
    build_deck(deck("=== T\n\n! Media/nope.png\n"))
    w = _warnings(capsys)
    assert any("media file not found: Media/nope.png" in l for l in w)


def test_existing_media_is_silent(deck, capsys):
    build_deck(deck("=== T\n\n! Media/ok.png\n",
                    media={"Media/ok.png": PNG}))
    assert _warnings(capsys) == []


def test_healthy_constructs_are_silent(deck, capsys):
    build_deck(deck(
        "=== T\n\n> grid(1,2)\n\n> card | A\n\nx\n\n> card | B\n\ny\n\n"
        "> end: grid\n\n> info Done\n\nz\n\n> end: info\n"))
    assert _warnings(capsys) == []
