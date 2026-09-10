# Changelog

## 0.4.0 — 2026-09-10

The diagnostics release. Everything a build could not see — a column whose
fractions did not mean what they said, text silently shrunk to a fifth of the
theme size, a callout spilling onto the figure below it — now either behaves
as written or says so. `revealer check` renders the deck and reports what the
parser cannot, the browser editor stopped losing typed text, and the last
reason to hand-write HTML instead of using the DSL (cropping a figure) is a
flag on `!`.

Closes every issue open on the fork: #1–#18.

### Layout DSL (issues #2 #3 #4 #5 #17 #18)

- **Column fractions keep their ratio.** `> col 1/6` and `> col 1/2` used
  to compile to the same width (the denominator was dropped). Fractions
  are now shares of the row: mixed denominators are scaled to a common
  one (`1/6 1/6 1/6 1/2` → 1:1:1:3), same-denominator rows are unchanged,
  and a row whose fractions add up to more than one warns.
- **Percentage columns no longer overflow the slide.** `> col 17%` is a
  share of the *usable* width: the row's gaps are subtracted
  (`calc(17% - 0.51 * gap)` for four columns), so `17 17 17 45` fits.
- **A blank line after `> row` no longer opens an invisible empty
  column** (it silently turned two halves into three thirds). Real content
  before the first `> col` is still the implicit first column.
- **`> row 60px` warns.** A bare length after `> row` has always been the
  column gap, but reads as a height: the build now says so and suggests
  `h=60` — or the new explicit `gap=60px`, which is silent. The editor's
  gap field writes the `gap=` form.
- **`h=` on a layer's media sizes the `> stack`.** It was inert (the layer
  clamps its media to the stack, which just fills the free space); now the
  first layer `h=` becomes the stack height, and disagreeing layers warn.
- **A `<style>`/`<script>`/comment-only block takes no paragraph slot.**
  A deck-wide `<style>` after `>>> first:` used to push the visible
  content down by one paragraph gap.

### Media (issue #8)

- **`crop=` and `zoom=` on `!` / `!!`.** Real source figures carry material
  you want gone at presentation time — a baked-in white margin on a screen
  recording, a rotated axis label at one edge, leftover axis furniture, a
  suptitle holding an internal dataset key — and that was the single most
  common reason to abandon the DSL for hand-written
  `position/overflow/transform` HTML. `crop=9%` trims every side,
  `crop=10%,20%` vertical/horizontal, `crop=12%,0,0,9%` top/right/bottom/left
  (the `margin` shorthand); `zoom=1.4` scales about the centre and
  `zoom=1.4@47%,60%` about a point. The two compose. The media is laid out
  larger than a clipping frame and offset, so the kept region fills the frame
  exactly — which is why `crop=` implies `cover`, and why both flags need
  `fill` or an explicit `h=` (the build warns and renders the media untouched
  otherwise). Both are grammar tokens, so the editor's media panel, the
  palette and the generated references carry them like every other parameter.

### Typography (issues #7 #11)

- **The auto-fit floor is `0.85`, and a setting.** `> fill` and multi-column
  slides could shrink their text to 20% of the theme size with no
  indication. The runtime now absorbs only a small overflow (`> fit-floor:`
  sets it; `1` disables auto-fit; per-slide too), so body text looks the
  same size on every slide; past the floor the block keeps scale 1 —
  visibly overflowing — and is flagged `data-rv-overflow` for tooling.
- **Callout and card titles are at least body size.** The base
  `.box-title` (0.7em) and `.card-title` (0.75em) are 1em; in the SFI
  theme `.box-title`, `.method-title` and `.feat-title` are 34px (body)
  and `.method-card .eq-label` 24px.

### Layout diagnostics (issue #6)

- **`revealer check`** renders the deck in headless Chrome and reports what
  the build cannot see: content overflowing its box, painted off the slide,
  cropped through a figure by `cover`, an empty column, or (with
  `--dead-space`) a near-empty `> fill` slide. Findings use the parser's own
  `Warning: slide 8/1 (Title) line 214: …` format with the measured overflow
  in pixels, so "zero warnings" comes to mean the deck is presentable.
  `--strict` exits 2 for CI, `--skip` silences a kind, and
  `data-rv-check="ignore"` excludes an element. `revealer build --check`
  does both steps at once.
