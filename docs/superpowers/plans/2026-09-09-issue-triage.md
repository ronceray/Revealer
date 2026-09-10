# Issue triage 2026-09-09 — plans for the hard ones

> **Status (2026-09-10): all five shipped.** #13 autosave, #14 the deck
> settings on the first slide, #6 `revealer check`, #8 `crop=` / `zoom=`,
> #15 the jump box and vertical list. The sections below are the design as
> written before implementation; where the build disagreed with the plan the
> commit message records what actually happened — notably #8, where a
> box-relative crop turned out to be wrong under `contain` (the trim ate the
> letterbox band, not the axis label), so `crop=` now implies `cover`; and
> #6, where the deck walk had to settle on timers rather than
> `requestAnimationFrame`, which never fires once a headless page goes idle.


Eighteen issues were open on ronceray/Revealer. Thirteen were fixed in the
working tree (see CHANGELOG › Unreleased: #1 #2 #3 #4 #5 #7 #9 #10 #11
#12 #16 #17 #18, plus the minimum fix for #15). This file plans the five
that need design or a bigger build: **#6, #8, #13, #14, #15**.

Ordering, by value per effort: #13 → #14 → #6 → #8 → #15 (rest).

---

## #13 Editor: unsaved-changes warning and autosave

**Problem.** The panel's source textarea (`panel.js`, three variants:
element source, whole-slide source, deck settings) commits only on the
*Apply* button. Selecting another element, changing slide, or toggling the
panel re-renders it (`rvPanelSync`) and the typed text is gone.

**Design: autosave on navigate, with a visible dirty state.**

1. *Dirty tracking.* When `fetchSrc` fills a textarea, store the original
   on it (`ta._rvOrig = ta.value`) and the commit closure that *Apply*
   would run (`ta._rvCommit = function () {...}` — the existing
   `rvPostEdit([{op:'replace_lines', …}])` call with its bounds/file).
   An `input` listener toggles a `rv-dirty` class on the panel (a coloured
   border on the textarea + "unsaved" in the foot text) when
   `ta.value !== ta._rvOrig`.
2. *Flush before re-render.* In `rvPanelSync` (and the doc-settings
   `slidechanged` hook), before `p.innerHTML = …`, call a new
   `flushDirty()` that finds `.rv-pn-src.rv-dirty` in the panel and runs
   its `_rvCommit`. Because `rvPostEdit` queues the edit and the SSE reload
   re-renders everything, the flush must run **before** the selection
   change is applied — i.e. in `RV.set('sel', …)` observers, first thing.
   A toast ("Saved 3 lines") confirms it.
3. *Blur is not enough.* Clicking a slide element blurs the textarea, but
   so does clicking *Apply* itself and the palette chips, so use the
   navigation hooks above, not `blur`.
4. *Guard against double posting.* `rvPostEdit` already dedups identical
   sha edits; after a successful flush set `_rvOrig = value` so a second
   flush is a no-op.
5. *`beforeunload`.* If any textarea is dirty, `window.onbeforeunload`
   returns a string (the browser's own "leave page?" prompt) — covers the
   tab-close case, which no in-page hook can.
6. *Undo.* The history drawer already records every posted edit, so an
   autosaved edit is undoable with Ctrl+Z; no separate undo history for
   the textarea is needed for v1.

**Tests.** `suite-ui.js`: type into the panel source, `RV.set('sel',
other)`, assert a `replace_lines` edit was posted (mock `F.rvPostEdit`)
and that the panel shows the new selection. Second test: no post when the
value is unchanged. Python side: none (no server change).

**Effort.** ~80 lines in `panel.js` + 2 tests. Half a day.

---

## #14 Editor: the deck header is not editable from the first slide

**Problem.** `renderDocSettings()` exists (View ▸ Document source, the ⚙
button) but nobody finds it. Authors look at slide 1.

**Design: the whole-slide panel of slide 0 shows the header block first.**

1. In the whole-slide panel renderer (`panel.js` ~line 130, the variant
   with `.rv-pn-src-slide`), when `Reveal.getIndices().h === 0` **and**
   the deck has a settings block (`renderDocSettings` already computes
   its span: main-file lines before the first `===|%%%|>>>|> include:`),
   prepend a collapsible section *Deck settings (title, author, theme…)*
   containing the same textarea + Apply that `renderDocSettings` builds.
   Factor the span computation and the textarea/commit wiring out of
   `renderDocSettings` into `docSettingsWidget(container)` and call it from
   both places, so there is one implementation.
2. Keep it collapsed by default *unless* the header is short (≤ 12
   lines), in which case it is open — the common talk has 6–10 settings
   lines and they should be visible without a click.
3. Also add a `⚙ Settings` chip in the palette's *Slides* category (cheat
   entry with a special insert that opens the widget) so it is reachable
   from any slide.
