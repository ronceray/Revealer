"""Regression fences for the 2026-09 issue batch: column sizing (#2 #3 #4
#5), the KaTeX bundle race (#1), the auto-fit floor (#7), `revealer index`
(#9), `> fill` in the grammar (#10), callout title sizes (#11), `h=` on a
stack layer (#17) and void paragraphs (#18)."""

from __future__ import annotations

import re

from helpers import build_deck

# Each section imports what it tests (the sections landed one commit per
# issue, and the file must stay green at every one of them).

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63f8ffff3f0300050001a5f645400000000049454e44ae426082"
)


def _warnings(capsys):
    return [line for line in capsys.readouterr().out.splitlines()
            if line.startswith("Warning:")]


def _flexes(html):
    return re.findall(r'<div class="region[^"]*" style="flex:([^;]+);', html)


# --- #2: fractions are shares of the row ------------------------------------

def test_fraction_columns_keep_their_ratio(deck):
    html = build_deck(deck(
        "=== T\n> fill\n> row\n> col 1/6\na\n> col 1/6\nb\n> col 1/6\nc\n"
        "> col 1/2\nd\n> end: row\n"))
    assert _flexes(html) == ["1 1 0", "1 1 0", "1 1 0", "3 1 0"]


def test_same_denominator_fractions_are_unchanged(deck):
    html = build_deck(deck("=== T\n> fill\n> row\n> col 2/5\na\n> col 3/5\nb\n> end: row\n"))
    assert _flexes(html) == ["2 1 0", "3 1 0"]


def test_fractions_over_one_row_warn(deck, capsys):
    build_deck(deck("=== T\n> fill\n> row\n> col 1/2\na\n> col 2/3\nb\n> end: row\n"))
    assert any("column fractions add up to 7/6" in line for line in _warnings(capsys))


# --- #3: whitespace before the first column is not a column ------------------

def test_blank_line_after_row_opens_no_column(deck):
    html = build_deck(deck(
        "=== T\n> fill\n\n> row\n\n> col 1/2\nleft\n> col 1/2\nright\n> end: row\n"))
    assert _flexes(html) == ["1 1 0", "1 1 0"]


def test_content_before_the_first_col_is_still_the_implicit_column(deck):
    html = build_deck(deck("=== T\n> fill\n> row\nlead\n> col\nnext\n> end: row\n"))
    assert len(_flexes(html)) == 2
    assert "lead" in html


# --- #4: percentages are shares of the usable width ---------------------------

def test_percent_columns_subtract_their_share_of_the_gaps(deck):
    html = build_deck(deck(
        "=== T\n> fill\n> row\n> col 17%\na\n> col 17%\nb\n> col 17%\nc\n"
        "> col 45%\nd\n> end: row\n"))
    fl = _flexes(html)
    assert fl[0] == "0 0 calc(17% - 0.51 * var(--gap-col))"
    assert fl[3] == "0 0 calc(45% - 1.35 * var(--gap-col))"


def test_single_percent_column_has_no_gap_term(deck):
    html = build_deck(deck("=== T\n> fill\n> row\n> col 60%\na\n> end: row\n"))
    assert _flexes(html) == ["0 0 60%"]


def test_percent_columns_use_the_row_gap(deck):
    html = build_deck(deck(
        "=== T\n> fill\n> row gap=20px\n> col 50%\na\n> col 50%\nb\n> end: row\n"))
    assert _flexes(html) == ["0 0 calc(50% - 0.5 * 20px)"] * 2
    assert "gap:20px;" in html


# --- #5: a bare length after `> row` is the gap, and says so ------------------

def test_bare_length_after_row_warns(deck, capsys):
    html = build_deck(deck("=== T\n> fill\n> row 60px\n> col\na\n> end: row\n"))
    assert "gap:60px;" in html
    w = _warnings(capsys)
    assert any("'> row 60px' sets the column gap" in line and "h=60" in line
               and "gap=60px" in line for line in w)


def test_gap_keyword_is_silent(deck, capsys):
    html = build_deck(deck("=== T\n> fill\n> row gap=60px h=200\n> col\na\n> end: row\n"))
    assert "gap:60px;" in html and "height:200px" in html
    assert _warnings(capsys) == []


# --- #18: markup that renders nothing takes no paragraph slot -----------------

def test_style_only_block_takes_no_paragraph_slot(deck):
    html = build_deck(deck("=== T\n\n<style>.x{color:red}</style>\n\nreal text\n"))
    assert html.count('<div class="rv-paragraph"') == 1
    assert "<style>.x{color:red}</style>" in html
    assert html.index("<style>.x") < html.index('<div class="rv-paragraph"')


def test_style_only_block_on_the_title_slide(deck):
    html = build_deck(deck(
        "> title: T\n\n>>> first: Deck\n\n<style>.x{color:red}</style>\n\n"
        '<div class="strip">strip</div>\n'))
    section = html[html.index("<section"):html.index("</section>")]
    assert section.count('<div class="rv-paragraph"') == 1
    assert "<style>.x{color:red}</style>" in section


def test_style_with_visible_content_keeps_its_paragraph(deck):
    html = build_deck(deck("=== T\n\n<style>.x{color:red}</style>\nvisible\n\nmore\n"))
    assert html.count('<div class="rv-paragraph"') == 2


# --- #17: `h=` on a layer's media sizes the stack -----------------------------

def test_layer_media_height_sizes_the_stack(deck):
    html = build_deck(deck(
        "=== T\n> fill\n> stack\n> layer\n! Media/a.png fill contain h=660px\n"
        "> layer +\n! Media/b.png fill contain\n> end: stack\n",
        media={"Media/a.png": PNG, "Media/b.png": PNG}))
    assert 'class="rv-stack" style="flex:0 0 660px;height:660px;"' in html


def test_stack_h_wins_over_the_layer_media_h(deck):
    html = build_deck(deck(
        "=== T\n> fill\n> stack h=300\n> layer\n! Media/a.png fill h=660\n> end: stack\n",
        media={"Media/a.png": PNG}))
    assert 'style="flex:0 0 300px;height:300px;"' in html


def test_disagreeing_layer_heights_warn(deck, capsys):
    build_deck(deck(
        "=== T\n> fill\n> stack\n> layer\n! Media/a.png fill h=600\n"
        "> layer +\n! Media/a.png fill h=400\n> end: stack\n",
        media={"Media/a.png": PNG}))
    assert any("different heights (600px and 400px)" in line for line in _warnings(capsys))
