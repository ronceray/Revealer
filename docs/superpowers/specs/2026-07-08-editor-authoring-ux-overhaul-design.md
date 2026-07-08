# Design: editor authoring-UX overhaul

A set of related improvements to the **dev-mode editor** (`revealer serve` only —
nothing here ships in exported decks, except the two DSL changes noted). Goal:
make authoring faster and more discoverable — a roomier code box, a visual
template picker for new slides, a clickable command palette generated from the
grammar, a real way to fragment bullets, a mode-aware menu chrome over a
bottom-docked slide, and document settings edited through the normal panel.

Scope marker per section: **editor-only** (served JS/CSS, never in built decks)
or **build** (the `.pres` language / renderer, ships everywhere).

## Decisions locked (from the design interviews)

- Code box: modest default bump; still drag-resizable.
- New-slide picker opens from the slide selector's per-row `＋`; **all 13**
  templates included (9 core + 4 optional).
- Palette chips: bare syntax; **click inserts at the cursor** (Smart: into the
  open source box, else a new block).
- Palette lives in the side panel, **generated from `/__rv__/schema`**.
- Bullet fragments: add a `* +` / `* +N` marker (renderer change) **and** a
  "wrap selection in `> frag`" palette action.
- `.lede` is theme-defined (smaller in SFI); sizes shown as a neutral scale.
- Toolbar → **mode-aware menu**: preview shows only Edit; edit mode is a named
  **menubar** (Direction A) over a **bottom-docked slide**; the slide selector is
  a **text filmstrip** in the reclaimed top strip; **undo/redo live in a menu**;
  Export + History are **hidden in preview**.
- Document settings edit through the **main panel** code editor (not a separate box).

---

## A. Bigger source code box — *editor-only*

**Goal.** The `.rv-pn-src` textarea is cramped (90 px). Give it a roomier default.

**Approach.** CSS only, in `editor.css`:
- `.rv-pn-src` `min-height: 90px → 150px`.
- `.rv-pn-src-slide` (whole-slide / settings source) `200px → 260px`.
- Keep `resize: vertical`. No JS change; the box already persists nothing, and
  the drag affordance is unchanged.

**Files.** `src/revealer/data/js/editor.css` (rules at ~448, ~509).

---

## B. Slide-template gallery — *editor-only*

**Goal.** Replace the single fixed "New slide" insert with a visual picker of 13
templates.

**Today.** `outline.js` `doAction('add', …)` (line 131) inserts a fixed
`['', '=== New slide', '', 'Text']` after the slide via `insert_lines`.

**Approach.**
- New module `editor/templates.js` holding a `TEMPLATES` registry and the
  gallery UI. Each entry: `{ id, group, name, desc, body: [lines], thumb }`
  where `thumb` is a tiny CSS mini-diagram (as mocked). Groups: Structure /
  Text / Media / Emphasis / Structured & special.
- `F.openTemplateGallery(afterSpan, file)` opens an `RV.ui.box`
  (`id: 'rv-ed-templates'`) with the grouped cards. Clicking a card inserts its
  `body` via the existing `insert_lines` op at `{ insert_before: afterSpan.e + 1,
  container_kind: 'deck' }` (reusing the current `doAction('add')` path,
  generalized to take the chosen body), then closes.
- Entry points: the slide-selector filmstrip's per-cell `＋` (was the outline
  `＋`), and a **"New slide…"** item in the **Slide** menu (feature F).

**The 13 templates** (exact bodies live in `templates.js`; summarised):

| Group | id | Inserted `.pres` |
|---|---|---|
| Structure | content | `=== Title` / `Your text here.` |
| | section | `%%% Section title` |
| | statement | `=== ` / `> align: center` / `> size: title` / `Your key message.` |
| Text | bullets | `=== Title` / `* First point` ×3 |
| | twocol | `=== Title` / `\|\| 50%` … `\| 50%` … `\|\|` |
| Media | figure | `=== Title` / `! image.png fill \| Caption` |
| | figtext | `=== Title` / `\|\| 55%` `! image.png fill` `\| 45%` text `\|\|` |
| Emphasis | compare | `=== Title` / two cols `> good Strengths` / `> warn Watch out` |
| | equation | `=== Title` / `$$ E = mc^2 $$` |
| Structured | grid | `=== Title` / `> grid(2,2)` + 4 `> card` / `> end: grid` |
| | table | `=== Title` / `> table(3,3)` |
| | vsub | `--- Sub-slide title` / body (stacks under current) |
| | title | `>>> first: Deck title` / `>>> subtitle:` / `>>> author:` |

