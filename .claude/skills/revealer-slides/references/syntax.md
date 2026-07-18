<!-- GENERATED FILE — DO NOT EDIT.
     Source of truth: src/revealer/grammar.py
     Regenerate with:  python3 Documentation/gen_reference.py
     (also runs automatically at every Sphinx build via conf.py) -->

# .pres syntax reference

The complete `.pres` language, generated from the grammar registry
(`src/revealer/grammar.py`) — authoritative for every construct and
parameter. The settings tables at the end are inlined from
`Documentation/reference/settings.md`. Relative links refer to the
Revealer documentation, not to files of this skill.

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
escape \* \` \[
```

**Sizes & alignment**

```text
> size: 80%
> size: lede
> align:
> paragraph-spacing:
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
| table | `> table(rows, cols)` | `> end: table` | yes |
| grid | `> grid(rows, cols) [compact]` | `> end: grid` | yes |
| pin | `> pin: …` | `> end: pin` | yes |
| row | `> row` | `> end: row` | yes |
| callout | `> info` | `> end: info` / `> end: warn` / `> end: good` | yes |
| equation | `> eq` | `> end: eq` | yes |
| stack | `> stack` | `> end: stack` | yes |
| fragment | `> frag` | `> end: frag` | yes |
| media | `! path` | nothing — a single-line construct | yes |
| column | `> col` | the next sibling marker or the parent's `> end:` | no |
| card | `> card` | the next sibling marker or the parent's `> end:` | no |
| layer | `> layer` | the next sibling marker or the parent's `> end:` | no |
| table cell | `> cell` | the next sibling marker or the parent's `> end:` | no |
| text column | `||` | nothing — a single-line construct | no |
| code block | `@@ [language / attributes]` | a second `@@` line | no |

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

## Contextual directives

These directives take their scope from where they are written:
attached to a paragraph they style that paragraph; alone at the top
of a slide or column they set that scope's default; in the settings
block they set the presentation default.

| directive | aliases | scopes | consumed on `> fill` slides |
| --- | --- | --- | --- |
| `> size:` | — | slide, block, paragraph | yes |
| `> align:` | — | slide, block, paragraph | yes |
| `> paragraph-spacing:` | `paragraph_spacing` | slide, block, paragraph | yes |

# Settings & per-slide directives

Every `> key: value` parameter, by scope. Presentation settings go in the
**settings block**, before the first slide; per-slide directives go right
after a slide marker. Contextual directives (`size`, `align`,
`paragraph-spacing`) are in [their own generated page](directives.md); the
options that belong to a block construct (`> gap:` in a grid, `> margin:` /
`> border:` in a table, …) are in [Constructs](constructs.md).

## Presentation settings

### Title slide and identity

| Setting | Description |
| --- | --- |
| `> title:` *text* | **Browser-tab title** of the generated HTML. Default: `Revealer`. |
| `> author:` *name* | **Author name** on the title slide. Repeatable. May contain inline HTML. Add an indented `> photo:` line below an author to show a photo grid — see [Author photos](../authoring.md#author-photos). |
| `> affiliation:` *text* | **Affiliation line** on the title slide (rendered between authors and event). Repeatable. |
| `> photo:` *path* | **Author photo**, nested with an author line (either order). |
| `> rounded_photos:` `true`\|`false` | **Round author photos** on the title slide. Default: `false` (square). |
| `> event:` *text* | **Event** — typically the location and date. |
| `> logo:` *path* | **Institutional logo** on the first slide / header strip. Repeatable. |

### Look

| Setting | Description |
| --- | --- |
| `> theme:` *name* | **Theme.** `revealer` (default), `ljp`, or any [reveal.js theme](https://revealjs.com/themes/). See [Themes](../themes.md). |
| `> codeTheme:` *name* | **Code highlighting theme** ([highlight.js demo](https://highlightjs.org/static/demo/)). Default: `zenburn`. |
| `> header-height:` / `> footer-height:` *fraction* | **Header / footer band heights**, as a fraction of the slide height. |
| `> size:` / `> align:` / `> paragraph-spacing:` | Presentation-wide text defaults — see [Contextual directives](directives.md). |

### Behaviour and reveal.js passthrough

| Setting | Description |
| --- | --- |
| `> slideNumber:` *option* | **Slide numbers.** Disabled by default. Any [reveal.js value](https://revealjs.com/slide-numbers/) (e.g. `c/t`). |
| `> controls:` `true`\|`false` | **Navigation controls.** Defaults to the reveal.js built-in value. |
| `> progress:` `true`\|`false` | **Progress bar.** Alias `progressbar` is accepted for backwards compatibility. |
| `> backgroundTransition:` *transition* | **Background transition.** `false` is accepted as an alias for `none`. |
| `> width:` / `> height:` / `> margin:` | **Canvas size and fit margin** (reveal.js options), e.g. `1920` / `1080` / `0.02`. |
| `> markdown: false` | **Disable inline markdown** ([bold/italic/spans](../authoring.md#inline-formatting)) for the whole deck. |
| any other `> option: value` | Passed straight to `Reveal.initialize()`. Booleans and numbers are recognised; strings are quoted; lists become arrays. |

### Math

| Setting | Description |
| --- | --- |
| `> macros:` *file.tex* | **KaTeX macros from a file** of `\newcommand` definitions, relative to the deck folder. Repeatable. |
| `> macro:` *\name definition* | **Inline KaTeX macro.** Repeatable. |
| `> katex:` `{ ... }` | **Extra KaTeX options**, merged with the bundled-KaTeX config and the macros (never replacing them). |

See [Authoring › KaTeX macros](../authoring.md#katex-macros).

### Build pipeline and export

| Setting | Description |
| --- | --- |
| `> build:` *command* | **Build hook**: a shell command run from the deck folder before every compile (and on every save under `revealer serve`). Repeatable; 300 s timeout; a failing hook aborts the build with its output shown. See [Figures pipeline](../figures.md). |
| `> bibtex:` *path* | **BibTeX file** for citations and the bibliography. See [Bibliography](../bibliography.md). |
| `> maxRefsPerPage:` *n* | **References per bibliography slide.** Default: 5. |
| `> notesSize:` *size* | **Speaker-notes font size.** Default: `1em`. Overridable per slide with `> notes:`. |
| `> svgDuration:` *time* | **Default SVG animation step duration.** Default: `0.5s`. See [SVG animation](../svg.md). |
| `> pdfSeparateFragments:` `true`\|`false` | **PDF export granularity**: `true` = one page per fragment state; default `false` = one fully-revealed page per slide. See [`revealer pdf`](cli.md#revealer-pdf-target). |

## Per-slide directives

Written right after a slide marker (`===`, `---`, `%%%`, `>>> first:`,
`>>> biblio`):

| Directive | Description |
| --- | --- |
| `> visibility: hidden` | **Hide the slide.** |
| `> style: dark` | **Dark style** for the current slide. |
| `> theme:` *name* | **Per-slide theme switch** (restored on navigation). |
| `> subtitle:` *text* | **Subtitle** (first slide only). |
| `> title:` *text* | **Title of the bibliography slides** (after `>>> biblio`). |
| `> relief: none` | **Drop the text stroke** on a `%%%` section slide. |
| `> header: none` | **Remove the fixed header.** |
| `> background:` *path*/*color* | **Background** image or colour. |
| `> background-video:` *path* | **Video background** (looped, muted). |
| `> background-opacity:` *0–1* | **Background opacity** for a background video. |
| `> color:` *color* | **Text colour** for the current slide. |
| `> attr:` *attributes* | **Raw attributes** appended to the `<section>` element. |
| `> notes:` [*size*] | **Speaker notes** — the rest of the slide source is notes; the optional value sets their font size. |
| `> cite:` *key* | **Cite a BibTeX entry.** Repeatable; markers with `<ref:key1,key2>`. |
| `> svg:` *path* | **Inline SVG** embedded in the slide DOM. |
| `> hide:` *#id, #id2* | **Hide SVG elements** (by id) in the inlined SVG — reveal them later with `> animate:`. Repeatable. |
| `> animate:` *spec* | **SVG animation step.** Repeatable. See [SVG animation](../svg.md). |
| `> header-margin:` / `> column-spacing:` / `> column-width:` | **Slide layout geometry** — see [Layout parameters](../authoring.md#layout-parameters). |

## Anywhere in the content

| Directive | Description |
| --- | --- |
| `> include:` *file.pres* | Replaced by the file's contents at build time (recursive, deck-local paths). See [Authoring › Including other files](../authoring.md#including-other-files). |
| `> fill` and the layout DSL | `> row`, `> col`, `> grid`, `> card`, `> stack`, `> layer`, `> pin:`, `> frag`, `> eq`, `> info` / `> warn` / `> good`, `> table`, `> cell` — see [Constructs](constructs.md). |
| `> end:` *name* | Closes the named environment. |
