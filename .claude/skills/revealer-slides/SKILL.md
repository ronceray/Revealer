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
4. **Check the layout.** `revealer check <path/to/Name.pres>` renders
   every slide and reports what the build cannot see: content
   overflowing its box, painted off the slide, or cropped through a
   figure. Same `Warning:` format, same bar — **zero findings**.
   `revealer build --check` does both steps at once.
5. **Verify visually.** Screenshot every slide you changed:
   `scripts/snap.sh <Name>.html <slide> shot.png --fragments`
   (`revealer index <Name>.pres` lists every slide with its reveal
   index — `7`, `8/1` — so you never have to count `===` lines)
   then READ the image: clipped text, broken-image icons, unbalanced
   columns, overlays landing wrong. Sweep the whole deck once before
   declaring the talk done. Exit 3 means no Chrome — say you could not
   verify visually; never claim slides look right unseen.
6. **Export** on request: `revealer pdf <target>` (one page per slide,
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
- One idea per slide. The fit engine absorbs only a *small* overflow
  (down to `fit-floor`, 0.85 by default) so body text stays the same
  size on every slide; past that the content overflows at full size
  (visible in the screenshot; the block is flagged `data-rv-overflow`)
  — split the slide, never fight sizes. The
  engine never enlarges: sparse slides render at the theme's (large)
  base size, so if everything feels oversized set a presentation-wide
  `> size:` (e.g. `0.85`) or pick another theme.
- Prefer editing the smallest region of the `.pres` you can.

## Raw HTML is the last resort

Raw HTML passes through, and that is exactly the problem: it is
invisible to the editor's structural tools (cannot be selected,
reordered, fragmented or restyled), it bypasses the theme, and it
turns a readable `.pres` into a page of `<div style=…>`. So:

1. **Before writing any raw-HTML block, name the construct you
   considered and why it cannot do the job.** If you cannot name a
   concrete reason, use the construct.
2. **Raw HTML is only for a documented gap.** Known gaps: none of the
   constructs crops or zooms media (planned as `zoom=` / `crop=` flags
   on `!`). Anything else is a construct.
3. **Confirm with the user first** when you are about to introduce raw
   HTML that is not one of those gaps — say what you wanted, which
   construct you tried, and what it lacked. The user may prefer the
   construct's rendering, or a change to Revealer itself.

The construct for the situation you are tempted to hand-code:

| Tempted to write | Use instead |
| --- | --- |
| a flex row of `<div>`s | `> row` / `> col 2/5` … `> end: row` (fractions are shares of the row) |
| a strip of portraits / logos / credits | `> grid(1,N)` of `> card plain` with `! photo.png h=120px \| Name` |
| a labelled card / callout / highlighted box | `> card \| Title`, `> info` / `> warn` / `> good Title` |
| a framed equation with a label | `> eq` … `> end: eq` (label as a caption paragraph) |
| chip / tag rows inside a callout | a one-line list of `[chip]{.accent}` spans (theme-styled), or `> grid(1,N)` |
| overlaid images that swap on click | `> stack` / `> layer +` … `> end: stack` |
| an absolutely positioned overlay | `> pin: x% y% w%` … `> end: pin` |
| a `<table>` | `> table(r,c)` … `> end: table` |
| vertical whitespace | `> space: 40px` (fixed) or `> space` (filling, on a `> fill` slide) |
| `<span style="font-size:…">` | `[text]{.sm}` / `{.lede}` / `{.title}` / `> size:` |
| `<span style="color:…">` | `[text]{.accent}` / `{.warn}` / `{.good}` / `[text]{color=#c0392b}` |
| an inline `<style>` to nudge one element | a per-slide `> size:` / `> align:`, or ask the user for a theme change |

## When unsure

| Need | Open |
| --- | --- |
| Exact parameters/forms of any construct, all settings | references/syntax.md — generated from the grammar, authoritative |
| How to compose a slide (columns, grids, stacks, pins, citations, SVG animation, macros…) | references/patterns.md — copy-paste snippets, all build-verified |
| A `Warning:` line, visual checks, screenshots, PDF export | references/verify.md |
| Choosing a theme | the gallery: https://ronceray.github.io/Revealer/themes.html (in the Revealer repo: `revealer Demo/Themes.pres`) |

If `revealer` is not on PATH: install with
`pipx install .` from a clone of https://github.com/ronceray/Revealer.
