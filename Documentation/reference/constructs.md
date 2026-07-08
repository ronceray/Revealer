<!-- GENERATED FILE — DO NOT EDIT.
     Source of truth: src/revealer/grammar.py
     Regenerate with:  python3 Documentation/gen_reference.py
     (also runs automatically at every Sphinx build via conf.py) -->

# Constructs

Every block construct of the `.pres` language, generated from the
grammar registry (`src/revealer/grammar.py`) — the same table that
drives the parser, the editor's semantic edits and its side panel.
For prose and examples see the [authoring guide](../authoring.md).

## Quick syntax card

The cheatsheet built into the browser editor, generated from the
same registry:

**Slides**

```text
=== title
--- sub-slide
%%% section
>>> first:
>>> biblio
```

**Layout**

```text
> fill
> space
> row
> col
|| columns
```

**Text & math**

```text
* bullet
[ highlight ]
$inline$
$$display$$
@@ code
```

**Fragments**

```text
* +
* +N
> frag
```

**Inline format**

```text
**bold**
*italic*
`code`
[link](url)
[x]{.accent}
[x]{color}
{.title/.lede/.sm/.fine}
> size:
> align:
escape \* \` \[
```

**Components**

```text
> table(2,3)
> grid(2,2)
> pin
> info
> warn / good
> eq
> stack
```

**Media**

```text
! image
!! movie
```

## Construct index

