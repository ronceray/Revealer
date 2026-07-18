"""The skill's generated syntax reference stays in lockstep with the grammar.

`.claude/skills/revealer-slides/references/syntax.md` is a committed
generated file (like Documentation/reference/constructs.md). Regenerate
with `python3 Documentation/gen_reference.py` after touching grammar.py
or Documentation/reference/settings.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO / "Documentation") not in sys.path:
    sys.path.insert(0, str(REPO / "Documentation"))

import gen_reference  # noqa: E402

from revealer import grammar  # noqa: E402

SYNTAX = REPO / ".claude" / "skills" / "revealer-slides" / "references" / "syntax.md"


def test_syntax_md_is_committed_and_current():
    assert SYNTAX.is_file(), (
        "missing generated file — run python3 Documentation/gen_reference.py")
    assert SYNTAX.read_text(encoding="utf-8") == gen_reference.render_skill_syntax(), (
        "syntax.md is stale — run python3 Documentation/gen_reference.py")


def test_every_construct_and_directive_is_documented():
    text = SYNTAX.read_text(encoding="utf-8")
    for spec in grammar.REGISTRY.values():
        assert "## {0}".format(spec.label) in text, spec.name
    for d in grammar.DIRECTIVES.values():
        assert "`> {0}:`".format(d.name) in text, d.name


def test_no_myst_anchors_leak_into_the_skill_file():
    text = SYNTAX.read_text(encoding="utf-8")
    assert "(construct-" not in text
    assert "```{note}" not in text
