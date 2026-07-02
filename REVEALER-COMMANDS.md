# Revealer commands — reference (humans & agents)

Every command you can use in a `.pres` file, as built for this deck. Build with
`revealer build SFI.pres` (→ `SFI.html`); open it in a browser with
`revealer open SFI.pres` (builds + remembers it); export a PDF with `revealer pdf SFI.pres`.
Running `revealer` with no argument opens the interactive menu (start with *Load a presentation*).

**Three things to remember**
1. **Raw HTML is allowed anywhere** — any line the parser doesn't recognise is passed through verbatim.
   So a shortcut is never *required*; it's a shorthand for common patterns.
2. A shortcut line must **start with its marker** (`*`, `!`, `>`, …). A space after the marker is required where shown.
   (`!`/`!!` may be indented; most others must be flush-left.)
3. The coordinate system is **1920×1080** and each slide is **auto-scaled to fit** — author at natural sizes, don't fight overflow.

Legend:  ⬛ core Revealer · 🟦 added for the SFI deck (in `build.py` / theme `sfi.css`).

---

## 1. File structure

A `.pres` has a **settings** block (global `>` directives), then **content** (slides).
`# …` lines are comments.

## 2. Settings (global — put before the first slide)

| Command | What it does |
| --- | --- |
| `> author: Name` | ⬛ Author line on the title slide (repeatable for several authors). |
| `> affiliation: Text` | 🟦 Affiliation line on the title slide (repeatable; rendered between author and event). |
| `> event: Place · date` | ⬛ Event/date line on the title slide. |
| `> logo: Media/x.png` | ⬛ Logo in the header strip (repeatable). |
| `> theme: sfi` | ⬛ Theme (this deck uses `sfi`). |
| `> title: Text` | ⬛ Browser/tab title. |
| `> slideNumber: c/t` | ⬛ Slide-number badge (`c/t` = current/total). |
| `> width: 1920` / `> height: 1080` / `> margin: 0.02` | ⬛ Canvas size + fit margin. |
| `> bibtex: refs.bib` | ⬛ BibTeX file for `> cite:` / the bibliography slide. |
| `> pdfSeparateFragments: false` | ⬛ One PDF page per slide (not per fragment). |
| `> anyRevealOption: value` | ⬛ Any other key is passed straight to `Reveal.initialize()` (e.g. `transition`, `progress`). |

## 3. Slide markers (start of content)

| Marker | Slide type |
| --- | --- |
| `>>> first: Title` | ⬛ **Title slide** (centered; shows author/affiliation/event). |
| `=== Title` | ⬛ **Content slide.** Title renders in the fixed header bar. |
| `--- Title` | ⬛ **Vertical sub-slide** under the previous `===` slide — use for backups/extras (press ↓). |
| `%%% Title` | ⬛ **Section divider.** 🟦 In `sfi`, pair with `> background: #1A4FD6` for the full-bleed blue divider (`<br>` allowed in the title). |
| `>>> biblio` | ⬛ **Bibliography slide** (auto-filled from `> cite:`). |

## 4. Per-slide directives (right after a slide marker)

| Command | What it does |
| --- | --- |
| `> header: none` | ⬛ Hide the title bar (full-bleed slides). |
| `> background: #1A4FD6` or `Media/x.png` | ⬛ Slide background colour or image. |
| `> background-video: Media/x.mp4` / `> background-opacity: 0.5` | ⬛ Video background + opacity. |
| `> color: #fff` | ⬛ Text colour for this slide. |
| `> style: dark` | ⬛ Dark-style this slide. |
| `> subtitle: Text` | ⬛ Subtitle (title slide only). |
| `> notes: [size]` | ⬛ Everything after this line = speaker notes (speaker view only). |
| `> cite: refID` | ⬛ Cite a BibTeX entry; place markers in text with `<ref:refID>`. |
| `> attr: data-... ` | ⬛ Raw attributes appended to the `<section>` (any reveal.js slide attribute). |
| `> svg: path` / `> animate: spec` | ⬛ Inline SVG + step animation (see `Revealer/Documentation/svg.md`). |
| `> visibility: hidden` | ⬛ Skip/hide the slide. |

## 5. Content shortcuts

