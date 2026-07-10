# Changelog

## Unreleased

### Language & build

- **Stray markup characters no longer corrupt decks.** A `<` in prose or a
  title ("the x < y case") used to be parsed as a tag and swallowed
  everything after it; bare `&` produced invalid HTML. Both are now escaped
  wherever author text lands — body, slide/deck titles, subtitle, author /
  affiliation / event — while real inline HTML tags (`<u>…</u>`, `<br>`)
  and entity escapes (`&nbsp;`, `&#61;`) still pass through. Titles and
  identity fields now also render inline markdown, like every other text.
- **Code blocks are literal.** `@@ … @@` bodies are HTML-escaped: `a < b`,
  `&&`, or a literal `</section>` display as written instead of corrupting
  the slide (or the PDF page count). The fence line still takes language
  names / reveal attributes, minus anything that could close the tag.
- **Settings can no longer break the page.** `> color:` and notes sizes are
  CSS-sanitized; `background:`, `background-video:`, `theme:`, `codeTheme:`,
  `logo:` are attribute-escaped; `slideNumber:` and every forwarded reveal
  option are emitted as proper JS literals (`</` neutralized); markdown link
  URLs cannot escape their `href`.
- **Two `> notes:` blocks on one slide no longer crash the build** (they
  merge; the first non-empty value is the size).
- `***bold italic***` now renders properly nested (`<b><i>…</i></b>`) and
  keeps its editor source map.
- `.bib` files are read as UTF-8 regardless of locale; a non-UTF-8 `.pres`
  reports file and byte offset instead of a raw UnicodeDecodeError.

### Editor

- **Split mode: the slide selector spans only the area above the slide.**
  The filmstrip was full-width, so its right end (later slides and the
  close button) slid under the docked panel; it now aligns with the stage
  box and follows the divider as it is dragged.
- **Slide chip no longer shows "NaN".** On heavy decks the command band is
  built before reveal's first layout, when the slide indices are still
  undefined; the chip now falls back to the deck name and fills in the
  number on reveal's `ready`.

### Runtime

- **Content auto-fit made timing-proof.** reveal.css transitions *all*
  properties on fragments, so any fit pass landing within ~200 ms of a
  fragment reveal read stale heights on every probe of its font-scale
  search and either collapsed blocks to microscopic text (the floor
  scale) or left them overflowing — and the bad value stuck, since
  fragment steps never re-fitted. Fragment transitions are now
  paint-only, an `html.rv-measuring` guard makes measurements immune to
  any stylesheet's transitions, `rv_fitBlock` refuses unresponsive
  measurements instead of trusting them, and every trigger (including
  fragment steps and `document.fonts.ready`) funnels through one
  coalescing scheduler that cancels stale deferred passes. Fits are now
  deterministic: the same slide state yields the same scale regardless
  of navigation speed or direction.

## 0.3.0 — 2026-07-06

The maturity release: everything built during the fork sprint was
consolidated, hardened and documented. This fork lives at
[ronceray/Revealer](https://github.com/ronceray/Revealer) (upstream:
[CandelierLab/Revealer](https://github.com/CandelierLab/Revealer)).

### Language & build

- **Grammar registry** (`src/revealer/grammar.py`): a single source of
  truth for every `.pres` construct, consumed by the parser, the semantic
  edit engine, the browser editor's schema and the generated docs — the
  four can no longer drift apart.
- **Figure pipeline**: `! fig.pdf` converts PDF figures to cached SVGs
  (`pdftocairo`); `> build:` hooks rerun figure scripts before every
  compile; each theme ships a palette-matched `.mplstyle` so plots inherit
  the deck's look.
- **KaTeX macros**: `> macros: defs.tex` imports `\newcommand` files,
  repeatable `> macro:` defines them inline, `> katex:` options merge
  instead of clobbering the local bundle.
- **Includes**: `> include: file.pres` expands other files at build time
  (recursive, deck-local), with an origin map so served decks rebuild on
  saves of any included file — made for lecture courses.
- **PDF export**: `> pdfSeparateFragments: true` yields one page per
  fragment state; the exporter (headless Chrome + `img2pdf`) was hardened.
- **SVG steps**: `> hide:` pre-hides elements by id with a quote-aware
  tokenizer that survives hostile SVGs; `> animate:` steps unchanged.
- Inline typography: light markdown (`**bold**`, `*italic*`, `` `code` ``,
  links), attribute spans (`[x]{.class}`, `color=`, `size=`) and named
  size roles (`lede`, `sm`, …).

### Editor

- The dev-server WYSIWYG layer was decomposed from one monolith into
  thirteen documented modules behind a shared state bus, with an
  in-browser JS test harness driving them in headless Chrome.
- **Save history**: every save auto-commits to a shadow git repository
  (`.rv-history/`); the time machine offers labelled snapshots, per-entry
  diffs, read-only peeks and restores. Undo/redo is a cursor over that
  same history, so it spans browser edits, text-editor saves and
  restores.
- **Outline sidebar**: list, navigate, add, duplicate, reorder and delete
  slides; new whole-slide edit spans and an `insert_lines` op in the edit
  engine back it.
- Semantic edits remain SHA-guarded and all-or-nothing: a stale file
  yields a refused edit and a resync, never a clobber.

### CLI & reproducibility

- `revealer talk.pres` (no sub-command) serves the deck directly — the
  main entry point for a writing session.
- Third-party plugin installs are **pinned by commit** and recorded in
  `.revealer.toml`; rebuilds re-install exactly what a deck recorded, and
  `revealer update --force` deliberately re-pins.
- Server security: localhost binding, token-guarded dev endpoints,
  per-deck locks, UTF-8 everywhere.
- `revealer new` writes a modern template showcasing the layout DSL, and
  a long-standing bug was fixed where the scaffold was written in the
  platform encoding instead of UTF-8.

### Documentation

- Full restructure: quickstart, a merged authoring guide, a browser
  editor guide, recipes, contributor internals — plus a **generated
  reference** (constructs and directives are projected from the grammar
  registry at every docs build, so the reference cannot go stale).
- CI builds the docs warning-free (`sphinx -W`) and runs the unit and
  in-browser suites; committed byte-exact goldens freeze the prod build
  output.

## 0.2.x and earlier

Upstream [CandelierLab/Revealer](https://github.com/CandelierLab/Revealer)
(the `.pres` language, themes, bibliography, SVG animation, CLI) plus the
fork sprint that added the SFI layout DSL (rows/columns, grids, stacks,
pins, callouts, media shortcuts), PDF export, the dev server and the first
versions of the browser editor.
