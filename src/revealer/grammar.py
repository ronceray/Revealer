"""The .pres construct grammar — single source of truth.

Every surface that knows the DSL's shapes derives from this registry:

- ``build.py``: the legacy-renderer dispatch table, the macro-atomicity
  union used by the block/paragraph splitters, and the build-loop
  passthrough rules;
- ``edit.py``: the anchor and token grammars of the semantic edit ops;
- the dev server's ``GET /__rv__/schema``: the JSON projection driving the
  browser editor's construct model, panel fields and cheatsheet;
- the documentation reference chapter (generated).

Only *patterns and parameter metadata* live here. Parser behavior (body
rendering, emission templates, provenance attachment, escaping) stays code
in ``build.py`` — entries are identifiers those parsers register against,
not a replacement for them.
"""

from __future__ import annotations

import enum
import re
from dataclasses import dataclass

# --- shared token patterns ------------------------------------------------------

FRAG_TOKEN = r"\+(\d+)?"
SIZE_TOKEN = r"(?:\d+\s*/\s*\d+|\d+(?:\.\d+)?(?:px|%|em|rem|vh|vw)|\d+)"
H_TOKEN = r"h=\d+(?:px)?"
MEDIA_SIZE_TOKEN = r"([hw])=([0-9.]+(?:px|em|rem|vh|vw|%)?)"


class Terminator(enum.Enum):
    END_PAIRED = "end-paired"   # > x ... > end: x
    TOGGLE = "toggle"           # @@ ... @@
    SINGLE_LINE = "single-line"  # ! media, || separator, one-line directives
    SUB_ITEM = "sub-item"       # col/card/layer/cell: runs to next marker or parent end


class Nesting(enum.Enum):
    NONE = "none"   # first matching `> end:` wins
    SELF = "self"   # a same-kind opener re-increments depth


@dataclass(frozen=True)
class TokenSpec:
    """One whitespace-delimited head token a construct accepts."""

    name: str                  # "frag", "height", "size", "gap", "keywords"
    pattern: str               # anchored when matched: ^pattern$
    role: str                  # fragment | height | size | media-size | gap | keyword
    flags: str = ""            # "i" -> IGNORECASE (mirrored to the JS schema)
    label: str | None = None   # editor panel label
    op: str | None = None      # edit.py op this token maps to
    coerce: str | None = None  # "int" | None
    keywords: tuple[str, ...] = ()


@dataclass(frozen=True)
class ConstructSpec:
    name: str
    label: str
    opener: str                          # loose pattern: atomicity union + edit anchors
    dispatch: str | None = None          # stricter legacy-dispatch pattern (grid)
    opener_parse: str | None = None      # named-group head parse; default opener+(?P<flags>.*)$
    terminator: Terminator = Terminator.END_PAIRED
    end_token: str | None = None
    nesting: Nesting = Nesting.NONE
    variants: tuple[str, ...] = ()
    atomic: bool = False                 # kept whole through block/paragraph splitters
    passthrough: str | None = None       # "table" | "macro" | None (build-loop mechanism)
    sub_items: tuple[str, ...] = ()
    implicit_first: bool = False
    head: tuple[TokenSpec, ...] = ()
    caption_sep: str | None = None       # "|" (media caption / card title / box title)
    bg_sep: str | None = None            # ":" (card background)
    movable: bool = False
    frag_target: str | None = None       # construct name for set_fragment_index
    css_classes: tuple[str, ...] = ()
    body: str = "legacy"                 # doc label: legacy | verbatim | math | cells | none
    cheat: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class DirectiveSpec:
    """A scoped content directive (kept in the content stream by the build loop)."""

    name: str
    aliases: tuple[str, ...] = ()
    scopes: tuple[str, ...] = ("slide", "block", "paragraph")
    on_fill: bool = True   # consumed (not leaked as text) on `> fill` slides


_FRAG = TokenSpec("frag", FRAG_TOKEN, "fragment", label="fragment #",
                  op="set_fragment_index")


