"""Authoring fixes found while building a real talk (2026-11-05).

* `#` lines inside an `@@` code block are code, not comments.
* On flex bodies (`> fill`, cards, columns, …) a line mixing text, inline
  spans and inline math flows as one paragraph instead of one row per item.
* `> visibility: uncounted` keeps a slide out of the slide count.
"""

from __future__ import annotations

from revealer.build import _contentify_legacy, _wrap_mixed_inline, slide_index

from helpers import build_deck




def test_hash_lines_survive_inside_code(deck):
    html = build_deck(deck("=== Code\n@@ python\n# a comment in code\nx = 1\n@@\n# a pres comment\n"))
    assert "# a comment in code" in html
    assert "a pres comment" not in html


def test_hash_lines_in_code_do_not_shift_the_index(tmp_path):
    p = tmp_path / "t.pres"
    p.write_text("=== A\n@@\n# not a comment\n=== B\n")
    assert [e["title"] for e in slide_index(str(p))] == ["A", "B"]


def test_mixed_inline_line_is_wrapped():
    h = 'Noise: <span class="chip">a</span> <span class="chip">b</span>'
    assert _wrap_mixed_inline(h) == '<div class="rv-line">' + h + "</div>"
    assert _wrap_mixed_inline("a $x$ b").startswith('<div class="rv-line">')


def test_single_items_and_blocks_are_left_alone():
    for h in ['<span class="lede">x</span>', "plain text", "$x$", "<div>x</div>",
              "<span>unbalanced", "$$a+b$$"]:
        assert _wrap_mixed_inline(h) == h


def test_text_run_wrapped_once_in_flex_only():
    src = 'Noise: [a]{.chip}\n[b]{.chip}'
    flex = _contentify_legacy(src)
    assert flex.count('class="rv-line"') == 1 and "\x00" not in flex
    plain = _contentify_legacy(src, flex=False)
    assert "rv-line" not in plain and "\x00" not in plain


def test_fill_slide_chip_line(deck):
    html = build_deck(deck("=== F\n> fill\nNoise: [a]{.chip} [b]{.chip}\n"))
    assert '<div class="rv-line">Noise: <span class="chip">a</span>' in html


def test_uncounted_visibility(deck):
    html = build_deck(deck("=== A\n--- (backup) B\n> visibility: uncounted\nx\n"))
    assert 'data-visibility="uncounted"' in html
