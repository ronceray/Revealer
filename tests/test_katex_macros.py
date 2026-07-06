"""P4a: `> macros:` / `> macro:` -> KaTeX macros; `> katex:` merges, not clobbers."""

from __future__ import annotations

from pathlib import Path

from revealer import build as build_mod
from revealer.build import _parse_inline_macro, _parse_tex_macros

DEFS = r"""
% shared lecture macros
\newcommand{\R}{\mathbb{R}}
\renewcommand*{\vec}[1]{\boldsymbol{#1}}
\newcommand{\avg}[2]{\left\langle #1 \right\rangle_{#2}}
\newcommand{\esc}{a\{b\}c}
"""


def test_parse_tex_macros():
    ms = _parse_tex_macros(DEFS)
    assert ms[r"\R"] == r"\mathbb{R}"
    assert ms[r"\vec"] == r"\boldsymbol{#1}"          # [n] dropped, KaTeX infers
    assert ms[r"\avg"] == r"\left\langle #1 \right\rangle_{#2}"
    assert ms[r"\esc"] == r"a\{b\}c"                   # escaped braces survive
    assert len(ms) == 4


def test_parse_inline_macro():
    assert _parse_inline_macro(r" \half \frac{1}{2} ") == (r"\half", r"\frac{1}{2}")
    assert _parse_inline_macro("no-backslash") is None


def _build_html(deck, pres_text, files=None):
    pdir = deck(pres_text, name="kx", media=files or {})
    out = build_mod.build(str(pdir / "kx.pres"))
    return Path(out).read_text(encoding="utf-8")


def test_macros_file_and_inline_emitted(deck):
    html = _build_html(deck, """> title: Macros
> macros: defs.tex
> macro: \\half \\frac{1}{2}

=== One

$\\R \\half$
""", files={"defs.tex": DEFS.encode("utf-8")})
    (katex_line,) = [ln for ln in html.split("\n") if "katex: {" in ln]
    assert "local: 'reveal.js/katex'" in katex_line
    assert '"\\\\R": "\\\\mathbb{R}"' in katex_line
    assert '"\\\\half": "\\\\frac{1}{2}"' in katex_line


def test_user_katex_merges_with_local_bundle(deck):
    """The old guard dropped the local bundle whenever `> katex:` was set."""
    html = _build_html(deck, """> title: Merge
> katex: { trust: true }
> macro: \\half \\frac{1}{2}

=== One

$\\half$
""")
    (katex_line,) = [ln for ln in html.split("\n") if "katex: {" in ln]
    assert "local: 'reveal.js/katex'" in katex_line
    assert "trust: true" in katex_line
    assert '"\\\\half"' in katex_line


def test_missing_macros_file_warns_but_builds(deck, capsys):
    html = _build_html(deck, """> title: Missing
> macros: nope.tex

=== One

x
""")
    assert "katex: {" in html
    assert "nope.tex" in capsys.readouterr().out


def test_commented_macros_are_ignored(deck):
    html = _build_html(deck, """> title: C
> macros: defs.tex

=== One

x
""", files={"defs.tex": (b"% \\newcommand{\\bad}{OLD}\n"
                          b"\\newcommand{\\good}{\\mathbb{R}}\n")})
    (katex_line,) = [ln for ln in html.split("\n") if "katex: {" in ln]
    assert "good" in katex_line
    assert "bad" not in katex_line  # the % line never reached KaTeX


def test_macro_body_cannot_break_out_of_script(deck):
    html = _build_html(deck, """> title: X
> macro: \\bad \\text{</script>}

=== One

$\\bad$
""")
    # the macro value must be escaped so it can't close the inline script
    (katex_line,) = [ln for ln in html.split("\n")
                     if "bad" in ln and "katex: {" in ln]
    assert "</script>" not in katex_line
    assert "<\\/script>" in katex_line
