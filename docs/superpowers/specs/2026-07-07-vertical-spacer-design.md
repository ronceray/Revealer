# Design: vertical spacer directive (`> space`)

## Problem

On `> fill` slides (the flex-column layout used for grids), consecutive
layout blocks — notably two `> grid(…)` blocks — render as adjacent flex
siblings with no vertical gap, and there is no way to add deliberate vertical
whitespace.

## Design

A single-line directive `> space` that emits a spacer element in the layout
flow:

- **`> space`** — *filling* spacer: `flex: 1 1 0` — absorbs the available
  vertical space, so it pushes neighbours apart, centres a block, or pins one
  to the bottom of a `> fill` slide.
- **`> space: <size>`** — *fixed* spacer of that height (`40px`, `2em`, `10%`,
  …): `flex: 0 0 <size>; height: <size>`.

Emitted as `<div class="rv-space" …>` with the inline flex/height style; carries
`data-rv-src` provenance like other constructs. Filling only has an effect
inside a flex column (a `> fill` slide or a `> row`/`> col`); on an ordinary
slide a fixed `> space: 40px` still inserts a real vertical gap, while bare
`> space` degrades to no gap (documented — it needs a fill context).

Default grid-to-grid spacing is left at zero (changing it could shift existing
decks); the spacer gives explicit control.

## Implementation

- **build loop** (`_build`): keep `> space` / `> space: <size>` lines in the
  slide content stream (like the layout macros) instead of capturing them as a
  `space` slide parameter.
- **`_contentify_legacy`**: a line matching `^>\s*space\s*(?::\s*(.*?)\s*)?$`
  emits the spacer div (fixed when a value is given, filling otherwise), with
  `_escape_style_value` on the size and `_src_attr` provenance.
- **grammar / cheatsheet / docs**: add `> space` to the editor cheatsheet and
  the authoring/reference docs.

## Testing

- build tests: `> space` → `flex:1 1 0`; `> space: 30px` → `flex:0 0 30px;
  height:30px`; two grids separated by `> space: 30px` on a fill slide render
  the spacer between them; the size value is escaped.
- prod HTML has no dev provenance (existing invariant); goldens unaffected
  (new construct only appears in decks that use it).
