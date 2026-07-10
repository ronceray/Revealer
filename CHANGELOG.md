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

- **Gesture edits on included slides now rewrite the right file.** Pin drags
  and nudges, media resizes, row/stack height drags, column splits, block
  moves, fragment reorders and media drops posted their edits with no file,
  so on a `> include:`d slide they were applied to the main `.pres` at the
  include's file-local line numbers — rejected at best, silently rewriting
  the wrong file on a line collision. Every commit path now routes to the
  element's owning file (block moves across files are refused explicitly),
  and the selection info bar names that file instead of always `.pres`.
- **Typing can no longer be discarded by a live-reload.** An SSE reload now
  defers while an in-place editing session is open, and the 5-second force
  reload commits the session instead of dropping the text.
- **The save status tells the truth on network failure**: the chip flips to
  "Not saved ✗" and the pending-save marker is cleared, so a later reload
  can no longer report "Saved ✓" for an edit that never landed.
- Keyboard fixes: dropdown `<select>`s keep their arrow keys (they nudged
  the selected element instead); interrupted touch drags (`pointercancel`)
  end the gesture instead of wedging it on the next tap.
- **Split mode: the slide selector spans only the area above the slide.**
  The filmstrip was full-width, so its right end (later slides and the
  close button) slid under the docked panel; it now aligns with the stage
  box and follows the divider as it is dragged.
- **Slide chip no longer shows "NaN".** On heavy decks the command band is
  built before reveal's first layout, when the slide indices are still
  undefined; the chip now falls back to the deck name and fills in the
  number on reveal's `ready`.

### Language & build (diagnostics)

- **The build now warns instead of staying silent** when it drops content:
  unrecognized directives (`> grid(a,b)` typos — with a hint when a
  construct child like `> card` sits outside its parent), stray
  `> end: name`, an unclosed callout/equation that swallowed the next
  construct, a bare `> space` outside `> fill`, and `!`/`!!` media paths
  that don't exist. Sanctioned styles (auto-close at slide/column
  boundaries) stay silent. Warnings appear in `revealer build` output and
  the `revealer serve` terminal; `revealer build` shows a clean message
  instead of a traceback for build errors.

### Editor & portability polish

- The properties panel and fragment drawer sit below the command band (their
  first rows were hidden behind it); in docked mode the slide selector now
  overlays the floating panel instead of hiding under it.
- Uploads reject Windows-reserved filenames (`CON.png`, trailing dots);
  GUI edits preserve the `.pres` file's permission bits; the config lives
  in `%APPDATA%` on Windows; `revealer update` downloads time out instead
  of hanging; the watcher's main-file check is case-insensitive-safe.
- Panel and outline source fetches no longer cancel each other (a duplicate
  click could be silently dropped by a concurrent panel refresh); removed
  dead CSS rules, 13 dead i18n keys, and the never-matching `:has()` rule
  emitted with every grid.

### Dev server & CLI

- **The "first build failed" page is now alive**: it shows the actual error
  and reloads itself the moment a save fixes the deck (it used to be a dead
  page with an empty error box and no reload hookup).
- **Malformed edit requests and non-UTF-8 sources get proper 4xx answers**
  instead of killing the HTTP connection with no response.
- **A build-breaking edit now reports why** (the failing build's message was
  read after the rollback rebuild had cleared it → `detail: null`), and the
  rollback / no-git undo restore the exact bytes — a CRLF deck is no longer
  silently rewritten to LF.
- **The file watcher survives transient read errors** (cloud-sync/antivirus
  locks — decks in Dropbox routinely hit these); it used to die silently,
  ending live-rebuild for the session. The first asset ever added to a deck
  without media now triggers the reload it used to swallow.
- **`extensions = []` in `.revealer.toml` no longer crashes every build**
  (the index assembly sat inside the extension loop), and fontawesome is
  linked once instead of once per plugin.
- **A corrupted `config.toml` no longer bricks the CLI** (ignored and healed
  on the next save, which is now atomic).
- Concurrent PDF exports are refused instead of racing two Chrome renders
  onto the same file; error responses close the connection when a request
  body may be undrained (keep-alive desync); the served deck is read under
  the session lock (no truncated page during a slow rebuild).

### Themes & fit

- **`> row` / `> col` gutters survive every theme**: the emitted inline gaps
  reference `--gap-row`/`--gap-col`, which only the sfi theme defined — under
  revealer/ljp all rows and columns collapsed to zero gap. The base
  stylesheet now defines them (as aliases of `--rv-gap-*`).
- **Callouts, cards, equation boxes and opaque layers are readable on
  `> style: dark` slides**: their pale backgrounds now pin a dark text color
  (`--rv-box-text`) instead of inheriting the slide's near-white.
- **`> fill` slides now auto-fit like everything else** (their body was
  never font-fitted and simply overflowed the footer).
- **When nothing fits even at the minimum font scale** (a fixed-height row
  or iframe taller than the box), the fitter keeps scale 1 — legible,
  diagnosable overflow instead of microscopic text that still overflows.
- A slide's `> header-height:`/`footer-height:` no longer leaks onto every
  following slide.
- **Esc overview**: visited slides' thumbnails render in place (they were
  displaced by half a slide); plain keys (Space, N, PageDown…) no longer
  advance the deck underneath the open overlay; cloned videos no longer
  re-download the whole deck's media on every open.

### Runtime

- **`> animate:` SVG steps are now a pure function of the visible fragments.**
  The old applier only reacted to per-step events, so any non-linear path —
  Esc-grid jumps, deep links, entering a slide backward, the PDF exporter's
  force-shown fragments — rendered the SVG in the wrong state, and stepping
  back deleted the element's original attributes. The runtime now resets the
  animated elements to a pristine snapshot and replays the currently visible
  steps in order (idempotent), re-syncing on every navigation event and — via
  a class observer — on the silent flips reveal performs when fragments are
  disabled. Stepping back lands on the previous step's exact values; leaving
  the slide restores the authored SVG. Fragment-gated videos play/reset on
  visibility edges under the same mechanism, so they also work on jumps.
- **PDF exports render every `> animate:` state correctly** in both modes,
  and page captures are transition-free (a screenshot can no longer race a
  half-played fade or SVG step).
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
