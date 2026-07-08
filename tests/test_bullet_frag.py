"""`* +` / `* +N` — reveal a single bullet as a reveal.js fragment.

Only `*` is a bullet marker in the renderer, so a leading `+`/`+N` after the
marker is unambiguous. A literal leading "+" is written `* \\+ …`.
"""

from __future__ import annotations

from helpers import build_deck


def _html(deck, src: str) -> str:
    return build_deck(deck(src))


def test_star_plus_makes_li_a_fragment(deck):
    html = _html(deck, "=== T\n\n* + one\n* two\n")
    assert '<li class="fragment">one</li>' in html
    assert "<li>two</li>" in html          # unflagged bullet unchanged


def test_star_plus_index(deck):
    html = _html(deck, "=== T\n\n* +2 one\n")
    assert 'class="fragment"' in html
    assert 'data-fragment-index="2"' in html


def test_nested_star_plus(deck):
    html = _html(deck, "=== T\n\n* a\n  * + nested\n")
    assert html.count('class="fragment"') == 1
    assert '<li class="fragment">nested</li>' in html


def test_escaped_plus_is_literal(deck):
    html = _html(deck, "=== T\n\n* \\+ literal\n")
    assert "fragment" not in html
    assert "+ literal" in html
    assert "\\+" not in html                # the backslash is consumed


def test_no_space_after_plus_is_literal(deck):
    html = _html(deck, "=== T\n\n* +foo\n")
    assert "fragment" not in html
    assert "+foo" in html