| Shortcut | Result |
| --- | --- |
| `* item` (2 spaces per nesting level) | ⬛ Bullet list (nested). |
| `[ text ]` | ⬛ Highlighted block. |
| `$inline$`, `$$display$$` | ⬛ Math (KaTeX). A bare `$$…$$` line is a centered display equation (use instead of a `.math-body` div). |
| `@@ [lang/attrs]` … `@@` | ⬛ Code block. |
| `<ref:id>` | ⬛ Inline citation marker (needs `> cite:`). |
| **Columns** `\|\| 48%` … `\| 48%` … `\|\|` | ⬛ Multi-column row (widths optional). Good for content slides that aren't full-height. |
| **Image** `! path [flags] [h=…/w=…] [+[N]] [\| caption]` | 🟦 See §6. |
| **Video** `!! path [flags] [\| caption]` | 🟦 See §6. |
| **Fill** `> fill` | 🟦 Make the slide body fill the canvas (a flex column) — needed for `> row`/`> col` to resolve heights. Replaces a `<div class="stage">` wrapper. |
| **Layout** `> row [+[N]] [gap]` / `> col [size] [center] [relative] [clip] [+[N]]` / `> end: row` | 🟦 See §7. |
| **Callout** `> info` / `> warn` / `> good` `[+[N]] [Title]` … `> end: …` | 🟦 Blue / red / **green** callout box (optional bold title). |
| **Framed eq** `> eq [+[N]]` … `> end: eq` | 🟦 A framed (accented) equation box. Put `$$…$$` or bare LaTeX inside. |
| **Fragment** `> frag [N]` … `> end: frag` | 🟦 Wrap arbitrary content in a reveal fragment (optional index). Most openers also take a `+`/`+N` flag. |
| **Stack** `> stack [h=…]` … `> layer [+[N]] [clear]` … `> end: stack` | 🟦 Cross-fading media layers in one cell (see §7). Replaces raw `grid-area:1/1` image overlays. |
| **Table** `> table(r,c)` … `> end: table` | ⬛ See §8. |
| **Grid** `> grid(r,c) [compact]` … `> end: grid` | 🟦 See §8. |
| **Pin** `> pin: x% y% [w%] [+]` … `> end: pin` | 🟦 Absolute overlay at % of the slide (`+` = fragment). |

**Fragments everywhere.** A `+` (or `+N` for an explicit `data-fragment-index`) makes a thing reveal as a
fragment: on `! img +2`, `> col 2/5 +`, `> row +`, `> info + Title`, `> eq +3`, or a `> frag` block.

## 6. Images & video — `!` / `!!`  🟦

```
! Media/fig.png  fill contain | A caption
!! Media/clip.mp4  fill cover loop | A caption
```

| Flag | Effect |
| --- | --- |
| `fill` | Fill a sized parent (card/region), cropping as needed. |
| `contain` / `cover` | object-fit (no-crop / crop). Default: `contain`, or `cover` with `fill`. |
| `top` | Anchor to the top (object-position). |
| `frag` | Reveal as a fragment. |
| `h=80px` / `w=120px` | Fixed height / width (e.g. a logo strip). |
| `loop` / `autoplay` / `controls` | *(video only)* playback. Videos are always muted + playsinline and play on reveal. |
| `\| caption` | Caption (figure caption, or a card label inside a card). |

## 7. Layout, callouts, equations  🟦

**Fill + rows/columns** — the canonical way to lay out a slide:
```
=== Title
> fill                       # body fills the canvas (needed for the row below)
> row                        # a flex row of columns
> col 2/5 center             # cell: width 2/5, content vertically centered
! fig.png fill contain
> info Dataset               # a blue callout (red = > warn)
African elephant · Kruger NP
> end: info
> col 3/5                    # next cell (rows auto-split on > col)
!! movie.mp4 | GPS trajectory
> row                        # nesting: a row inside a column
> col
! a.png fill contain
> col
! b.png fill contain
> end: row
> end: row
```
- **`> col` sizes**: `2/5` (fraction), `40%`, `300px`, `2` (bare flex), or none (equal). Flags: `center` (vertical-center),
  `relative` + `clip` (host an absolute overlay), `+`/`+N` (fragment).
