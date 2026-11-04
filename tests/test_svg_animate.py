"""`> animate:` parsing — comma-separated selectors may include spaces.

Regression net for a silent no-op: `> animate: #a, #b opacity:1` used to
split at the first whitespace, leaving `#a,` as the target and shipping
`#b opacity:1` as one bogus attribute declaration (docs promise
`#sel[,#sel2] attr:val`, spaces included).
"""

from __future__ import annotations

from helpers import build_deck

from revealer.build import _parse_animate

SVG = (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
       b'<rect id="a" width="4" height="4"/>'
       b'<circle id="b" cx="7" cy="7" r="2"/></svg>')


def test_single_selector():
    assert _parse_animate("#dot opacity:1", "0.5s") == ("#dot", "opacity:1", "0.5s")


def test_multi_selector_without_space():
    assert _parse_animate("#a,#b opacity:1", "0.5s") == ("#a,#b", "opacity:1", "0.5s")


def test_multi_selector_with_space():
    assert _parse_animate("#a, #b opacity:1", "0.5s") == ("#a, #b", "opacity:1", "0.5s")


def test_multi_selector_space_before_comma():
    targets, attrs, _ = _parse_animate("#a , #b opacity:1", "0.5s")
    assert [s.strip() for s in targets.split(",") if s.strip()] == ["#a", "#b"]
    assert attrs == "opacity:1"


def test_multi_selector_with_attrs_and_duration():
    assert _parse_animate("#a, #b opacity:1; fill:#c00 @ 1s", "0.5s") == (
        "#a, #b", "opacity:1; fill:#c00", "1s")


def test_comma_space_inside_a_value_is_not_a_selector():
    assert _parse_animate("#dot transform:translate(2, 0)", "0.5s") == (
        "#dot", "transform:translate(2, 0)", "0.5s")


def test_built_deck_carries_the_full_selector_list(deck):
    html = build_deck(deck(
        "=== S\n> svg: Media/d.svg\n> hide: #a, #b\n"
        "> animate: #a, #b opacity:1\n\nText\n",
        media={"Media/d.svg": SVG}))
    assert 'data-svg-target="#a, #b"' in html
    assert 'data-svg-attrs="opacity:1"' in html


# --- `> svg:` inside layout blocks, and indexed animate steps ---------------

from revealer.build import _split_animate_index


def test_animate_index_marker():
    assert _split_animate_index("+3 #a opacity:1") == (3, "#a opacity:1")
    assert _split_animate_index("+ #a opacity:1") == (None, "#a opacity:1")
    assert _split_animate_index("#a opacity:1") == (None, "#a opacity:1")


def test_indexed_animate_step_carries_fragment_index(deck):
    html = build_deck(deck(
        "=== S\n> svg: Media/d.svg\n> animate: +0 #a opacity:1\n"
        "> animate: #b opacity:1\n\nText\n",
        media={"Media/d.svg": SVG}))
    assert ('class="fragment revealer-svg-anim" data-fragment-index="0" '
            'data-svg-target="#a"') in html
    assert 'class="fragment revealer-svg-anim" data-svg-target="#b"' in html


def _col_html(html, marker):
    """The region of `html` from the first `.region` column to `marker`."""
    return html[html.index('class="region'):html.index(marker)]


def test_svg_inside_a_column_renders_in_that_column(deck, capsys):
    html = build_deck(deck(
        "=== S\n> fill\n> row\n> col\nLEFTCOL\n> svg: Media/d.svg\n"
        "> animate: +1 #a opacity:1\n> col\nRIGHTCOL\n> end: row\n",
        media={"Media/d.svg": SVG}))
    assert "> svg:" not in html and "&gt; svg:" not in html
    assert "animate:" not in html.replace("revealer-svg-anim", "")
    # the inline SVG sits between the two columns' text, i.e. in the left column
    i_left, i_svg, i_right = (html.index("LEFTCOL"),
                              html.index('class="revealer-svg"'),
                              html.index("RIGHTCOL"))
    assert i_left < i_svg < i_right
    assert 'data-fragment-index="1"' in html
    assert "__REVEALER_SVG__" not in html
    assert "Warning" not in capsys.readouterr().out


def test_svg_inside_a_pin(deck):
    html = build_deck(deck(
        "=== S\n> fill\n> pin: 50% 50% 30%\n> svg: Media/d.svg\n> end: pin\n",
        media={"Media/d.svg": SVG}))
    pin = html[html.index('class="rv-pin'):html.index("</section>")]
    assert 'class="revealer-svg"' in pin
    assert "&gt; svg:" not in html and "__REVEALER_SVG__" not in html
