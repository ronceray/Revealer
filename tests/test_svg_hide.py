"""P4e: `> hide:` tokenizer hardening — hostile SVGs, style opacity, data-id."""

from __future__ import annotations

from revealer.build import _svg_hide_ids

SVG = """<svg xmlns="http://www.w3.org/2000/svg">
<!-- a comment mentioning id="axis" must not match -->
<rect data-id="axis" width="3"/>
<text label="a>b" id="axis" fill="red">x</text>
<circle id='quoted' r="2"/>
<g id="styled" style="fill:blue;opacity:.85"><path d="M0 0"/></g>
<g id="styled2" style="fill:blue"><path d="M0 0"/></g>
<rect id="withattr" opacity="0.7" width="1"/>
<rect id="selfclosing" width="1"/>
<rect id="axis" width="9"/>
</svg>"""


def _hidden(svg, ids):
    return _svg_hide_ids(svg, ids)


def test_data_id_is_not_id():
    out = _hidden(SVG, {"axis"})
    # the data-id rect is untouched; the real id="axis" text is hidden
    assert '<rect data-id="axis" width="3"/>' in out
    assert '<text label="a>b" id="axis" fill="red" opacity="0">' in out


def test_only_first_match_per_id():
    out = _hidden(SVG, {"axis"})
    assert '<rect id="axis" width="9"/>' in out  # second occurrence untouched


def test_quote_containing_gt_survives():
    out = _hidden(SVG, {"quoted"})
    assert "<circle id='quoted' r=\"2\" opacity=\"0\"/>" in out


def test_style_opacity_rewritten_in_style():
    out = _hidden(SVG, {"styled"})
    assert '<g id="styled" style="fill:blue;opacity:0">' in out


def test_style_without_opacity_gets_it_appended():
    out = _hidden(SVG, {"styled2"})
    assert '<g id="styled2" style="fill:blue;opacity:0">' in out


def test_opacity_attribute_replaced():
    out = _hidden(SVG, {"withattr"})
    assert '<rect id="withattr" opacity="0" width="1"/>' in out


def test_selfclosing_gains_attribute():
    out = _hidden(SVG, {"selfclosing"})
    assert '<rect id="selfclosing" width="1" opacity="0"/>' in out


def test_comment_ids_never_match_and_bytes_preserved():
    out = _hidden(SVG, {"nonexistent"})
    assert out == SVG  # untouched ids -> byte-identical passthrough
    out2 = _hidden(SVG, {"styled"})
    # everything except the one targeted tag is byte-identical
    assert out2.replace('style="fill:blue;opacity:0"',
                        'style="fill:blue;opacity:.85"') == SVG
