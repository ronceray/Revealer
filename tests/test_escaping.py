"""Hostile-character robustness: author text must never corrupt the HTML.

The .pres dialect deliberately lets raw HTML tags pass through body text,
but *stray* markup characters — a `<` in "x < y", an `&` in "R&D", a quote
in a URL or setting — must be neutralized per sink (text, attribute,
<style>, JS literal). Every case here is a real corruption observed in the
2026-07 audit.
"""

from __future__ import annotations

import re

from revealer.build import _inline_md, inline_segments
from helpers import build_deck


def _body(html: str) -> str:
    """The slides markup (skip <head>, so template text can't mask a miss)."""
    return html.split('<div class="slides">', 1)[1]


# --- inline text: stray < and & are escaped, real tags still pass -----------

def test_stray_lt_in_text_is_escaped(deck):
    html = build_deck(deck("=== T\n\nThe x < y case matters.\n"))
    assert "The x &lt; y case matters." in html


def test_stray_lt_with_matching_gt_is_escaped(deck):
    # "< b and c >" must not be treated as an HTML tag.
    html = build_deck(deck("=== T\n\na < b and c > d\n"))
    assert "a &lt; b and c" in html


def test_real_tags_still_pass_through(deck):
    html = build_deck(deck("=== T\n\nkeep <u>underline</u> and <br> here\n"))
    assert "<u>underline</u>" in html
    assert "<br>" in html


def test_bare_ampersand_is_escaped_entities_kept(deck):
    html = build_deck(deck("=== T\n\nR & D but keep &nbsp; and &#233; here\n"))
    assert "R &amp; D" in html
    assert "&nbsp;" in html
    assert "&#233;" in html


def test_math_spans_keep_raw_operators(deck):
    html = build_deck(deck("=== T\n\ninline $a < b$ math\n"))
    assert "$a < b$" in html


# --- slide/deck titles -------------------------------------------------------

def test_slide_header_with_lt_keeps_text(deck):
    html = build_deck(deck("=== The x < y case\n\nbody\n"))
    header = re.search(r'<div class="slide_header">(.*?)</div>', html).group(1)
    assert header == "The x &lt; y case"


def test_deck_title_tag_is_escaped(deck):
    html = build_deck(deck(
        '> title: A < B & "C"\n\n=== S\n\nbody\n'))
    m = re.search(r"<title>(.*?)</title>", html)
    assert "<" not in m.group(1).replace("&lt;", "")
    assert "A &lt; B &amp;" in m.group(1)


def test_first_slide_identity_fields_escaped(deck):
    html = build_deck(deck(
        "> author: Ada & Grace\n"
        "> affiliation: Lab < of > Things\n"
        "> event: R&D day\n"
        "\n"
        ">>> first: Big < Deck\n"
        "\n"
        "=== S\n\nbody\n"))
    assert "Ada &amp; Grace" in html
    assert "Lab &lt; of" in html
    assert "R&amp;D day" in html
    assert "Big &lt; Deck" in html


# --- code blocks --------------------------------------------------------------

def test_code_block_body_is_escaped(deck):
    html = build_deck(deck("=== T\n\n@@\nif a < b && c > d:\n    pass\n@@\n"))
    assert "if a &lt; b &amp;&amp; c &gt; d:" in html


def test_code_block_keeps_entity_escape_hatch(deck):
    # `&#61;&#61;&#61;` is how a literal `===` is shown inside a code block
    # without starting a new slide — it must keep resolving as an entity.
    html = build_deck(deck("=== T\n\n@@\n&#61;&#61;&#61; Marker\n@@\n"))
    assert "&#61;&#61;&#61; Marker" in html


def test_code_block_with_section_tag_keeps_slide_count(deck):
    html = build_deck(deck(
        "=== One\n\n@@\n</section>\n@@\n\n=== Two\n\nb\n\n=== Three\n\nc\n"))
    assert html.count('data-state="slide_') == 3
    assert "&lt;/section&gt;" in html


def test_code_fence_attributes_survive_but_cannot_break_out(deck):
    html = build_deck(deck("=== T\n\n@@ python data-line-numbers\nx = 1\n@@\n"))
    assert re.search(r'<code class="codeblock" python data-line-numbers>', html)
    html2 = build_deck(deck('=== T\n\n@@ x><script>alert(1)</script>\ny\n@@\n',
                            name="fence2"), name="fence2")
    assert "<script>alert(1)</script>" not in _body(html2)


# --- settings sinks -----------------------------------------------------------

def test_color_setting_cannot_escape_style_block(deck):
    html = build_deck(deck(
        "=== S\n> color: red}</style><script>alert(1)</script>\n\nbody\n"))
    assert "<script>alert(1)</script>" not in html
    assert "color: red" in html


def test_double_notes_blocks_do_not_crash(deck):
    html = build_deck(deck(
        "=== S\n\nbody\n\n> notes:\nfirst note\n\n> notes:\nsecond note\n"))
    assert "first note" in html
    assert "second note" in html


def test_notes_size_value_sanitized(deck):
    html = build_deck(deck(
        "=== S\n\nbody\n\n> notes: 1em}</style><script>x</script>\nnote text\n"))
    assert "<script>x</script>" not in html


def test_background_attributes_escaped(deck):
    html = build_deck(deck(
        '=== S\n> background: x.png" onload="alert(1)\n\nbody\n'))
    assert 'onload="alert(1)"' not in html
    sec = re.search(r"<section [^>]*data-background-image=\"([^\"]*)\"", html)
    assert sec is not None


def test_background_video_attributes_escaped(deck):
    html = build_deck(deck(
        "=== S\n> background-video: v.mp4' onx='alert(1)\n\nbody\n"))
    # The whole author value must stay contained in ONE double-quoted
    # attribute (single quotes are inert there) — never become new attributes.
    assert 'data-background-video="v.mp4\' onx=\'alert(1)"' in html


def test_theme_and_codetheme_names_sanitized(deck):
    html = build_deck(deck(
        '> theme: revealer" onerror="alert(1)\n> codeTheme: zenburn" onx="1\n'
        "\n=== S\n\nbody\n"))
    assert 'onerror="alert(1)"' not in html
    assert 'onx="1' not in html


def test_slidenumber_cannot_break_js(deck):
    html = build_deck(deck(
        "> slideNumber: c/t'; alert(1); x='\n\n=== S\n\nbody\n"))
    assert "alert(1); x=" not in html or "\\'" in html
    m = re.search(r"slideNumber: (.*?),", html)
    assert "alert" not in m.group(1) or "\\'" in m.group(1)


def test_logo_src_escaped(deck):
    html = build_deck(deck(
        '> logo: x.png" onerror="alert(1)\n\n>>> first: T\n\n=== S\n\nbody\n'))
    assert 'onerror="alert(1)"' not in html


# --- markdown link and emphasis ------------------------------------------------

def test_link_url_with_quote_cannot_inject(deck):
    html = build_deck(deck(
        "=== T\n\n[click](http://x%22onmouseover=alert@1)\n".replace("%22", '"')))
    a = re.search(r"<a ([^>]*)>click</a>", html).group(1)
    assert "onmouseover" not in a or "&quot;" in a


def test_bold_italic_nesting():
    assert _inline_md("This is ***very*** important") == \
        "This is <b><i>very</i></b> important"


def test_bold_italic_has_inline_map():
    segs = inline_segments("Value ***x*** here")
    assert segs is not None


def test_plain_lt_amp_line_keeps_inline_map():
    assert inline_segments("a < b & c") is not None
    assert inline_segments("R&D and x < y with *em*") is not None
