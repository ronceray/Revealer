---
name: revealer-slides
description: Author and edit Revealer .pres presentations. Use when the user asks for slides, a talk, a deck, a presentation, or mentions .pres/Revealer — creating a deck, writing or restyling slides, fixing layout, building or exporting to PDF.
---

# Revealer slide authoring

Revealer compiles a plain-text `.pres` file into a reveal.js
presentation. This skill is for **writing talks**. It is not about
developing Revealer itself (grammar, editor, runtime) — that work happens
in the Revealer repo against its own docs.

## The loop

1. **Locate or scaffold.**
   - Existing talk: find the `.pres` (a deck is a folder holding
     `<Name>.pres`, `Media/`, and a `reveal.js/` engine).
   - New talk: write `<Name>/<Name>.pres` yourself from the "Minimal
     talk" pattern (references/patterns.md), then run
     `revealer update <Name>` once to download the reveal.js engine.
     (`revealer new` scaffolds too, but prompts interactively — only
     suggest it to the user, never run it yourself.)
2. **Author.** Golden rules below. Media files live in `Media/` inside
   the deck folder; every path is relative to the deck folder. Before
   writing a construct you are not sure of, open references/syntax.md.
3. **Build.** `revealer build <path/to/Name.pres>` → `<Name>.html` next
   to it. The build never fails on syntax — it prints
   `Warning: line N: …` for anything it had to drop or reinterpret.
   **Zero warnings is the bar**; references/verify.md decodes them.
4. **Verify visually.** Screenshot every slide you changed:
   `scripts/snap.sh <Name>.html <slide> shot.png --fragments`
   then READ the image: clipped text, broken-image icons, unbalanced
   columns, overlays landing wrong. Sweep the whole deck once before
   declaring the talk done. Exit 3 means no Chrome — say you could not
   verify visually; never claim slides look right unseen.
5. **Export** on request: `revealer pdf <target>` (one page per slide,
   fragments shown; `> pdfSeparateFragments: true` for one page per
   step).

If the user has `revealer serve` running (or opened the deck with plain
`revealer <file>.pres`), their browser already rebuilds and reloads on
every save, keeping the current slide — point them at the slide instead
of screenshotting.

## Golden rules

- Settings are `> key: value` lines **before** the first slide; content
  after. `#` starts a comment. Raw HTML passes through anywhere.
- Slides: `=== Title` (horizontal) · `--- Title` (vertical, under the
  last `===`) · `%%% Title` (section divider) · `>>> first: Title`
  (generated title slide) · `>>> biblio` (bibliography).
- Block constructs open with `> name …` and close with `> end: name`:
  `row`, `grid(r,c)`, `table(r,c)`, `stack`, `pin:`, `info`/`warn`/
  `good`, `eq`, `frag`. Their sub-items (`> col`, `> card`, `> layer`,
  `> cell`) run to the next marker — never write a sub-item outside its
  parent.
- Text columns: `||` opens/closes the block, `|` starts the next column.
  Layout canvas: `> fill`, then `> row` / `> col 2/5 center`;
  `> space: 40px` for fixed gaps (bare `> space` only inside `> fill`).
- Bullets: `* text`, nested by two spaces. Fragments: trailing `+` or
  `+N` on bullets (`* + text`), media, `> col`, `> card`, `> layer`,
  `> pin:`, boxes, `> eq`.
- Media: `! Media/f.png [flags] [| caption]` (image) · `!! Media/m.mp4`
  (video). Flags: `fill` `contain` `cover` `top`, `h=…`/`w=…`, `loop`
  `autoplay` `controls`. The file must exist — a missing path is a
  build warning.
- Math: `$inline$`, `$$display$$`; `> eq` for a framed equation
  (auto-wrapped in `$$` when it contains no `$`). Keep a `$$…$$` line
  narrow — an over-wide equation clips at the right edge instead of
  shrinking; split it across lines. Code: `@@ lang` … `@@`.
  Highlight: `[ text ]` alone on a line.
- Inline: `**bold**` `*italic*` `` `code` `` `[text](url)`
  `[text]{.accent}` `[text]{color=#c0392b}`; escape markers with `\`.
  A `**bold**` span cannot contain `$math$` (the asterisks render
  literally) — keep bold and math disjoint.
- One idea per slide. Let the fit engine shrink content — if a shot
  shows tiny text, split the slide instead of fighting sizes. The fit
  engine only shrinks, never enlarges: sparse slides render at the
  theme's (large) base size, so if everything feels oversized set a
  presentation-wide `> size:` (e.g. `0.85`) or pick another theme.
- Prefer constructs over raw HTML; prefer editing the smallest region
  of the `.pres` you can.

## When unsure

| Need | Open |
| --- | --- |
| Exact parameters/forms of any construct, all settings | references/syntax.md — generated from the grammar, authoritative |
| How to compose a slide (columns, grids, stacks, pins, citations, SVG animation, macros…) | references/patterns.md — copy-paste snippets, all build-verified |
| A `Warning:` line, visual checks, screenshots, PDF export | references/verify.md |

If `revealer` is not on PATH: install with
`pipx install .` from a clone of https://github.com/ronceray/Revealer.