4. With #13 in place, edits in this widget autosave like the others.

**Tests.** `suite-ui.js`: on slide 0 the panel contains
`.rv-pn-src-doc` whose value starts with `> title:`; on slide 1 it does
not; Apply posts `replace_lines` with `start: 1`.

**Effort.** ~60 lines. Half a day. Do it right after #13 (shares the
autosave wiring).

---

## #6 `revealer check`: layout-time diagnostics

**Problem.** The build's warnings are parse-time only. Overflow, clipped
media, a logo row below the slide, ragged stacked panels — all invisible
until someone screenshots every slide.

**Groundwork already in place (this batch).** The runtime now marks any
block that would need a shrink past the fit floor with
`data-rv-overflow="<px>"` (`rv_fitBlock`), so the most common failure is
already detectable from the DOM.

**Design: a headless pass over the built deck, reported like parse
warnings.**

1. *Command.* `revealer check <deck>` (and `revealer build --check`):
   builds, then drives the existing headless Chrome (`pdf.py` already has
   `_find_chrome` and a CDP driver; reuse it) through every slide with
   fragments forced visible (the `pdf.py` style injection).
2. *Probe script* (new `src/revealer/data/js/check.js`, injected via
   `Runtime.evaluate`, returns JSON per slide):
   - `overflow`: every element with `data-rv-overflow` (from the fit
     engine), plus any `.rv-content-inner` / `.region` / `.rv-card` /
     `.rv-layer` whose `scrollHeight > clientHeight + 2`;
   - `outside`: every visible element whose `getBoundingClientRect()`
     falls outside the `.slides` rect by more than 2px (in slide
     coordinates: divide by `Reveal.getScale()`), reported with its
     kind (`F.kindOf`-style class lookup, duplicated minimally) and
     overflow in px per side;
   - `clipped media`: `img/video.rv-media-fill` with `object-fit: cover`
     whose natural aspect differs from its box by > 25% (a proxy for "an
     axis label was cut");
   - `dead space` (optional, `--dead-space`): a `> fill` slide whose
     content occupies < 55% of the body height;
   - `empty column`: a `.region` with no text and no media.
3. *Report.* `Warning: slide 8/1 (line 214): row overflows its h=460
   box by 38px — split the slide or raise h=`. Slide index comes from
   `slide_index()` (already exists, #9); the line from `data-rv-src`
   (dev-mode attributes — run the check on a dev build in a temp copy so
   the shipped HTML stays clean). Same `Warning:` prefix so the skill's
   verify loop and CI can grep it. Exit code 2 when anything is reported
   and `--strict` is given.
4. *Dev editor.* Under `revealer serve`, run the probe on the slide after
   every reload and badge the offending element (red outline + tooltip
   "overflows by 38px"), and show the count in the command bar chip.
   This is the same script, so it comes for free once (2) exists.
5. *False-positive control.* Elements inside `> pin` (deliberately
   absolute), `.rv-space`, and anything with `data-rv-check="ignore"`
   (a new raw attribute authors can add) are skipped.

**Tests.** A deck fixture with one overflowing row, one logo row below
the box, one clean slide; assert exactly two warnings with the right slide
indices. Skips without Chrome (same guard as the JS suite).

**Effort.** ~250 lines Python + ~120 lines JS + tests. Two days. The
skill's verify.md then makes `revealer check` step 3½ of its loop.

---

## #8 Media crop / zoom flags

**Problem.** Matplotlib exports and screen recordings carry margins,
axis furniture and suptitles. Four raw-HTML blocks per deck exist only
to hide them. It is the most common reason to leave the DSL.

**Design: two flags on `!` / `!!`, resolved in CSS, no wrapper for the
common case.**

```
! Media/fig.png cover zoom=1.4            # scale about the centre
! Media/fig.png cover zoom=1.4@47%,50%    # scale about a point (x,y)
! Media/fig.png contain crop=10%,0,0,0    # trim top,right,bottom,left
!! Media/movie.mp4 fill crop=9%           # one value: all four sides
```

1. *Grammar.* Two `TokenSpec`s on the `media` construct:
   `zoom` (`zoom=(\d+(?:\.\d+)?)(?:@(\d+)%(?:,(\d+)%)?)?`) and
   `crop` (`crop=` + 1–4 comma-separated percentages). Both surface in
   the editor's media fields and the generated references for free.
2. *Emission.* Both flags wrap the media in
   `<div class="rv-media-crop">` (`overflow:hidden; position:relative;
   width:100%; height:100%; flex:1 1 0; min-height:0; border-radius:
   var(--rv-media-radius)`) — the media keeps its own class and
   `object-fit`, so `fill`/`contain`/`cover` behave as today inside the
   wrapper.
   - `zoom=Z@X,Y` → on the media: `transform:scale(Z);
     transform-origin:X% Y%` (defaults 50% 50%).
   - `crop=t,r,b,l` → on the media: `width:calc(100% / (1 - l - r));
     height:calc(100% / (1 - t - b)); margin-left:calc(-l * 100% / (1 -
     l - r)); margin-top:…` — i.e. the media is enlarged so the cropped
     box fills the wrapper, then shifted. Works for `cover`; for
     `contain` (the suptitle case) use `clip-path: inset(t% r% b% l%)`
     plus the same scale-up, since the letterboxing must be cropped too.
     Prototype both in the scratchpad against a matplotlib PNG with a
     suptitle before settling; the `contain` case is the one that matters.
   - Both flags at once: crop first, zoom on top.
3. *Fragments and captions.* The wrapper takes the `fragment` class and
   `data-fragment-index` (as `<figure>` does today); the caption stays a
   sibling.
4. *Stacks.* `.rv-stack > .rv-layer > .rv-media-crop` gets the same
   `flex/width` rules as `.rv-media-fill` there.
5. *Editor.* Drag handles need no change (the wrapper is the sized box);
   the media panel gains two fields via the schema. `set_media_size`'s
   token rewriting must leave `zoom=`/`crop=` alone — add them to
   `_rewrite_tokens`' keep-set.
6. *Docs.* authoring.md › Images and videos gets a "Cropping and zooming"
   paragraph; the skill's SKILL.md drops "crop/zoom" from the documented
   gaps and adds a row to the "tempted to write" table; patterns.md gets
   a build-verified snippet.

**Tests.** Build-level: the emitted style strings for four combinations;
`test_grammar` sample line `! a.png cover zoom=1.4@47%,50%`; an edit-op
round trip keeping the flags. Visual: one screenshot in the theme gallery
deck.

**Effort.** One day including the prototype.

---

## #15 Editor: slide selector navigation (beyond the wheel fix)

**Done in this batch.** The filmstrip scrolls horizontally under a
vertical wheel and keeps the current slide in view (opening the strip or
using the arrow keys no longer lands on slide 1).

**Still worth doing, in order.**

1. *Jump box.* A text input at the left of the strip: typing filters the
   items by title (case-insensitive substring) and `Enter` jumps to the
   first match. ~30 lines in `outline.js`; the i18n key `outline.filter`.
2. *Vertical mode in split view.* When the panel is docked right (split
   mode already insets the strip), offer *View ▸ Slide list* that renders
   the same items as a vertical list in the panel's top area
   (`flex-direction: column`, `overflow-y: auto`, thumbnails off). Most of
   the issue's "slow and unintuitive" is the horizontal strip fighting a
   20+ slide deck; a vertical list is the familiar shape.
3. *Thumbnails.* Real thumbnails (a scaled iframe per slide) are heavy;
   the text card is fine. Skip unless asked.

**Effort.** (1) an hour; (2) half a day.

---

## Not planned: #7's "warn when content still does not fit"

Covered by the floor + `data-rv-overflow` flag (this batch) and by #6's
report. Nothing further.
