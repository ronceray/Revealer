"""Generate the language reference pages from the grammar registry.

``src/revealer/grammar.py`` is the single source of truth for the ``.pres``
construct grammar (it also drives the parser, the semantic edit operations
and the browser editor's schema). This script projects that registry into
two Markdown pages:

- ``reference/constructs.md`` — one section per construct;
- ``reference/directives.md`` — the contextual directives table.

It runs automatically at every Sphinx build (wired into ``conf.py``), and
only rewrites a file when its content actually changed, so incremental
builds stay clean. The generated pages are committed: to refresh them by
hand, run ``python3 Documentation/gen_reference.py``.

Stdlib only — the grammar module itself has no third-party imports.
"""

from __future__ import annotations

import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent
SRC = DOCS.parent / "src"

HEADER = (
    "<!-- GENERATED FILE — DO NOT EDIT.\n"
    "     Source of truth: src/revealer/grammar.py\n"
    "     Regenerate with:  python3 Documentation/gen_reference.py\n"
    "     (also runs automatically at every Sphinx build via conf.py) -->\n\n"
)


def _grammar():
    if str(SRC) not in sys.path:
        sys.path.insert(0, str(SRC))
    from revealer import grammar
    return grammar


# --- human-readable opener syntax ---------------------------------------------


def _token_hint(tok) -> str:
    """A compact, human-readable form for one head token."""
    if tok.role == "fragment":
        return "+ or +N"
    if tok.role == "height":
        return "h=N"
    if tok.role == "media-size":
        return "h=… or w=…"
    if tok.role == "keyword" and tok.keywords:
        return " | ".join(tok.keywords)
    return tok.label or tok.name


def _base_form(spec) -> str:
    """Derive a readable opener from the spec (pattern-shaped heuristics)."""
    if spec.variants:
        return "  /  ".join("> " + v for v in spec.variants)
    op = spec.opener
    if op == r"!{1,2}\s+":
        return "! path  (image)   or   !! path  (video)"
    if op == r"\|{1,2}":
        return "||  (open / close a column block)   |  (next column)"
    if op == "@@":
        return "@@ [language / attributes]"
    parse = spec.opener_parse or ""
    if "(?P<rows>" in parse:
        base = "> {0}(rows, cols)".format(spec.name)
        if "compact" in (spec.dispatch or ""):
            base += " [compact]"
        return base
    if op.endswith(":") or op.endswith(r"\s*:"):
        return "> {0}: …".format(spec.name)
    return "> " + spec.name


def _opener_syntax(spec) -> str:
    parts = [_base_form(spec)]
    for tok in spec.head:
        if spec.name == "grid" and tok.name == "gap":
            # grid gap is a separate `> gap:` line, not a head token
            continue
        parts.append("[{0}]".format(_token_hint(tok)))
    if spec.bg_sep:
        parts.append("[{0} background]".format(spec.bg_sep))
    if spec.caption_sep:
        parts.append("[{0} caption]".format(spec.caption_sep))
    return "  ".join(parts)


def _closed_by(spec, g) -> str:
    T = g.Terminator
    if spec.terminator is T.END_PAIRED:
        if spec.end_token == "{variant}":
            ends = " / ".join("`> end: {0}`".format(v) for v in spec.variants)
            return "{0} (each variant closes with its own name)".format(ends)
        return "`> end: {0}`".format(spec.end_token)
    if spec.terminator is T.TOGGLE:
        return "a second `{0}` line".format(spec.opener)
    if spec.terminator is T.SINGLE_LINE:
        return "nothing — a single-line construct"
    if spec.terminator is T.SUB_ITEM:
        return "the next sibling marker or the parent's `> end:`"
    return str(spec.terminator.value)


def _code(text: str) -> str:
    return "`{0}`".format(text.replace("`", "\\`"))


# --- pages ----------------------------------------------------------------------


def _cheat_card(g) -> list[str]:
    """The editor cheatsheet (STATIC_CHEAT + per-construct lines), grouped."""
    groups: dict[str, list[str]] = {}
    order: list[str] = []

    def add(cat: str, line: str) -> None:
        if cat not in groups:
            groups[cat] = []
            order.append(cat)
        if line not in groups[cat]:
            groups[cat].append(line)

    for cat, line in g.STATIC_CHEAT:
        add(cat, line)
    for spec in g.REGISTRY.values():
        for cat, line in spec.cheat:
            add(cat, line)

    out = ["## Quick syntax card", "",
           "The cheatsheet built into the browser editor, generated from the",
           "same registry:", ""]
    for cat in order:
        out.append("**{0}**".format(cat))
        out.append("")
        out.append("```text")
        out.extend(groups[cat])
        out.append("```")
        out.append("")
    return out