Notes to verify in implementation: an empty `=== ` header ("statement") must not
emit a stray empty title bar — if it does, give it a placeholder title the user
clears. `>>>` templates are deck-opener directives; inserting mid-deck is allowed
but the user may move them (acceptable for v1).

**Files.** new `editor/templates.js`; `editor/outline.js` (route `＋`/add to the
gallery); `editor.css` (gallery styles); `assets.py` (register the new module in
the served bundle list); `i18n.js` (template names/desc, gallery title).

---

## C. Schema-driven visual command palette — *editor-only + build (grammar metadata)*

**Goal.** Replace the stale hardcoded `CHEATSHEET` in `panel.js` (lines 169–201)
with a clickable palette **generated from the grammar**, so it lists every
construct, never drifts, and inserts a ready-to-fill skeleton at the cursor.

**Today.** `panel.js` hardcodes a `CHEATSHEET` array rendered as static `<pre>`
text inside a `<details>`. The DSL already emits the authoritative grammar at
`GET /__rv__/schema` (`grammar.py schema()`), but the editor ignores it. The
`cheat` metadata is `(category, example)` pairs; `STATIC_CHEAT` holds the
category lines with no owning construct — including a misleading
`[big]{.lede}  [small]{.sm}`.

**Approach.**

1. **Enrich the grammar metadata** (`grammar.py`, *build* — affects the docs
   reference too). Change each cheat item from a 2-tuple to a 3-field shape
   `(category, chip, insert)`:
   - `chip` — the short bare syntax shown on the button (e.g. `> info`).
   - `insert` — the skeleton dropped at the cursor (e.g.
     `"> info Title\n\n\n> end: info"`).
   Update `ConstructSpec.cheat`, `STATIC_CHEAT`, `schema()`, and
   `Documentation/gen_reference.py` (which reads `cheat`) to the new shape; the
   reference chapter keeps rendering `chip` + an example. **Fix** the `lede`
   line: drop "big/small"; show sizes as a neutral scale
   (`.title  .lede  .sm  .fine`) with a one-line "theme-defined" note.
   Sphinx must stay `-W`-clean.

2. **Fetch the schema once** at editor boot (`net.js`/`boot.js`): `GET
   /__rv__/schema`, cache on `RV.schema`. (Endpoint already served at
   `serve.py:638`.)

3. **Render the palette** (`panel.js`, replacing `appendCheatsheet`): grouped
   chips built from `RV.schema.staticCheat` + each construct's `cheat`, in the
   schema's own category order (Slides / Layout / Media / Components /
   Text & math / Inline format), plus a **Fragments** group (feature D/E). Keep
   it collapsible with the persisted open-state (`localStorage 'rv-ed-cheat'`).

4. **Click behaviour (Smart target).** Add `F.insertAtCursor(ta, text)` to
   `format.js` (sibling of `wrapSel`). On chip click:
   - if a `.rv-pn-src` textarea exists in the panel → insert `insert` at its
     caret (the common case — the panel almost always shows a source box);
   - else → post `insert_lines` for a new block on the current slide via
     `F.rvPostEdit` (robust fallback).
   Inline-format chips (bold/italic/code/color/size) **wrap** the selection —
   they reuse `wrapSel` and render with the dashed style, exactly like the
   existing `formatBar`.

**Files.** `grammar.py`, `Documentation/gen_reference.py` (*build*);
`editor/panel.js`, `editor/format.js`, `editor/net.js`/`boot.js`, `editor.css`,
`i18n.js` (*editor*).

---

## D. Per-bullet fragments: `* +` / `* +N` — *build*

**Goal.** Let a single bullet reveal as a reveal.js fragment, consistent with the
`+` flag every construct already accepts. Today the *only* way to reveal bullets
is to wrap them in `> frag … > end: frag`.

**Approach** (`build.py` list rendering + `grammar.py` metadata):
- In the bullet/list path (`_contentify_legacy`, list handling around 925–946),
  detect a leading fragment flag in an item's content: a bullet line
  `^(\s*)([*\-+])\s+\+(\d*)\s+(.*)$` → emit `<li class="fragment"` with an
  optional ` data-fragment-index="N"` (reuse the `_frag_attrs` shape at 1230),
  and render `(.*)`  as the item text. Nesting (2-space indent) is unaffected.