| construct | opens with | closed by | movable |
| --- | --- | --- | --- |
| [table](#construct-table) | `> table(rows, cols)` | `> end: table` | yes |
| [grid](#construct-grid) | `> grid(rows, cols) [compact]` | `> end: grid` | yes |
| [pin](#construct-pin) | `> pin: …` | `> end: pin` | yes |
| [row](#construct-row) | `> row` | `> end: row` | yes |
| [callout](#construct-box) | `> info` | `> end: info` / `> end: warn` / `> end: good` | yes |
| [equation](#construct-eq) | `> eq` | `> end: eq` | yes |
| [stack](#construct-stack) | `> stack` | `> end: stack` | yes |
| [fragment](#construct-frag) | `> frag` | `> end: frag` | yes |
| [media](#construct-media) | `! path` | nothing — a single-line construct | yes |
| [column](#construct-col) | `> col` | the next sibling marker or the parent's `> end:` | no |
| [card](#construct-card) | `> card` | the next sibling marker or the parent's `> end:` | no |
| [layer](#construct-layer) | `> layer` | the next sibling marker or the parent's `> end:` | no |
| [table cell](#construct-cell) | `> cell` | the next sibling marker or the parent's `> end:` | no |
| [text column](#construct-sep) | `||` | nothing — a single-line construct | no |
| [code block](#construct-code) | `@@ [language / attributes]` | a second `@@` line | no |

(construct-table)=

## table

```text
> table(rows, cols)
```

| | |
| --- | --- |
| Closed by | `> end: table` |
| Sub-items | `> cell` (the first one is implicit — content before the first marker belongs to it) |
| Movable | yes — the editor can reorder, drag and delete it |
| Body | cells — split by the sub-item markers |
| CSS classes | `.rv-table-wrap` |

Examples:

```text
> table(2,3)
```

Opener pattern (the exact regex the parser and editor share):

```text
>\s*table\(\s*\d+\s*,\s*\d+\s*\)\s*$
```

(construct-grid)=

## grid

```text
> grid(rows, cols) [compact]
```

| | |
| --- | --- |
| Closed by | `> end: grid` |
| Sub-items | `> card` (the first one is implicit — content before the first marker belongs to it) |
| Movable | yes — the editor can reorder, drag and delete it |
| Body | cells — split by the sub-item markers |
| CSS classes | `.rv-grid-wrap` |

Parameters (whitespace-separated head tokens after the opener, unless noted):

| token | accepted form | meaning | editor op |
| --- | --- | --- | --- |
| `gap` | `gap` | gap between cards — written on its own `> gap:` line inside the grid | `set_grid_gap` |

Examples:

```text
> grid(2,2)
> card
A
> card
B
> end: grid
```

Opener pattern (the exact regex the parser and editor share):

```text
>\s*grid\(\s*\d+\s*,\s*\d+\s*\)
```

(construct-pin)=

## pin

```text
> pin: …  [+ or +N]
```

| | |
| --- | --- |
| Closed by | `> end: pin` |
| Movable | yes — the editor can reorder, drag and delete it |
| Body | regular slide content (all shortcuts available) |
| CSS classes | `.rv-pin` |

Parameters (whitespace-separated head tokens after the opener, unless noted):

| token | accepted form | meaning | editor op |
| --- | --- | --- | --- |
| `fragment #` | `+ or +N` | reveal as a fragment (`+N` sets `data-fragment-index`) | `set_fragment_index` |

Examples:

```text
> pin: 50% 50% 20%

> end: pin
```

Opener pattern (the exact regex the parser and editor share):

```text
>\s*pin\s*:
```

(construct-row)=

## row

```text
> row  [+ or +N]  [h=N]  [gap]
```

| | |
| --- | --- |
| Closed by | `> end: row` |
| Nesting | self-nesting — a same-kind opener increases the depth |
| Sub-items | `> col` (the first one is implicit — content before the first marker belongs to it) |
| Movable | yes — the editor can reorder, drag and delete it |
| Body | regular slide content (all shortcuts available) |
| CSS classes | `.row` |

Parameters (whitespace-separated head tokens after the opener, unless noted):

| token | accepted form | meaning | editor op |
| --- | --- | --- | --- |
| `fragment #` | `+ or +N` | reveal as a fragment (`+N` sets `data-fragment-index`) | `set_fragment_index` |
| `height px` | `h=N` | pinned height in px | `set_row_height` |
| `gap` | `gap` | gap between items (any CSS length) | `set_row_gap` |

Examples:

```text
> row h=400
> col

> end: row
```

Opener pattern (the exact regex the parser and editor share):

```text
>\s*row\b
```

(construct-box)=

## callout

```text
> info  /  > warn  /  > good  [+ or +N]
```

| | |
| --- | --- |
| Closed by | `> end: info` / `> end: warn` / `> end: good` (each variant closes with its own name) |
| Movable | yes — the editor can reorder, drag and delete it |
| Body | regular slide content (all shortcuts available) |
| CSS classes | `.box-info` `.box-warn` `.box-good` |

Parameters (whitespace-separated head tokens after the opener, unless noted):

| token | accepted form | meaning | editor op |
| --- | --- | --- | --- |
| `fragment #` | `+ or +N` | reveal as a fragment (`+N` sets `data-fragment-index`) | `set_fragment_index` |

Examples:

```text
> info Title

> end: info
> warn Title

> end: warn
```

Opener pattern (the exact regex the parser and editor share):

```text
>\s*(?:info|warn|good)\b
```

(construct-eq)=

## equation

```text
> eq  [+ or +N]
```

| | |
| --- | --- |
| Closed by | `> end: eq` |
| Movable | yes — the editor can reorder, drag and delete it |
| Body | LaTeX math (wrapped in `$$ … $$` when it contains no `$`) |
| CSS classes | `.math-box` |

Parameters (whitespace-separated head tokens after the opener, unless noted):

| token | accepted form | meaning | editor op |
| --- | --- | --- | --- |
| `fragment #` | `+ or +N` | reveal as a fragment (`+N` sets `data-fragment-index`) | `set_fragment_index` |

Examples:

```text
> eq

> end: eq
```

Opener pattern (the exact regex the parser and editor share):

```text
>\s*eq\b
```

(construct-stack)=

## stack

```text
> stack  [h=N]
```

| | |
| --- | --- |
| Closed by | `> end: stack` |
| Sub-items | `> layer` (the first one is implicit — content before the first marker belongs to it) |
| Movable | yes — the editor can reorder, drag and delete it |
| Body | regular slide content (all shortcuts available) |
| CSS classes | `.rv-stack` |

Parameters (whitespace-separated head tokens after the opener, unless noted):

| token | accepted form | meaning | editor op |
| --- | --- | --- | --- |
| `height px` | `h=N` | pinned height in px | `set_stack_height` |

Examples:

```text
> stack h=300
> layer

> end: stack
```

Opener pattern (the exact regex the parser and editor share):

```text
>\s*stack\b
```

(construct-frag)=

## fragment

```text
> frag
```

| | |
| --- | --- |
| Closed by | `> end: frag` |
| Nesting | self-nesting — a same-kind opener increases the depth |
| Movable | yes — the editor can reorder, drag and delete it |
| Body | regular slide content (all shortcuts available) |
| CSS classes | `.fragment` |

Examples:

```text
> frag

> end: frag
```

Opener pattern (the exact regex the parser and editor share):

```text
>\s*frag\b
```

(construct-media)=

## media

```text
! path  (image)   or   !! path  (video)  [+ or +N]  [h=… or w=…]  [fill | contain | cover | top | loop | autoplay | controls]  [| caption]
```

| | |
| --- | --- |
| Closed by | nothing — a single-line construct |
| Movable | yes — the editor can reorder, drag and delete it |
| Fragment flag | accepts a trailing `+` / `+N` |
| Body | regular slide content (all shortcuts available) |
| CSS classes | `.rv-fig` `.rv-media` `.rv-media-fill` |

Parameters (whitespace-separated head tokens after the opener, unless noted):

| token | accepted form | meaning | editor op |
| --- | --- | --- | --- |
| `fragment #` | `+ or +N` | reveal as a fragment (`+N` sets `data-fragment-index`) | `set_fragment_index` |
| `size` | `h=… or w=…` | fixed height / width (px, em, rem, vh, vw, %) | `set_media_size` |
| `keywords` | `fill | contain | cover | top | loop | autoplay | controls` | flags: `fill`, `contain`, `cover`, `top`, `loop`, `autoplay`, `controls` | — |

Examples:

```text
! image.png fill | Caption
!! movie.mp4 loop
```

Opener pattern (the exact regex the parser and editor share):

```text
!{1,2}\s+
```

(construct-col)=

## column

```text
> col  [+ or +N]  [size (2/5, 40%, 300px)]  [center | relative | clip]
```

| | |
| --- | --- |
| Closed by | the next sibling marker or the parent's `> end:` |
| Movable | no |
| Fragment flag | accepts a trailing `+` / `+N` |
| Body | regular slide content (all shortcuts available) |
| CSS classes | `.region` |

Parameters (whitespace-separated head tokens after the opener, unless noted):

| token | accepted form | meaning | editor op |
| --- | --- | --- | --- |
| `fragment #` | `+ or +N` | reveal as a fragment (`+N` sets `data-fragment-index`) | `set_fragment_index` |
| `size (2/5, 40%, 300px)` | `size (2/5, 40%, 300px)` | size (fraction, %, length or bare flex weight) | `set_col_size` |
| `keywords` | `center | relative | clip` | flags: `center`, `relative`, `clip` | — |

Examples:

```text
> col 2/5 center
```

Opener pattern (the exact regex the parser and editor share):

```text
>\s*col\b
```

(construct-card)=

## card

```text
> card  [+ or +N]  [plain]  [: background]  [| caption]
```

| | |
| --- | --- |
| Closed by | the next sibling marker or the parent's `> end:` |
| Movable | no |
| Fragment flag | accepts a trailing `+` / `+N` |
| Body | regular slide content (all shortcuts available) |
| CSS classes | `.rv-card` `.rv-cell` |

Parameters (whitespace-separated head tokens after the opener, unless noted):

| token | accepted form | meaning | editor op |
| --- | --- | --- | --- |
| `fragment #` | `+ or +N` | reveal as a fragment (`+N` sets `data-fragment-index`) | `set_fragment_index` |
| `keywords` | `plain` | flags: `plain` | — |

Opener pattern (the exact regex the parser and editor share):

```text
>\s*card\b
```

(construct-layer)=

## layer

```text
> layer  [+ or +N]  [clear]
```

| | |
| --- | --- |
| Closed by | the next sibling marker or the parent's `> end:` |
| Movable | no |
| Fragment flag | accepts a trailing `+` / `+N` |
| Body | regular slide content (all shortcuts available) |
| CSS classes | `.rv-layer` |

Parameters (whitespace-separated head tokens after the opener, unless noted):

| token | accepted form | meaning | editor op |
| --- | --- | --- | --- |
| `fragment #` | `+ or +N` | reveal as a fragment (`+N` sets `data-fragment-index`) | `set_fragment_index` |
| `keywords` | `clear` | flags: `clear` | — |

Opener pattern (the exact regex the parser and editor share):

```text
>\s*layer\b
```

(construct-cell)=

## table cell

```text
> cell  [: background]
```

| | |
| --- | --- |
| Closed by | the next sibling marker or the parent's `> end:` |
| Movable | no |
| Body | regular slide content (all shortcuts available) |
| CSS classes | `.rv-table-cell` |

Opener pattern (the exact regex the parser and editor share):

```text
>\s*cell\b
```

(construct-sep)=

## text column

```text
||  (open / close a column block)   |  (next column)  [width]
```

| | |
| --- | --- |
| Closed by | nothing — a single-line construct |
| Movable | no |
| Body | regular slide content (all shortcuts available) |
| CSS classes | `.column` |

Parameters (whitespace-separated head tokens after the opener, unless noted):

| token | accepted form | meaning | editor op |
| --- | --- | --- | --- |
| `width` | `width` | size (fraction, %, length or bare flex weight) | `set_block_width` |

Examples:

```text
|| 50%

| 50%

||
```

Opener pattern (the exact regex the parser and editor share):

```text
\|{1,2}
```

(construct-code)=

## code block

```text
@@ [language / attributes]
```

| | |
| --- | --- |
| Closed by | a second `@@` line |
| Movable | no |
| Body | verbatim — content is not parsed |

Examples:

```text
@@ python

@@
```

Opener pattern (the exact regex the parser and editor share):

```text
@@
```
