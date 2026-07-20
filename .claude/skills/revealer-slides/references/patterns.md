# .pres patterns

Idiomatic building blocks for Revealer talks. Copy a pattern, swap the
asset names, adjust the text. One sentence says when to use each.

<!-- CONTRACT (enforced by tests/test_skill_patterns.py): every `pres`
     fence is extracted and built as a standalone deck against stub
     assets — each must build with ZERO "Warning:" lines. Illustrative
     examples that cannot build hermetically (build hooks, includes,
     PDF figures) use `text` fences instead.
     Assets a `pres` snippet may reference (exact paths):
       Media/figure.png  Media/photo.jpg  Media/logo.png  Media/base.png
       Media/overlay.png Media/movie.mp4  Media/diagram.svg  refs.bib
     (diagram.svg contains ids #box, #dot, #arrow) -->

## Minimal talk

The smallest complete deck: settings, generated title slide, one content
slide.

```pres
> title: My talk
> author: Ada Lovelace
> event: Seminar, 2026
> slideNumber: c/t

>>> first: My talk
> subtitle: A one-line pitch

=== The point

One idea per slide, stated plainly.

* Context
* + Result revealed on click
```

## Title slide with photos and logos

Add `> photo:` under an author to switch the title slide to a photo grid;
`> logo:` is repeatable.

```pres
> title: Collaboration talk
> author: Ada Lovelace
  > photo: Media/photo.jpg
> author: Charles Babbage
> affiliation: Analytical Engines Ltd
> logo: Media/logo.png
> event: London, 1843

>>> first: Collaboration talk
```

## Two columns: text next to a figure

`||` opens/closes the block, `|` starts the next column; widths are
optional flex-basis values.

```pres
=== Model vs data

|| 40%
> align: left
**Model.** Overdamped Langevin dynamics:

$$\dot x = -\mu \nabla U + \sqrt{2D}\,\xi(t)$$
| 55%
! Media/figure.png | Trajectories in the trap
||
```

## Figure-heavy canvas: fill + row/col

For exact geometry, `> fill` switches the slide to a full-height layout;
rows split into sized columns.

```pres
=== Experimental setup
> fill
> row
> col 2/5 center
Optical tweezers hold the bead at the focus.

! Media/figure.png contain
> col 3/5 center
!! Media/movie.mp4 loop | The experiment, 20× speed
> end: row
```

## Grid of cards

Cards with titles, fragment reveals and background colours; `compact`
would size the grid to its content instead of the slide.

```pres
=== Three contributions
> grid(1,3)
> gap: 24px

> card | Theory
A new fluctuation identity

> card + | Simulation
Validated across four orders of magnitude

> card +: #EFF4FF
And it holds out of equilibrium

> end: grid
```

## Stack: build a figure up in layers

Layers cross-fade as fragments; `clear` keeps a layer transparent
(see-through overlay), `h=` pins the height.

```pres
=== The mechanism, step by step
> fill
> stack h=520
> layer
! Media/base.png fill
> layer +
! Media/overlay.png fill
> layer + clear
! Media/diagram.svg fill contain
> end: stack
```

## Pin: absolute annotation over the slide

Center lands at x% y% of the slide body; optional width %; `+` reveals it
as a fragment.

```pres
=== Setup
> fill
! Media/figure.png contain

> pin: 72% 18% 18% +
[Anomaly here]{.accent}
> end: pin
```

## Callout boxes and framed equations

`> info` / `> warn` / `> good` boxes with optional titles; `> eq` frames
math with the theme accent (auto-wrapped in `$$` when it has no `$`).

```pres
=== Key result

> info Dataset
African elephant, Kruger National Park, 2019–2024
> end: info

> eq +
\langle x^2(t) \rangle = 2 D t
> end: eq

> good + Take-home
Diffusion is anomalous below the crossover scale
> end: good
```

## Fragment sequencing

`+` reveals in document order; `+N` sets an explicit index for
simultaneous or out-of-order reveals; `> frag` wraps arbitrary content.

```pres
=== Reveal sequence

* Always visible
* + First click
* +3 Later, out of order
* +2 Second click

> frag 2
This block appears together with the +2 bullet: $e^{i\pi} = -1$.
> end: frag
```

## Table

Cells are centered; `> row` starts a new row and its first cell; closing
`> end: table` is optional at the end of a slide but keep it explicit.

```pres
=== Parameter summary
> table(2,2)
> border: true

> cell
$D$ (µm²/s)

> cell: #f5f5f5
$1.2 \pm 0.1$

> row
$\tau$ (s)

> cell
$0.48 \pm 0.03$

> end: table
```

## Code and a highlighted takeaway

`@@` fences take a language and reveal.js attributes; `[ … ]` on its own
line is a highlighted block.

```pres
=== Implementation

@@ python data-line-numbers
def msd(x, lag):
    return ((x[lag:] - x[:-lag]) ** 2).mean()
@@

[ Ten lines of NumPy — no C extension needed. ]
```

## Talk structure: sections, verticals, backups

`%%%` makes a full-bleed divider (header removed); `---` hangs vertical
slides under the last `===` — perfect for backup slides.

```pres
>>> first: A structured talk

%%% Part I — Setup
> relief: none
> background: #0F4C75

=== Main argument

The talk's spine lives on `===` slides.

--- Backup: gory details
> style: dark

Press ↓ during questions to reach this.
```

## Citations and bibliography

Point settings at the BibTeX file once; cite per slide; `>>> biblio`
renders the paginated reference list.

```pres
> bibtex: refs.bib

=== Related work
> cite: smith2026

A key result was reported<ref:smith2026>.

>>> biblio
> title: References
```

## Speaker notes

Everything after `> notes:` is notes; the optional value sets their font
size for this slide.

```pres
=== Main result

The visible slide content.

> notes: 1.1em
Explain the intuition before showing the equation.
```

## SVG animation

Inline the SVG (`> svg:`), pre-hide elements by id, then animate
attributes step by step — each step is a fragment.

```pres
=== How the mechanism unfolds
> svg: Media/diagram.svg
> hide: #dot, #arrow
> animate: #box fill:#0F4C75
> animate: #dot, #arrow opacity:1 @ 1s
> animate: #dot transform:translate(2, 0) @ 300ms

Each arrow press advances one step; stepping back reverts it.
```

Hand-authoring the SVG itself:

- A comma list (`#dot, #arrow`) animates several elements in one step;
  a `<g id="…">` wrapper does the same job structurally.
- Arrowhead `<marker>`s scale with the stroke width by default
  (`markerUnits="strokeWidth"`) — a thick arrow gets a giant head. Set
  `markerUnits="userSpaceOnUse"` on the marker for a constant-size head.
- SVG `transform:scale(…)` is about the user-space origin, not the
  element. To scale something about its own centre, wrap it in
  `<g transform="translate(x,y)">` with its geometry drawn centred on
  `0,0`, and animate the inner element.

## KaTeX macros

Declare once in settings (or `> macros: defs.tex` for a file of
`\newcommand`s), use everywhere.

```pres
> macro: \half \frac{1}{2}
> macro: \R \mathbb{R}

=== Notation

Positions live in $\R^3$; kinetic energy is $\half m v^2$.
```

## Sizes and alignment

Alone (blank line after), a directive restyles the whole slide or column;
attached to a paragraph, just that paragraph. Sizes accept factors or the
role names `title` / `lede` / `body` / `sm` / `fine`.

```pres
=== Fine print
> size: lede
> align: left

This slide defaults to lede-sized, left-aligned text.

> size: 0.7
* This attached list is at 70%
* and so is this item
```

## Self-updating figures (illustrative — runs your scripts)

Reference a PDF figure and let a build hook regenerate it before every
compile; the theme-matched matplotlib style keeps plots on-palette. Not
build-tested here: `> build:` executes a shell command and `! fig.pdf`
needs `pdftocairo`.

```text
> build: python figs.py

=== Results
! Media/decay.pdf | MSD vs lag time
```

```text
# figs.py
import matplotlib.pyplot as plt
plt.style.use("reveal.js/dist/theme/revealer.mplstyle")
fig, ax = plt.subplots(figsize=(6, 4))
ax.plot(x, y, label="theory")
ax.legend()
fig.savefig("Media/decay.pdf")
```

## Lecture course from includes (illustrative — needs sibling files)

`> include:` splices another `.pres` at build time (recursive, deck-local
paths); serve the master and saving any part rebuilds.

```text
>>> first: Statistical Physics — full course

> include: lecture-01/lecture-01.pres
> include: lecture-02/lecture-02.pres
```