- **Precedence / ambiguity.** `+` is itself a bullet marker, so the flag only
  applies *after* a marker+space: `* + x` = star-bullet, fragment, "x". A plain
  `+ x` stays an ordinary plus-marker bullet (no fragment). To write an item
  whose text literally starts with "+", escape it (`* \+ x`). Document this.
- `grammar.py`: add the token to the cheat metadata (a **Fragments** category
  entry, `chip: "* +"`, `insert: "* + "`), so it appears in the palette and the
  generated reference.

**Testing.** New golden/grammar cases: `* + x` → `<li class="fragment">`;
`* +2 x` → `data-fragment-index="2"`; nested `  * + x`; `- + x`; literal
`* \+ x` (no fragment, literal "+"); a plain `+ x` list (still a bullet). Add to
`tests/test_grammar.py` and a fixture in the golden build; do **not** alter
existing goldens (new fixtures only).

**Files.** `src/revealer/build.py`, `src/revealer/grammar.py`;
`Documentation/authoring.md` + generated reference; `tests/`.

---

## E. "Wrap selection in `> frag`" action — *editor-only*

**Goal.** Turn any selected source lines into one fragment without hand-typing
the block.

**Approach.** A palette button (in the **Fragments** group) and/or a `formatBar`
button: wrap the selected lines of the focused `.rv-pn-src` in
`> frag` … `> end: frag` (a line-wrapping variant of `wrapSel`, since `> frag`
is block-level, not inline). If the selection is empty, wrap the current line.
Pure client-side textarea edit (no new server op); Apply commits as usual.

**Files.** `editor/format.js`, `editor/panel.js`.

---

## F. Mode-aware chrome: named menubar over a bottom-docked slide — *editor-only*

**Goal.** Replace the flat 12-button floating toolbar (`shell.js buildToolbar`,
121–208) with a mode-aware menu. Preview offers only "Edit". Edit mode is a
full-width top **command band** over a **bottom-docked slide**, reclaiming the
top letterbox for the menu and the slide selector.

### F1. Modes
- **Preview** (`!S.on`): no band. Only a small **draggable Edit pill** (grip +
  `✏ Edit` + a save-state dot), keeping the current `rv-ed-tbpos` drag +
  localStorage. Nothing else — Export/History/Insert/etc. are all edit-only.
- **Edit** (`S.on`): the pill is replaced by the pinned band.
- `shell.js` builds both once and toggles visibility via
  `RV.onChange('on', …)` (mirrors how `split.js applyLayout` subscribes;
  `setEdit` already `RV.emit('on')` at `chrome.js:246`).

### F2. The command band (Direction A)
Left → right: grip (drives the pill only), `✏ Edit` toggle (pressed), the
**current-slide chip** (`N · title`), the **menubar**, a spacer, and the
right-aligned **filename + save-status chip** (`.rv-tb-status`, unchanged states
+ the `rv-ed-lastsave` handshake). Menus (every current handler kept verbatim,
just re-parented under `<li>`s):

| Menu | Items → handler |
|---|---|
| **Insert** | Media… → `importMedia`; Fragments/animation… → `F.toggleDrawer` |
| **Slide** | New slide… → `F.openTemplateGallery` (B); Slide selector → `F.toggleOutline` (filmstrip) |
| **History** | Undo → `rvUndoRedo('undo')`; Redo → `rvUndoRedo('redo')`; ─; Version history… → `F.toggleHistory` (dimmed on `__RV_DEV__.history==='fallback'`, one-time git toast preserved) |
| **View** | Split view (✓ when `splitPref`) → toggle `splitPref`; Document source… → panel doc-settings (G) |
| **Export** | Export HTML → `exportHtml`; Export PDF… → `startPdfExport` (cancellable SSE box) |
| **Help** | How editing works → `toggleHelp` |

Dropdowns are a lightweight menu component (click to open, click-away / `Esc`
closes, mutually exclusive), rendered as children of the band so they hang
**down into the reclaimed strip**. Keyboard shortcuts unchanged (`e` toggles
edit, `o` outline, `f` fragments, Ctrl+Z/Shift+Z undo/redo — `chrome.js` 259–280).