def _construct_section(spec, g) -> list[str]:
    out = ["(construct-{0})=".format(spec.name), "", "## {0}".format(spec.label), ""]

    out.append("```text")
    out.append(_opener_syntax(spec))
    out.append("```")
    out.append("")

    rows = [("Closed by", _closed_by(spec, g))]
    if spec.nesting is g.Nesting.SELF:
        rows.append(("Nesting", "self-nesting — a same-kind opener increases the depth"))
    if spec.sub_items:
        subs = ", ".join(_code("> " + s) for s in spec.sub_items)
        rows.append(("Sub-items", subs + (
            " (the first one is implicit — content before the first marker"
            " belongs to it)" if spec.implicit_first else "")))
    rows.append(("Movable", "yes — the editor can reorder, drag and delete it"
                 if spec.movable else "no"))
    if spec.frag_target:
        rows.append(("Fragment flag", "accepts a trailing `+` / `+N`"))
    body_desc = {
        "legacy": "regular slide content (all shortcuts available)",
        "verbatim": "verbatim — content is not parsed",
        "math": "LaTeX math (wrapped in `$$ … $$` when it contains no `$`)",
        "cells": "cells — split by the sub-item markers",
        "none": "none",
    }.get(spec.body, spec.body)
    rows.append(("Body", body_desc))
    if spec.css_classes:
        rows.append(("CSS classes", " ".join(_code("." + c) for c in spec.css_classes)))

    out.append("| | |")
    out.append("| --- | --- |")
    for key, val in rows:
        out.append("| {0} | {1} |".format(key, val))
    out.append("")

    head = [t for t in spec.head]
    if head:
        out.append("Parameters (whitespace-separated head tokens after the opener, unless noted):")
        out.append("")
        out.append("| token | accepted form | meaning | editor op |")
        out.append("| --- | --- | --- | --- |")
        role_desc = {
            "fragment": "reveal as a fragment (`+N` sets `data-fragment-index`)",
            "height": "pinned height in px",
            "size": "size (fraction, %, length or bare flex weight)",
            "media-size": "fixed height / width (px, em, rem, vh, vw, %)",
            "gap": "gap between items (any CSS length)",
            "keyword": "flag keywords",
        }
        for t in head:
            meaning = role_desc.get(t.role, t.role)
            if t.role == "keyword" and t.keywords:
                meaning = "flags: " + ", ".join(_code(k) for k in t.keywords)
            if spec.name == "grid" and t.name == "gap":
                meaning = "gap between cards — written on its own `> gap:` line inside the grid"
            out.append("| {0} | {1} | {2} | {3} |".format(
                _code(t.label or t.name), _code(_token_hint(t)), meaning,
                _code(t.op) if t.op else "—"))
        out.append("")

    if spec.cheat:
        out.append("Examples:")
        out.append("")
        out.append("```text")
        for _cat, line in spec.cheat:
            out.append(line)
        out.append("```")
        out.append("")

    out.append("Opener pattern (the exact regex the parser and editor share):")
    out.append("")
    out.append("```text")
    out.append(spec.opener)
    out.append("```")
    out.append("")
    return out


def render_constructs() -> str:
    g = _grammar()
    out = [HEADER + "# Constructs", ""]
    out += [
        "Every block construct of the `.pres` language, generated from the",
        "grammar registry (`src/revealer/grammar.py`) — the same table that",
        "drives the parser, the editor's semantic edits and its side panel.",
        "For prose and examples see the [authoring guide](../authoring.md).",
        "",
    ]
    out += _cheat_card(g)
    out += ["## Construct index", ""]
    out.append("| construct | opens with | closed by | movable |")
    out.append("| --- | --- | --- | --- |")
    for spec in g.REGISTRY.values():
        out.append("| [{0}](#construct-{1}) | {2} | {3} | {4} |".format(
            spec.label, spec.name,
            _code(_base_form(spec).split("  ")[0].strip()),
            _closed_by(spec, g).split(" (")[0],
            "yes" if spec.movable else "no"))
    out.append("")
    for spec in g.REGISTRY.values():
        out += _construct_section(spec, g)
    return "\n".join(out).rstrip() + "\n"


def render_directives() -> str:
    g = _grammar()
    out = [HEADER + "# Contextual directives", ""]
    out += [
        "These directives take their **scope from where they are written**",
        "(see [authoring › sizes and alignment](../authoring.md#sizes-and-alignment)):",
        "attached to a paragraph they style that paragraph; alone at the top of",
        "a slide or column they set that scope's default; in the settings block",
        "they set the presentation default.",
        "",
        "| directive | aliases | scopes | consumed on `> fill` slides |",
        "| --- | --- | --- | --- |",
    ]
    for d in g.DIRECTIVES.values():
        out.append("| {0} | {1} | {2} | {3} |".format(
            _code("> {0}:".format(d.name)),
            ", ".join(_code(a) for a in d.aliases) if d.aliases else "—",
            ", ".join(d.scopes),
            "yes" if d.on_fill else "no"))
    out += [
        "",
        "```{note}",
        "Only the *contextual* directives live in this registry. The many",
        "fixed-scope `> key: value` parameters (settings, per-slide options,",
        "table/grid options) are listed in [Settings & directives](settings.md).",
        "```",
        "",
    ]
    return "\n".join(out).rstrip() + "\n"


def _write_if_changed(path: Path, content: str) -> bool:
    if path.is_file() and path.read_text(encoding="utf-8") == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def generate() -> list[Path]:
    """Write the generated pages; return the paths that changed."""
    targets = {
        DOCS / "reference" / "constructs.md": render_constructs(),
        DOCS / "reference" / "directives.md": render_directives(),
    }
    return [p for p, text in targets.items() if _write_if_changed(p, text)]


if __name__ == "__main__":
    changed = generate()
    for p in changed:
        print("wrote {0}".format(p.relative_to(DOCS.parent)))
    if not changed:
        print("reference pages up to date")
