# Settings & directives

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
| `> theme:` *name* | **Theme.** `revealer` (default), `ljp`, `sfi`, or any [reveal.js theme](https://revealjs.com/themes/). See the [theme gallery](../themes.md). |
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