### F3. Bottom-docking the slide
A shared `STRIP = 58` constant (== `split.js STAGE.top`), reserved **only in edit
mode**.
- **Split edit** (existing `fitStage`): bottom-align by changing the vertical
  centre `ty = sy + (sh - boxH)/2` (`split.js:100`) to `ty = sy + (sh - boxH) -
  pad`, and re-derive `#rv-ed-frame` top from the new `ty`. STAGE.top already
  reserves the band; STAGE.bottom (48) the hint bar. Otherwise unchanged.
- **Docked edit** (new `fitDock`): `setEdit(true)` adds `body.rv-strip`, whose
  CSS insets `.reveal { top: STRIP }` (from `inset:0`) so `Reveal.layout()`
  re-fits the deck into the shorter box; then — **after** `Reveal.layout()`, in
  the same `relayout` rAF — measure the fitted slide and translate the whole deck
  unit (`chromeEls()`) **down** by the residual top letterbox so the slide sits
  flush at the bottom and all slack collects under the band. Reuse split.js's
  `transform-origin: 0 0 !important` on `chromeEls()` (never `.slides`), so
  reveal keeps ownership of aspect-fit. `clearDock()` removes the transforms and
  `body.rv-strip` on `setEdit(false)` (like `clearStage`), returning **preview to
  plain centered reveal.js**.
- Drive both from the existing `relayout()` (already hooked to `resize`,
  `RV.onChange('on'|'splitPref')`); ordering: set/clear `body.rv-strip` →
  (`fitStage` for split) → `Reveal.layout` → (`fitDock` measure+translate for
  docked) → `fitSlide` → `F.syncChrome` so outlines/handles/hovertags re-glue.

### F4. Slide selector → text filmstrip
Reuse `outline.js` **wholesale** (`topSections`, `titleOf`, `spanOf`, `isInc`,
`doAction` add/dup/up/down/delete via `rvPostEdit`, `.rv-ol-current` highlight,
`▤`-kids badge, included-slides navigate-only). Keep `id="rv-ed-outline"`,
`F.toggleOutline`, and the `RV.ui.box` toggle semantics so
`saveStateAndReload`/`restoreState` and the `?rv-outline=1` boot hook keep
working — **only the CSS anchor and row→cell layout change**: from the fixed left
rail (`editor.css:270`, vertical, `top:60 left:12 bottom:12 width:240`) to a
horizontal filmstrip anchored `top:STRIP; left:0; right:0`, horizontally
scrollable, each cell `N · title` + per-cell `＋`(gallery)/⧉/↑/↓/🗑. The band's
current-slide chip toggles it; `o` still toggles it. z-band stays **9600**
(below the **9700** band, so the strip never covers its own trigger).

### F5. z-scale
Band stays at the toolbar slot **9700**; dropdown menus render inside/just under
the band (≤ 9700, above the 9600 outline, below help/history/docset 9810–9830);
filmstrip 9600. Update the `editor.css` z-scale header comment only if a slot
actually moves (it should not).

**Files.** `editor/shell.js` (band + pill + menus), `editor/chrome.js`
(`setEdit` adds/removes `body.rv-strip`, calls `clearDock`), `editor/split.js`
(shared `STRIP`, `fitDock`/`clearDock`, split `ty` bottom-align),
`editor/outline.js` (horizontal cell render), `editor.css` (band, pill, filmstrip
re-anchor, `body.rv-strip .reveal` inset), `i18n.js` (menu labels), `assets.py`
(no new file). Verify export/screenshot unaffected (preview is plain reveal; the
transform is edit-only).

---

## G. Document settings via the main panel — *editor-only*

**Finding.** `docsettings.js` is *already* a raw-source editor: `openSettings`
loads lines `1 … firstSlide-1` into a `.rv-pn-src` textarea and applies
`replace_lines`/`insert_lines`. It is **not** a fields panel — it is just a
*separate* box (`#rv-ed-docset`).

**Goal (interpreted).** "Use the code editor" = route settings editing through
the **main side panel** (getting the bigger box A, the palette C, and the format
bar for free), instead of the bespoke `#rv-ed-docset` popup.

**Approach.** Add a panel render mode for the settings block. The **View →
Document source…** item sets a state (e.g. `S.docSel = true`) that makes
`renderPanel` show breadcrumb "Document settings", the settings-block source
(`fetchSrc(1, first-1)`) in the standard `.rv-pn-src` box with the format bar +
palette + Apply (`replace_lines`, or `insert_lines` at `{insert_before:1,
container_kind:'deck'}` when no block exists — the exact logic from
`docsettings.js`, moved into `panel.js` as `renderDocSettings(p)`). Retire the
separate `#rv-ed-docset` box and the `⚙` button (already gone in F). Selecting
any element or slide clears `S.docSel`.

