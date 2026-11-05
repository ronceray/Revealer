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


def test_backup_slides_uncounted_by_default(deck):
    html = build_deck(deck("=== A\n--- (backup) B\nx\n=== Backup: C\ny\n"
                           "=== (Backup) D\n> visibility: counted\nz\n=== Backups are fun\n"))
    assert html.count('data-visibility="uncounted"') == 2


# --- trailing line roles, migrate, positional fill size, counter -----------

from revealer.build import _inline_md, contentify, inline_segments, migrate_roles  # noqa: E402


def test_trailing_role_equals_bracket_form():
    for body in ["Gerardos & Ronceray, *PRL* (2025)", "Library: $\\{b_i\\}$", "plain"]:
        assert _inline_md(body + " {.sm}") == _inline_md("[" + body + "]{.sm}")
    assert _inline_md("a [link](http://x) {.fine .accent}") == (
        '<span class="fine accent">a <a href="http://x" target="_blank">link</a></span>')
    assert _inline_md("red {color=#c00}") == '<span style="color:#c00">red</span>'


def test_trailing_role_needs_space_and_known_items():
    for t in ["set {x}", "word{.sm}", "plain {.sm}x", "a {b c}"]:
        assert _inline_md(t) == t


def test_trailing_role_keeps_the_inline_map():
    segs = inline_segments("A *b* {.sm}")
    assert segs is not None and "".join(s[2] for s in segs) == _inline_md("A *b* {.sm}")


def test_migrate_rewrites_whole_lines_only():
    src = ("[A line]{.sm}\n* +2 [bullet]{.fine}\n[a]{.chip} [b]{.chip}\n"
           "@@\n[code]{.sm}\n@@\n# [comment]{.sm}\n")
    new, n = migrate_roles(src)
    assert n == 2
    assert new.splitlines()[:3] == ["A line {.sm}", "* +2 bullet {.fine}", "[a]{.chip} [b]{.chip}"]
    assert "[code]{.sm}" in new and "# [comment]{.sm}" in new


def test_fill_size_is_positional():
    top = contentify("> size: 0.8\nx\n", fill=True)
    assert top.startswith('<div class="rv-fillsize" style="font-size:0.8000em')
    later = contentify("x\n> size: 0.7\ny\n", fill=True)
    assert "rv-fillsize" not in later and 'class="rv-size" style="font-size:0.7000em">y' in later


def test_index_counter_skips_backups(tmp_path):
    p = tmp_path / "t.pres"
    p.write_text("=== A\n--- (backup) B\n=== C\n> visibility: uncounted\n=== D\n")
    assert [e["counter"] for e in slide_index(str(p))] == [1, None, None, 2]
