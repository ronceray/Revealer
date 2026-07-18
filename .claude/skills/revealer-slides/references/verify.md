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

A build aborts (rather than warning) only on hard failures: a
**failing `> build:` hook** (its output is shown — fix the script or
drop the hook), a non-UTF-8 `.pres` file, a missing `reveal.js/`
folder next to the `.pres` (run `revealer update <dir>`), or a PDF
figure when `pdftocairo` is missing or fails. Everything else is a
`Warning:` line.

## Screenshots

    scripts/snap.sh Name.html <slide> out.png [--fragments]

- `<slide>` is the reveal.js index shown in the URL: `4`, or `4/2` for
  the 2nd vertical slide under horizontal slide 4. Slide 0 is the title.
- `--fragments` forces every fragment visible (what `revealer pdf`
  does); without it, un-revealed fragment content is invisible.
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
