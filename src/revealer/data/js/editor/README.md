# The Revealer editor (dev-server WYSIWYG layer)

Fifteen modules, loaded in the order of `EDITOR_JS` in `serve.py` and
injected into dev builds only (`/__rv__/<name>`; never shipped into decks —
`test_deck_reveal_js_ships_no_editor_assets` enforces this). Each module is
an IIFE; nothing leaks except the shared namespace below.

## Shared namespace

- `window.RV` — created by `core.js`, reused by every other module.
- `RV.state` (alias `S`) — THE mutable editor state. Meaningful transitions
  (`on`, `sel`, `splitPref`) go through the bus: `RV.set(key, value)`
  notifies `RV.onChange(key, fn)` listeners on real change; `RV.emit(key)`
  forces notification (used by `setEdit`, whose transition is applied
  piecemeal). Hot-path internals (`hover` during mousemove, `drag`,
  `dropState`, nudge timers) write `S` directly and repaint via
  `syncChrome`.
- `RV.fn` (alias `F`) — cross-module functions. Call sites in other modules
  always use property access (`F.foo(...)`), never top-level aliases:
  property lookup at call time makes load order irrelevant.
- `RV.esc` / `RV.ui.box` — HTML escaping and the shared floating-box chrome
  (header, action buttons, ✕, toggle-by-remove).
- `RV.token`, `RV.PRES_NAME`, `RV.MOVABLE` — shared constants.
- `F.fileOf(el)` / `F.fileSha(pathOrIdx)` / `F.filePath(idx)` — the multi-file
  provenance table (`<meta rv-src-files>`): an element's owning include path
  ("" = main), and each file's boot sha. Edits and `/src`|`/inspect` fetches
  pass this file so include line numbers and shas stay file-local.

## Modules (load order)

| module | role |
|---|---|
| `core.js` | RV bootstrap, state bus, `ui.box`, escapeHtml, reload persistence, toast, construct helpers (`srcOf`/`kindOf`/…), the multi-file table (`fileOf`/`fileSha`/`filePath` from `<meta rv-src-files>`) |
| `net.js` | edit FIFO queue (line-preserving ops chain on a PER-FILE response sha so include and main edits never cross; structural ops flush), reload deferral (5 s force-fire), undo/redo, epoch-guarded `fetchSrc(…, file)`. `rvPostEdit(edits, file)` / `fetchSrc(…, file)` take an optional owning file ("" = main .pres) |
| `chrome.js` | build-error overlay, hover/select outlines, breadcrumb, `setEdit`, THE single document keydown handler |
| `drag.js` | grips, drag state machine, column-split snapping, keyboard nudges (`queueNudge`/`flushNudge`) |
| `blockmove.js` | block-move drop targets, slot bar, drag ghost, OS-file drop insertion |
| `drawer.js` | fragment drawer (list + reorder) |
| `format.js` | inline-format toolbar (bold/italic/color/size on the source box) |
| `textsel.js` | selection bubble: maps rendered-text selections to source columns via `/__rv__/inspect` (per-file), posts `wrap_span` against the paragraph's owning file (included paragraphs editable) |
| `inline-edit.js` | double-click in-place paragraph editing: reverse-renders the edited DOM to DSL source, posts `replace_lines` to the paragraph's owning file (included paragraphs editable) |
| `panel.js` | side panel: breadcrumbs (owning-file tag for includes), parameter fields, source box + Apply, SVG step editor, sibling move/delete — all routed to the selected element's file (`fileOf`); whole included slides edit their file too |
| `history.js` | time machine: snapshots, diffs, peek overlay, restore |
| `outline.js` | slide outline sidebar (list, navigate, add/duplicate/move/delete slides); included slides are navigate-only ("(included)"), never moved cross-file |
| `shell.js` | toolbar, status chip, help box, media import, HTML/PDF export buttons |
| `split.js` | docked split view, divider, persisted width |
| `boot.js` | `?rv-*` debug/test hooks, SSE connect, toolbar build |

## Testing

`data/js/test/` (wheel-excluded) holds the in-browser harness: `rvt.js`
(runner; EventSource stub, fetch stub, iframe/until helpers) plus
`suite-*.js`. The dev server serves a runner page at `/__rv__/test`
(test-mode only); `tests/test_editor_js.py` drives it with headless Chrome
and collects results from `/__rv__/test-results`. Run from `tests/`:
`pytest -q test_editor_js.py` (needs Chrome and a reveal.js checkout at
`Demo/reveal.js`; CI's browser job caches one).