def _c(spec: ConstructSpec) -> ConstructSpec:
    return spec


# Insertion order IS the legacy-dispatch order (load-bearing).
REGISTRY: dict[str, ConstructSpec] = {s.name: s for s in [
    _c(ConstructSpec(
        "table", "table",
        opener=r">\s*table\(\s*\d+\s*,\s*\d+\s*\)\s*$",
        opener_parse=r">\s*table\(\s*(?P<rows>\d+)\s*,\s*(?P<cols>\d+)\s*\)\s*$",
        end_token="table", atomic=True, passthrough="table", movable=True,
        sub_items=("cell",), implicit_first=True,
        css_classes=("rv-table-wrap",), body="cells",
        cheat=(("Components", "> table(2,3)"),),
    )),
    _c(ConstructSpec(
        "grid", "grid",
        opener=r">\s*grid\(\s*\d+\s*,\s*\d+\s*\)",
        dispatch=r">\s*grid\(\s*\d+\s*,\s*\d+\s*\)\s*(?:compact)?\s*$",
        opener_parse=r">\s*grid\(\s*(?P<rows>\d+)\s*,\s*(?P<cols>\d+)\s*\)\s*(?P<compact>compact)?\s*$",
        end_token="grid", atomic=True, passthrough="macro", movable=True,
        sub_items=("card",), implicit_first=True,
        head=(TokenSpec("gap", r".+", "gap", label="gap", op="set_grid_gap"),),
        css_classes=("rv-grid-wrap",), body="cells",
        cheat=(("Components", "> grid(2,2) compact / > card +"),),
    )),
    _c(ConstructSpec(
        "pin", "pin",
        opener=r">\s*pin\s*:",
        opener_parse=r">\s*pin\s*:\s*(?P<flags>.*?)\s*$",
        end_token="pin", atomic=True, passthrough="macro", movable=True,
        head=(_FRAG,),
        css_classes=("rv-pin",),
        cheat=(("Components", "> pin: 50% 50% 20% +"),),
    )),
    _c(ConstructSpec(
        "row", "row",
        opener=r">\s*row\b",
        end_token="row", nesting=Nesting.SELF, atomic=True, passthrough="macro",
        movable=True, sub_items=("col",), implicit_first=True,
        head=(_FRAG,
              TokenSpec("height", H_TOKEN, "height", label="height px",
                        op="set_row_height", coerce="int"),
              TokenSpec("gap", r".+", "gap", label="gap", op="set_row_gap")),
        css_classes=("row",),
        cheat=(("Layout", "> row h=400 24px"),),
    )),
    _c(ConstructSpec(
        "box", "callout",
        opener=r">\s*(?:info|warn|good)\b",
        variants=("info", "warn", "good"),
        end_token="{variant}", atomic=True, passthrough="macro", movable=True,
        head=(_FRAG,),
        css_classes=("box-info", "box-warn", "box-good"),
        cheat=(("Components", "> info Title … > end: info"),
               ("Components", "> warn / > good")),
    )),
    _c(ConstructSpec(
        "eq", "equation",
        opener=r">\s*eq\b",
        end_token="eq", atomic=True, passthrough="macro", movable=True,
        head=(_FRAG,),
        css_classes=("math-box",), body="math",
        cheat=(("Components", "> eq +  … > end: eq"),),
    )),
    _c(ConstructSpec(
        "stack", "stack",
        opener=r">\s*stack\b",
        end_token="stack", atomic=True, passthrough="macro", movable=True,
        sub_items=("layer",), implicit_first=True,
        head=(TokenSpec("height", H_TOKEN, "height", label="height px",
                        op="set_stack_height", coerce="int"),),
        css_classes=("rv-stack",),
        cheat=(("Components", "> stack h=300 / > layer + clear"),),
    )),
    _c(ConstructSpec(
        "frag", "fragment",
        opener=r">\s*frag\b",
        end_token="frag", nesting=Nesting.SELF, atomic=True, passthrough="macro",
        movable=True,
        css_classes=("fragment",),
        cheat=(("Components", "> frag 2 … > end: frag"),),
    )),
    # --- single-line / sub-item constructs (not in the macro union) ---
    _c(ConstructSpec(
        "media", "media",
        opener=r"!{1,2}\s+",
        opener_parse=r"(?P<head>\s*!{1,2}\s+)(?P<rest>.*)$",
        terminator=Terminator.SINGLE_LINE, movable=True, frag_target="media",
        head=(_FRAG,
              TokenSpec("size", MEDIA_SIZE_TOKEN, "media-size", flags="i",
                        label="size", op="set_media_size"),
              TokenSpec("keywords", r".+", "keyword",
                        keywords=("fill", "contain", "cover", "top",
                                  "loop", "autoplay", "controls"))),
        caption_sep="|",
        css_classes=("rv-fig", "rv-media", "rv-media-fill"),
        cheat=(("Media", "! img.png fill h=200px +2 | caption"),
               ("Media", "!! movie.mp4 loop")),
    )),
    _c(ConstructSpec(
        "col", "column",
        opener=r">\s*col\b",
        terminator=Terminator.SUB_ITEM, frag_target="col",
        head=(_FRAG,
              TokenSpec("size", SIZE_TOKEN, "size",
                        label="size (2/5, 40%, 300px)", op="set_col_size"),
              TokenSpec("keywords", r".+", "keyword",
                        keywords=("center", "relative", "clip"))),
        css_classes=("region",),
        cheat=(("Layout", "> col 2/5 center"),),
    )),
    _c(ConstructSpec(
        "card", "card",
        opener=r">\s*card\b",
        terminator=Terminator.SUB_ITEM, frag_target="card",
        head=(_FRAG,
              TokenSpec("keywords", r".+", "keyword", keywords=("plain",))),
        caption_sep="|", bg_sep=":",
        css_classes=("rv-card", "rv-cell"),
    )),
    _c(ConstructSpec(
        "layer", "layer",
        opener=r">\s*layer\b",
        terminator=Terminator.SUB_ITEM, frag_target="layer",
        head=(_FRAG,
              TokenSpec("keywords", r".+", "keyword", keywords=("clear",))),
        css_classes=("rv-layer",),
    )),
    _c(ConstructSpec(
        "cell", "table cell",
        opener=r">\s*cell\b",
        terminator=Terminator.SUB_ITEM,
        bg_sep=":",
        css_classes=("rv-table-cell",),
    )),
    _c(ConstructSpec(
        "sep", "text column",
        opener=r"\|{1,2}",
        opener_parse=r"(?P<head>\s*\|{1,2})(?P<width>[^|]*)$",
        terminator=Terminator.SINGLE_LINE,
        head=(TokenSpec("width", r".+", "size", label="width",
                        op="set_block_width"),),
        css_classes=("column",),
        cheat=(("Layout", "|| 40%   (text columns)"), ("Layout", "| 55%"),
               ("Layout", "||")),
    )),
    _c(ConstructSpec(
        "code", "code block",
        opener=r"@@",
        terminator=Terminator.TOGGLE, atomic=True,
        body="verbatim",
        cheat=(("Text & math", "@@ python … @@"),),
    )),
]}

