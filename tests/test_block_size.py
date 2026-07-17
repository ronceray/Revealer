"""`> size:` inside macro blocks (callout boxes, cards, fragments).

The paragraph model consumes slide-, column- and paragraph-scoped size
directives; the ones reaching the legacy renderer sit inside macro blocks,
where they used to leak into the output as literal text.
"""

from __future__ import annotations

import re
from pathlib import Path

from revealer import build as build_mod


def _build(deck, pres, name="bs"):
    pdir = deck(pres, name=name)
    return Path(build_mod.build(str(pdir / (name + ".pres")))).read_text()


def _text_only(html):
    return re.sub(r"<[^>]+>", "", re.sub(r"<style>.*?</style>", "", html, flags=re.S))


def test_size_inside_callout_box_wraps_the_rest_of_the_box(deck):
    html = _build(deck, """=== S

> info Sized box
> size: 60%

first box paragraph

second box paragraph

> end: info

outside paragraph
""")
    m = re.search(r'<div class="box-info".*?</div>\s*<div class="rv-size" '
                  r'style="font-size:0\.6000em">(.*?)</div></div>', html, re.S)
    assert m, "the box body is wrapped in a 0.6em rv-size div"
    assert "first box paragraph" in m.group(1)
    assert "second box paragraph" in m.group(1)
    assert "outside paragraph" not in m.group(1)
    assert "> size" not in _text_only(html)              # nothing leaks


def test_size_roles_and_reset_inside_frag(deck):
    html = _build(deck, """=== S

> frag
> size: lede

big lede text

> size: reset

back to normal

> end: frag
""")
    assert 'style="font-size:1.2500em"' in html          # lede role resolves
    # after the reset, "back to normal" is outside any rv-size wrapper
    m = re.search(r'<div class="rv-size"[^>]*>(.*?)</div>', html, re.S)
    assert m and "back to normal" not in m.group(1)
    assert "> size" not in _text_only(html)


def test_size_and_align_interleave_in_one_wrapper(deck):
    html = _build(deck, """=== S

> info T
> size: 80%
> align: center

both apply here

> end: info
""")
    assert re.search(r'<div class="rv-align rv-align-center" '
                     r'style="font-size:0\.8000em">', html), \
        "align and size share one wrapper div"
    assert "> size" not in _text_only(html)
    assert "> align" not in _text_only(html)


def test_align_only_markup_is_unchanged(deck):
    html = _build(deck, """=== S

> info T
> align: right

right text

> end: info
""")
    assert '<div class="rv-align rv-align-right">' in html