**Files.** `editor/panel.js` (new render mode), delete/fold `editor/docsettings.js`,
`editor/shell.js` (menu entry), `editor.css`/`i18n.js` (labels).

---

## Testing

- **A / bigger box:** covered by existing panel tests; assert new min-heights via
  a CSS presence check if convenient.
- **B / gallery:** JS harness (`suite-ui.js` or new `suite-templates.js`): open
  the gallery, click a template, assert the expected `insert_lines` op is posted
  (or the source gains the template lines) and a slide is added.
- **C / palette:** assert the palette renders groups from a stubbed
  `/__rv__/schema`; clicking a chip inserts its `insert` text at the caret of a
  `.rv-pn-src`; an inline-format chip wraps a selection. Python: `schema()`
  emits the new `(category, chip, insert)` shape and the corrected `lede` line;
  `gen_reference.py` still builds `-W`-clean.
- **D / `* +`:** grammar + golden cases listed in §D (new fixtures only).
- **E / frag-wrap:** harness: select lines, click wrap, assert
  `> frag … > end: frag` brackets them.
- **F / chrome:** harness `suite-ui.js`: in preview only the Edit pill exists;
  entering edit shows the band + menus and hides the pill; a menu item dispatches
  its handler; `?rv-outline=1` still opens the (re-anchored) selector; the
  `saveStateAndReload` round-trip restores edit/outline state. **Geometry:**
  headless-Chrome screenshots at docked `?rv-edit=1` and split
  `?rv-edit=1&rv-split=1` — assert the slide is bottom-aligned (top strip band +
  reclaimed gap present, no bottom letterbox) and that leaving edit restores
  centered reveal. Confirm HTML/PDF export from edit mode is unaffected.
- **G / doc-settings:** harness: "Document source…" renders the settings block in
  the panel source box; Apply posts `replace_lines` (existing block) or
  `insert_lines` (none).

## Implementation order & phasing

Independent, low-risk first; the chrome refactor last (riskiest, touches
geometry). Suggested order:
1. **A** (CSS) and **D + E** (bullet fragments + wrap) — self-contained, testable
   in isolation; D/E is the only *build* change.
2. **C** (schema palette + grammar `cheat` enrichment + `lede` fix) — unlocks the
   palette the fragment chips live in.
3. **B** (template gallery).
4. **G** (doc-settings into the panel).
5. **F** (mode-aware chrome + bottom-dock) — depends on nothing above but is the
   largest; the filmstrip (F4) subsumes the current outline and hosts B's `＋`.

Each is shippable on its own; F can be split further (band+menus+preview first;
bottom-dock geometry second) if the geometry needs iteration.

## Non-goals (v1)

- No live-thumbnail filmstrip (text cells only; thumbnails are a possible
  follow-up).
- No per-bullet fragment *edit op* in the panel (the `* +` marker is authored /
  inserted directly; the construct fragment field is unchanged).
- No change to exported-deck chrome, the split-view letterbox, or the Esc
  thumbnail-grid overview.
- No new export-from-preview affordance (Export moves behind the Edit gate by
  decision).

## Files touched (summary)

- **Build (ships everywhere):** `src/revealer/build.py` (D), `src/revealer/grammar.py`
  (C, D), `Documentation/gen_reference.py` + `Documentation/authoring.md` (C, D).
- **Editor JS:** `editor/shell.js` (F, G), `editor/chrome.js` (F),
  `editor/split.js` (F), `editor/outline.js` (B, F), `editor/panel.js` (C, G),
  `editor/format.js` (C, E), `editor/net.js`/`boot.js` (C schema fetch),
  new `editor/templates.js` (B), fold out `editor/docsettings.js` (G),
  `editor/i18n.js` (B, C, F, G).
- **Editor CSS:** `editor.css` (A, B, C, F).
- **Wiring:** `src/revealer/assets.py` (register `templates.js`; drop
  `docsettings.js` from the served bundle).
- **Tests:** `tests/test_grammar.py`, golden fixtures, `tests/test_editor_js.py`
  + `data/js/test/suite-*.js`.
