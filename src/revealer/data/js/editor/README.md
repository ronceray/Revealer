# The Revealer editor (dev-server WYSIWYG layer)

Thirteen modules, loaded in the order of `EDITOR_JS` in `serve.py` and
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

## Modules (load order)

| module | role |
|---|---|
| `core.js` | RV bootstrap, state bus, `ui.box`, escapeHtml, reload persistence, toast, construct helpers (`srcOf`/`kindOf`/…) |
| `net.js` | edit FIFO queue (line-preserving ops chain on the response sha; structural ops flush), reload deferral (5 s force-fire), undo/redo, epoch-guarded `fetchSrc` |
| `chrome.js` | build-error overlay, hover/select outlines, breadcrumb, `setEdit`, THE single document keydown handler |
| `drag.js` | grips, drag state machine, column-split snapping, keyboard nudges (`queueNudge`/`flushNudge`) |
| `blockmove.js` | block-move drop targets, slot bar, drag ghost, OS-file drop insertion |
| `drawer.js` | fragment drawer (list + reorder) |
| `format.js` | inline-format toolbar (bold/italic/color/size on the source box) |
| `panel.js` | side panel: breadcrumbs, parameter fields, source box + Apply, SVG step editor, sibling move/delete, cheatsheet |
| `history.js` | time machine: snapshots, diffs, peek overlay, restore |
| `outline.js` | slide outline sidebar (list, navigate, add/duplicate/move/delete slides) |
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
