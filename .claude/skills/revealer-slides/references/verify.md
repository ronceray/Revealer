# Build, warnings, and visual verification

## Build

    revealer build path/to/Name.pres     # writes Name.html next to the .pres

The build **never fails on a syntax mistake** — bad lines are dropped or
reinterpreted, and each one prints `Warning: line N: …` on the build
output. Zero warnings is the bar. The messages and their fixes:

| Warning | Fix |
| --- | --- |
| `unrecognized directive dropped: > …` | typo in a construct opener (e.g. `> grid(a,b)`) — check references/syntax.md |
| `> card belongs inside a > grid` (and similar hints) | construct child written outside its parent — add the parent or move the child |
| `stray '> end: name'` | it closes nothing — remove it or fix the opener it was meant to close |
| `'> info' is never closed and swallowed '> …'` | add the missing `> end: info` before the next construct |
| `bare '> space' fills only inside a '> fill' slide` | use `> space: 40px`, or make it a `> fill` slide |
| `media file not found: …` | wrong path/case — media paths are relative to the deck folder |
| `'> row 60px' sets the column gap, not the row height` | you meant a height: write `h=60`; if you really want that gap, write `gap=60px` |
| `column fractions add up to 7/6` | the `> col` fractions of one row exceed the row — fix the sizes (fractions are shares of the row) |
| `layers of this stack ask for different heights` | one `h=` per stack: put it on `> stack h=…` or on the first layer's media only |

A build aborts (rather than warning) only on hard failures: a
**failing `> build:` hook** (its output is shown — fix the script or
drop the hook), a non-UTF-8 `.pres` file, a missing `reveal.js/`
folder next to the `.pres` (run `revealer update <dir>`), or a PDF
figure when `pdftocairo` is missing or fails. Everything else is a
`Warning:` line.

## Layout check

`revealer check <Name.pres>` lays every slide out in headless Chrome and
reports what the parser cannot see. Run it after every build; zero
findings is the bar, exactly like build warnings.

| Finding | Fix |
| --- | --- |
| `… overflows its box by Npx` | the content does not fit its row/card/callout — shorten it, raise the row's `h=`, or split the slide |
| `content is Npx taller than its box even at full size` | past the auto-fit floor: split the slide (or, deliberately, raise `> fit-floor:`) |
| `… is painted Npx outside the slide` | a pin/overlay/element lands off the canvas — move it back inside |
| `… is cut off by the window edge` | a header/footer/logo band does not fit — reduce `> header-height:` / `> footer-height:`, or use fewer logos |
| `cover crops this media to N% of one axis` | `cover` is eating the figure — use `contain`, or crop the source file |
| `… renders nothing` | an empty column or card — remove the marker, or give it content |

Options: `--strict` (exit 2 if anything is reported), `--dead-space`
(also flag near-empty `> fill` slides), `--skip crop,empty` (silence a
kind you have decided about). `data-rv-check="ignore"` on a raw-HTML
element excludes it. Needs Chrome, like the PDF export; without it the
command says so rather than passing silently.

## Screenshots

    scripts/snap.sh Name.html <slide> out.png [--fragments]

- `<slide>` is the reveal.js index shown in the URL: `4`, or `4/2` for
  the 2nd vertical slide under horizontal slide 4. Slide 0 is the title.
- `--fragments` forces every fragment visible (what `revealer pdf`
  does); without it, un-revealed fragment content is invisible.
- `--fragments` is CSS-only: it does NOT run `> animate:` SVG steps
  (those are applied by JS on fragment state). To verify an
  animated-SVG slide, screenshot a real fragment state instead — pass
  `N/M/F` as the slide (fragment `F` of slide `N/M`), no `--fragments`:
  `snap.sh Name.html 4/0/6 out.png` shows slide 4 at its 6th step.
- Exit 3 = no Chrome/Chromium on PATH. Report "not visually verified"
  — do not guess.

What to look for in the shot:

- Text clipped or overflowing its box; a block shrunk unreadably small
  by the fit engine → split the slide or drop content.
- Broken-image icons → path or case mismatch (build also warned).
- Badly unbalanced columns → try `> column-width: auto` on the slide.
- A `> pin:` or `> stack` overlay landing in the wrong place → adjust
  the percentages / `h=`.
- Fragments that never appear (check with and without `--fragments`).
- Display math running off the right edge → `$$…$$` never shrinks;
  split the equation across lines.
- Literal `*` / `**` visible in rendered text → a bold span wrapping
  `$math$`; keep bold and math disjoint.
- Everything uniformly oversized on a sparse slide → the fit engine
  only shrinks, it never enlarges; set a presentation-wide `> size:`
  (e.g. `0.85`) or switch theme.

Iterate on the slides you changed; before declaring the talk done,
sweep every slide once.

## When the user is watching

`revealer serve` (or `revealer <file>.pres`) already rebuilds and
reloads their browser on each save, preserving the slide and fragment.
Tell them what to look at instead of screenshotting. Build errors show
as a browser overlay while the last good build keeps being served.

## PDF export

    revealer pdf <target>        # one page per slide, fragments shown
    revealer pdf <target> -o slides.pdf

`> pdfSeparateFragments: true` in the settings gives one page per
fragment state. Requires Chrome/Chromium and `img2pdf`.