# The frozen member order of the legacy `_MACRO_OPEN_RE` union. This is NOT
# dispatch order (frag precedes stack in the historical literal); it exists
# solely so the derived pattern is character-identical to the one every
# existing deck was built with.
_MACRO_UNION_ORDER: tuple[str, ...] = ("grid", "pin", "row", "box", "eq", "frag", "stack")

# Directives resolved by scope position (see contentify) — `on_fill` marks
# which are consumed on `> fill` slides instead of leaking into the output.
DIRECTIVES: dict[str, DirectiveSpec] = {d.name: d for d in [
    DirectiveSpec("size", aliases=()),
    DirectiveSpec("align"),
    DirectiveSpec("paragraph-spacing", aliases=("paragraph_spacing",)),
]}

# Cheatsheet lines with no owning construct.
STATIC_CHEAT: tuple[tuple[str, str], ...] = (
    ("Slides", "=== Slide title"),
    ("Slides", "--- vertical sub-slide"),
    ("Slides", "%%% Section divider"),
    ("Slides", ">>> first: Deck title"),
    ("Slides", ">>> biblio"),
    ("Layout", "> fill"),
    ("Text & math", "* bullet (2 spaces = nested)"),
    ("Text & math", "[ highlighted line ]"),
    ("Text & math", "$inline$  $$display$$"),
    ("Inline format", "**bold**  *italic*  `code`"),
    ("Inline format", "[text](https://url)"),
    ("Inline format", "[text]{.accent}  [x]{color=#f00}"),
    ("Inline format", "[big]{.lede}  [small]{.sm}"),
    ("Inline format", "> size: lede   (paragraph scope)"),
    ("Inline format", "> align: center"),
    ("Inline format", "escape: \\* \\` \\["),
)