- **`> info` / `> warn` / `> good`** `[+[N]] [Title]` … `> end: …` — blue / red / green callout boxes (optional bold title). `> good` is the green "discovery / recovered result" box.
- **`> eq` `[+[N]]`** … `> end: eq` — a framed equation. Plain centered math is just a bare `$$…$$` line.
- **`> frag` `[N]`** … `> end: frag` — wrap any content in a fragment.
- **`> stack` `[h=…]`** … **`> layer` `[+[N]] [clear]`** … `> end: stack` — overlaid media layers sharing one cell, cross-fading as fragments (replaces raw `display:grid; grid-area:1/1` stacks). A fragment layer is opaque (white) by default so it hides the layer beneath; `clear` keeps it transparent (a see-through overlay such as a binning grid); the base (non-fragment) layer is always transparent. `h=…` pins the stack height; otherwise it fills its flex parent.

## 8. Grids, cards & tables

**Grid** (declarative card layout):
```
> grid(rows, cols) [compact]     # compact = auto-height; omit = fills the slide
> gap: 18px
> card                           # bordered card (.sfi-card)
> card plain                     # plain cell, no chrome (portraits, logos)   🟦
> card accent                    # any extra token = extra CSS class (e.g. .accent ring, .neutral grey) 🟦
> card +                         # reveal this card as a fragment (`+N` = indexed) 🟦
> card +: #EFF4FF                # card with a background colour
…card content (use ! / !! with `fill`, or raw HTML)…
> end: grid
```
- `compact` 🟦: the grid sizes to its content and sits next to other blocks (e.g. a portrait/logo strip). Without it, the grid fills the slide (good when the grid *is* the slide).
- `plain` 🟦: a chrome-less cell — pairs with `.pc-photo`/`.pc-name`/`.pc-role` (portraits) or `! logo h=…`.
- **extra classes** 🟦: any token on `> card` that isn't `plain`/`+`/`+N` is added as a CSS class — e.g. `accent` (blue ring), `neutral` (grey card). Combine freely: `> card accent +`.

**Table** ⬛: `> table(r,c)` with `> cell[: #bg]`, `> row`, `> margin:`, `> border:`, `> end: table`.

## 9. Theme building blocks (`sfi`)  🟦

Prefer the commands above. Drop to these class names (in raw-HTML lines, which pass through) only for the bespoke bits.

- **Fill / layout:** prefer `> fill` and `> row`/`> col`. Equivalent classes: `.stage` (fill wrapper), `.row`, `.col`,
  `.region[data-size="1/3|2/3|2/5|3/5|half|full"]`, `.figure` (figure that fills) + `.media`.
- **Boxes:** `.box-info` (blue), `.box-warn` (red), `.box-good` (green), each with `.box-title`; `.math-box` (framed eq), `.math-body` (plain eq), `.eq-label` (caption under an eq). Prefer the `> info`/`> warn`/`> good` macros.
- **Text:** `.s-title`, `.lede`, `.sm`, `.center`, `.bold`, `.blue`, `.muted`, `.chip`, `.noise-row`.
- **Portraits:** `.portrait-card` (photo+name+role), or the pieces `.pc-photo` / `.pc-name` / `.pc-role`; `.portrait-vignette` (circular).
- **Method band (SFI generations):** `.method-card`, `.method-title`, `.method-emph`; definition grid `.term-table` / `.term-key` / `.term-val`.
- **Feature / extension cards:** inside a `> card`, use `.feat-title` · `.feat-sub` · `.feat-eq` (self-framed equation) · `.feat-desc` (`.muted` variant) · `.feat-attr` (`.blue` variant, pins to card bottom); `.feat-svg` = a line-art icon that grows to fill the card. Card variants: `.accent` (blue ring), `.neutral` (grey).
- **Cross-fade stack:** `.rv-stack` + `.rv-layer` (`.rv-opaque` = white backdrop) — emitted by the `> stack`/`> layer` macro.

## 10. Where things live

- Deck source: `SFI.pres` · build output: `SFI.html` · PDF: `SFI.pdf`.
- Authoring how-to + slide map: `AUTHORING.md`.
- Tool + theme: `Revealer/src/revealer/build.py` (parser), `…/data/themes/sfi.css` (theme), `…/data/js/revealer.js` (fit/video runtime).
- Official core docs: `Revealer/Documentation/` (`pres-syntax.md`, `pres-shortcuts.md`, `pres-structure.md`, `themes.md`, `svg.md`, `bibliography.md`).

> 🟦 items (media `!`/`!!`, `> grid`/`> card`, `> pin`, `compact`/`plain`, `h=`/`w=`, `> affiliation`,
> the `%%%` blue divider, and the theme classes) are SFI-deck additions on top of core Revealer.
> If Revealer is upgraded, re-check these against the upstream docs.
