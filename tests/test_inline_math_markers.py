"""Inline markers that enclose math.

Regression net: `_inline_md` used to split the line at every `$…$` before
matching markers, so `[Library: $\\{b_i\\}$]{.sm}` or `**gain $x$**` were cut
in two and both halves rendered literally — silently.
"""

from __future__ import annotations

from revealer.build import _inline_md, inline_segments


def test_role_span_around_math():
    out = _inline_md(r"[Library: $\{b_i\} = \{1, z\}$]{.sm}")
    assert out == r'<span class="sm">Library: $\{b_i\} = \{1, z\}$</span>'


def test_bold_and_italic_around_math():
    assert _inline_md("**gain $x^2$ here**") == "<b>gain $x^2$ here</b>"
    assert _inline_md("*a $x$ b*") == "<i>a $x$ b</i>"


def test_math_content_is_never_formatted_or_escaped():
    src = r"see $a*b*c < d \& e$ and **bold**"
    assert _inline_md(src) == r"see $a*b*c < d \& e$ and <b>bold</b>"


def test_tags_stay_raw_inside_a_span():
    assert (_inline_md("[x <br> y]{.lede}")
            == '<span class="lede">x <br> y</span>')


def test_placeholder_characters_in_source_are_inert():
    # the placeholder delimiters can never be forged by the author
    assert _inline_md("\x030\x04 $m$ **b**") == "0 $m$ <b>b</b>"


def test_inline_map_still_covers_plain_math_lines():
    assert inline_segments("**bold** and $x$ and *it*") is not None
