# Design: split-editor letterbox + thumbnail-grid overview

Two small, independent presentation features for Revealer.

## Feature 1 — Split-editor letterbox

**Goal.** In the editor's split view, scale the slide to fit its space preserving
aspect ratio, with gray filling the leftover space and a crisp edge, so it is
visually obvious what is on the slide and what is not.

**Problem today.** In split mode `body.rv-split .reveal` is a fixed rectangle;
reveal.js scales `.slides` to fit it preserving aspect ratio, but the leftover
"letterbox" area shows the same `.reveal-viewport` background (`#fff`) as the
slide, so the slide's bounds are invisible.

**Approach — aspect-fitted reveal box over a gray backdrop.** Instead of letting
the reveal viewport fill the whole rectangle and letterbox internally (which
would fight reveal's full-bleed per-slide backgrounds), make the reveal element
itself the largest correctly-proportioned box that fits, centered over gray:

- Scope: **editor only** (`split.js` + `editor.css`); nothing ships in exported
  decks.
- `editor.css` (`body.rv-split`): the split area is a mid-gray backdrop with
  enough contrast against a white slide so the bounds read clearly (start at
  `#c4c8d0`, tune with a screenshot during implementation). The `.reveal`
  element gets `aspect-ratio: var(--rv-deck-ar); max-width: 100%;
  max-height: 100%; margin: auto;` plus `box-shadow: 0 0 0 1px rgba(0,0,0,.15),
  0 10px 40px rgba(0,0,0,.25);` for the crisp bordered edge. Its explicit
  `width/height` overrides from the current split CSS are removed/neutralized so
  `aspect-ratio` + `max-*` drive the size.
- `split.js` `relayout()`: set `--rv-deck-ar` from `Reveal.getConfig().width /
  .height` (default 960/700) once on entering split, then call `Reveal.layout()`
  so reveal fits the slide to the aspect-correct box (uniform scale, no internal
  letterbox). fitSlide is called as today.

**Why this respects backgrounds.** reveal fills its whole viewport with the
slide (including per-slide/dark backgrounds); the gray is genuinely *outside*
the reveal box, so dark-background and `> background:` slides render correctly.

**Edge / non-goals.** Docked (non-split) edit mode is unchanged. Only CSS
`aspect-ratio` is relied on (universally supported).

## Feature 2 — Thumbnail-grid overview (compiled deck)

**Goal.** In presentation mode, replace reveal.js's single-row Esc overview
(which is "just a line" for horizontal-only decks) with a navigable grid of
slide thumbnails, working when serving **and** in exported standalone HTML.

**Scope — compiled runtime.** Implemented in the bundled `revealer.js` (plus one
line in `assets.py`'s `Reveal.initialize`), so every built deck has it. Must not
depend on the editor (`RV` namespace); it is deck runtime.

**Trigger — replace Esc.** `assets.py`: add `overview: false` to
`Reveal.initialize` so reveal no longer binds Esc/`o` to its row overview.
`revealer.js` binds **Esc** (and `o` as an alias) to toggle the grid. In the
dev editor, the editor's capture-phase Esc handler already owns Esc while in
edit mode (`S.on`) and stops propagation, so the grid only opens when NOT
editing — no conflict. The runtime handler also no-ops when
`document.documentElement.classList.contains('rv-edit')` and edit mode is on, as
a belt-and-suspenders guard.

**Thumbnails — live scaled clones.** For each slide (`.slides > section`,
flattened so vertical sub-slides are individual addressable cells), clone its
rendered content into a cell that is an aspect-correct box (deck W:H) containing
the clone at logical size (`width:960px;height:700px`) transformed by
`transform: scale(cellW/960)`. No server round-trip; math/images render as
authored. Density: **medium**, CSS grid `repeat(auto-fill, minmax(~22vw, 1fr))`
→ ~4–5 columns on a laptop.

**Layout & interaction.**
- Full-screen overlay (`#rv-grid`), high z-index, deck-neutral dark scrim.
- Cells in document order; each labelled with its slide number (and title if
  present). Vertical sub-slides get a subtle left accent so stacks read as
  groups. Current slide highlighted.
- **Click** a cell → `Reveal.slide(h, v)` then close. Keyboard: **Esc**/`o`
  toggles closed, **arrows** move a selection highlight, **Enter** navigates to
  the selected cell, focus is trapped while open.
- Rendered on open, torn down on close (fine for typical 10–50-slide decks; no
  lazy rendering in v1 — `log`/note if a deck is very large is unnecessary).

**Non-goals (v1).** No image snapshots (would need Chrome), no live thumbnail
updates while open, no drag-reorder (that is the editor's outline sidebar).

## Testing

- **Letterbox:** headless-Chrome screenshot of the served deck at
  `?rv-edit=1&rv-split=1`; assert gray margins around a bordered slide box
  (sample pixels: corners gray, center slide-colored) and that the reveal box's
  measured aspect ratio ≈ deck W:H.
- **Grid:** the runtime isn't the editor, so drive a **built-deck iframe** in
  the JS harness (`suite-grid.js`): load a deck, dispatch Esc, assert `#rv-grid`
  appears with one cell per slide, click a non-current cell, assert
  `Reveal.getIndices()` moved and the grid closed. Plus a Python test that a
  prod build's `Reveal.initialize` contains `overview: false` and revealer.js
  ships the grid code.

## Files

- Feature 1: `src/revealer/data/js/editor/split.js`,
  `src/revealer/data/js/editor.css`.
- Feature 2: `src/revealer/data/js/revealer.js`, `src/revealer/assets.py`
  (config line). Grid CSS is injected as an inline `<style>` by revealer.js on
  first open, keeping the feature self-contained in one file.
- Tests: `src/revealer/data/js/test/suite-grid.js`, `tests/test_editor_js.py`
  (fixture already multi-slide), a Python assertion in `tests/`.
- Docs: a short note in `Documentation/editor.md` (letterbox) and the deck
  keyboard reference (Esc = grid).