# --- derived patterns -------------------------------------------------------------


def macro_open_pattern() -> str:
    """The splitter/build-loop atomicity union — character-identical to the
    historical ``_MACRO_OPEN_RE`` literal."""
    grid = r"grid\(\s*\d+\s*,\s*\d+\s*\)"
    pin = r"pin\s*:"
    words = "|".join(n if n != "box" else "info|warn|good"
                     for n in _MACRO_UNION_ORDER if n not in ("grid", "pin"))
    return r"^>\s*(?:{0}|{1}|(?:{2})\b)".format(grid, pin, words)


def end_pattern(token: str = r"\w+") -> str:
    return r"^>\s*end\s*:\s*{0}\s*$".format(token)


def dispatch_pattern(name: str) -> str:
    """The legacy-renderer dispatch pattern for a construct (line-anchored)."""
    spec = REGISTRY[name]
    return "^" + (spec.dispatch or spec.opener)


def anchor_pattern(name: str) -> str:
    """The edit-op anchor (whitespace-tolerant policy, named groups)."""
    spec = REGISTRY[name]
    if spec.opener_parse and spec.opener_parse.startswith("(?P<head>"):
        return "^" + spec.opener_parse
    return r"^(?P<head>\s*{0})(?P<flags>.*)$".format(spec.opener)


def token_pattern(name: str, token: str) -> re.Pattern:
    spec = REGISTRY[name]
    for t in spec.head:
        if t.name == token:
            flags = re.IGNORECASE if "i" in t.flags else 0
            return re.compile("^" + t.pattern + "$", flags)
    raise KeyError((name, token))


def schema() -> dict:
    """The JSON projection served at ``GET /__rv__/schema``."""
    constructs = {}
    class_map: list[list] = []
    for spec in REGISTRY.values():
        fields = [
            {"name": t.name, "pattern": t.pattern, "flags": t.flags,
             "role": t.role, "label": t.label, "op": t.op,
             "coerce": t.coerce, "keywords": list(t.keywords)}
            for t in spec.head
        ]
        constructs[spec.name] = {
            "label": spec.label,
            "movable": spec.movable,
            "endToken": spec.end_token,
            "fragTarget": spec.frag_target,
            "captionSep": spec.caption_sep,
            "bgSep": spec.bg_sep,
            "fields": fields,
            "cheat": [list(c) for c in spec.cheat],
        }
        for cls in spec.css_classes:
            if spec.name == "box":
                label = {"box-info": "info box", "box-warn": "warn box",
                         "box-good": "good box"}.get(cls, spec.label)
            elif cls == "rv-cell":
                label = "card (plain)"
            elif cls == "rv-fig":
                label = "figure"
            else:
                label = spec.label
            class_map.append([cls, spec.name, label])
    return {
        "constructs": constructs,
        "classMap": class_map,
        "staticCheat": [list(c) for c in STATIC_CHEAT],
        "directives": {d.name: {"scopes": list(d.scopes), "onFill": d.on_fill}
                       for d in DIRECTIVES.values()},
    }