- The browser editor badges the current slide with the same measurements
  (**⚠ N** in the command bar, an outline on each offender), so a problem
  shows up while you are writing the slide rather than in a screenshot sweep.
- The whole deck is measured in one Chrome launch with every fragment shown —
  the most crowded state a slide reaches — and the deck's own `talk.html` is
  never touched.

### CLI, build and grammar (issues #1 #9 #10)

- **`revealer index <deck>`** lists the slides with the indices reveal.js
  uses (`7`, `8/1`, hidden slides skipped), their source line (with the
  file for includes), and `--json`. For deep links, screenshots, and
  "slide 15" conversations.
- **Concurrent builds no longer race on the KaTeX bundle.** `serve` rebuilding
  on save while `revealer build` ran could crash with `Directory not empty`
  and leave a partially deleted `reveal.js/katex/` (math without fonts,
  offline). The bundle is now synced: left alone when it already matches
  the package, refreshed under a lock otherwise.
- **`> fill` and `> space` are grammar constructs**, so the generated
  references (`reference/constructs.md`, the skill's `syntax.md`) and the
  editor palette document `> fill between|center|around|end` and the two
  `> space` forms instead of leaving them to the CSS.

### Editor (issues #12 #13 #14 #15)

- **The deck's header block is editable from the first slide.** The settings
  editor existed only behind *View ▸ Document source* and nobody found it.
  The first slide's panel now opens with a **⚙ Deck settings** section above
  the slide source (unfolded for a short header, collapsed for a long one,
  the choice remembered), and the menu entry moved to *Slide ▸ Deck settings*
  with a label that says what it edits. Both render the same widget, so both
  autosave and both edit the same span. The palette and format bar act on the
  box you are typing in rather than the first one in the panel.

- **The panel's source box no longer loses edits.** It committed only
  through *Apply source*, so selecting another element, changing slide or
  leaving edit mode discarded the typed text silently. Every source box
  (element, whole slide, deck settings) now saves itself when the panel
  navigates away, shows an unsaved marker while it is pending, holds back
  the live reload until it is written, and asks for confirmation if the tab
  is closed with an edit outstanding.

- The source panel soft-wraps long lines (inline HTML, display math,
  table rows) instead of forcing a horizontal hunt, uses a 12px font, and
  starts taller (260px; 360px for the whole-slide source).
- **The slide selector is navigable.** It scrolls horizontally under a
  vertical mouse wheel and keeps the current slide in view; a **filter box**
  (focused as it opens) narrows the deck by title or number with `Enter` to
  jump and `Escape` to clear; and a header button switches between the
  horizontal filmstrip and a **vertical list**, remembered between sessions.
  Navigating a 20-slide deck through a strip was on the critical path for
  everything else in the editor.

### Claude Code skill (issue #16)

- **Added** — `revealer-slides` Claude Code skill
  (`.claude/skills/revealer-slides/`): agent-facing authoring skill with a
  grammar-generated syntax reference, a build-verified pattern library, and a
  headless-Chrome screenshot verifier. Install: see *Installation › Claude
  Code skill*.
- **Raw HTML is the last resort.** SKILL.md carries a hard rule (name the
  construct you considered and why it fails; confirm with the user before
  any raw HTML that is not a documented gap) plus a "tempted to write / use
  instead" table, and the loop now runs `revealer check` and `revealer
  index`. verify.md decodes every warning either can print.

### Language & build (hardening)

- **`> size:` now works inside `> … > end:` blocks** (callout boxes, cards,
  fragments, table cells): like the existing in-block `> align:`, it applies
  from that line to the end of the block (`> size: reset` returns to the
  block's default) instead of leaking into the slide as literal text. When
  both directives are active they share one wrapper, so interleaving them
  can no longer produce mismatched markup.
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

### Editor (edit-mode robustness)

- **Edit mode survives saves.** Every save (and structural edit — new slide,
  block move, delete) rebuilds the deck and reloads the page; the session
  restore that should re-enter edit mode ran before the module defining it
  had loaded, so the editor silently dropped to presentation mode on every
  save. Restore now runs after all editor modules are up, and the restore
  key is honored only by the reload it was written for.
- **The command cheatsheet gained a "Sizes & alignment" group** — `> size:`
  (factor and role forms), `> align:`, and the previously missing
  `> paragraph-spacing:` — replacing the two entries misfiled under
  "Inline format". The docs' quick syntax card follows automatically.
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
