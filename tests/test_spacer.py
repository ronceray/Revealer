"""The `> space` vertical spacer directive (filling / fixed)."""

from __future__ import annotations

import re
from pathlib import Path

from revealer import build as build_mod


def _styles(html):
    return re.findall(r'<div class="rv-space"[^>]*style="([^"]*)"', html)


def _build(deck, pres, name="sp"):
    pdir = deck(pres, name=name)
    return Path(build_mod.build(str(pdir / (name + ".pres")))).read_text()


def test_fixed_and_filling_spacers_between_grids(deck):
    html = _build(deck, """=== S
> fill

> grid(1,1)
A
> end: grid

> space: 30px

> grid(1,1)
B
> end: grid

> space
""")
    styles = _styles(html)
    assert "flex:0 0 30px;height:30px;" in styles      # fixed
    assert "flex:1 1 0;min-height:0;" in styles         # filling
    # the spacer sits between the two grids in the flex flow
    body = re.sub(r"<style>.*?</style>", "", html, flags=re.S)
    order = re.findall(r'<div class="(rv-grid-wrap[^" ]*|rv-space)"', body)
    assert order[:3] == ["rv-grid-wrap", "rv-space", "rv-grid-wrap"]
    # never captured as a slide param nor leaked as literal text
    assert "space" not in re.sub(r"<[^>]+>", "", html)


def test_fixed_spacer_on_normal_slide(deck):
    html = _build(deck, "=== S\n\ntop text\n\n> space: 50px\n\nbottom text\n",
                  name="n")
    assert "flex:0 0 50px;height:50px;" in _styles(html)


def test_space_size_is_escaped(deck):
    html = _build(deck, '=== S\n\n> space: 40px"} evil {x:1\n', name="e")
    (style,) = _styles(html)
    assert '"' not in style          # the raw quote can't break the attribute
    assert "&quot;" in style


def test_space_units(deck):
    for i, size in enumerate(("2em", "10%", "1.5rem")):
        html = _build(deck, "=== S\n\n> space: {0}\n".format(size),
                      name="u{0}".format(i))
        assert "flex:0 0 {0};height:{0};".format(size) in _styles(html)
