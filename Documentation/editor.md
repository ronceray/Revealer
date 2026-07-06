# The browser editor

```bash
revealer talk.pres
```

Pointing `revealer` at a `.pres` file (or its folder) serves the deck with
rebuild-on-save and live reload, and layers a WYSIWYG editor on top of it
in the browser. The two workflows mix freely: type in your text editor,
click and drag in the browser — both write to the same file.

**You are always editing the `.pres` source file, never the HTML.** Every
change made in the browser is written to it immediately as a minimal text
edit (a session diffs like hand edits), the deck rebuilds, and the preview
reloads in place, keeping your slide, edit mode and selection. There is no
separate save step.

## The toolbar

The served presentation carries a small toolbar (top left):

| Button | Action |
| --- | --- |
| **✏ Edit** | Toggle edit mode (`E`). |
| **↶ / ↷** | Undo / redo (`Ctrl+Z` / `Ctrl+Shift+Z`). |
| **☰** | Fragment drawer (`F`) — the slide's reveal sequence. |
| **▤** | Slide outline sidebar (`O`). |
| **＋ Media** | Import an image or movie into `Media/` and insert it. |
| **⇔** | Toggle the split view (deck left, panel right, draggable divider). |
| **🕐** | Save history — the time machine. |
| **⬇ HTML / ⬇ PDF** | Export the final `talk.html` / `talk.pdf` next to the `.pres`. |
| **?** | Help card with all of the above. |

The status chip next to the toolbar names the `.pres` file being edited and
reports every save.

## Edit mode: selecting and inspecting

Press `E` (or click **✏ Edit**). Hovering names the element under the
cursor; clicking selects it. The **side panel** then shows everything about
the selection:

- with nothing selected, the **whole slide's source**, editable in place;
- a clickable **breadcrumb** (slide ▸ row ▸ column ▸ figure) to reach
  enclosing constructs — no guessing what you clicked; `Escape` also
  selects the parent;
- **parameter fields** — pin x/y/width, media height/width, row height and
  gap, column size, grid gap, fragment index, … — type a value and press
  `Enter`;
- **▲ Up / ▼ Down / 🗑 Delete** to reorder a block among its siblings or
  remove it (`Del` deletes the selection too — `Ctrl+Z` undoes);
- a **format bar** and a collapsible **command cheatsheet** of the frequent
  `.pres` shortcuts;
- the **source box**: the actual `.pres` lines of the selection, editable
  in place (*Apply source*) — anything the quick fields don't cover.

The panel docks to the side of the deck; the **⇔** button switches to a
split view with the deck on the left and the panel on the right, divider
draggable.

## Direct manipulation

- **Drag handles** move pins and resize media, rows, stacks and column
  splits (with fraction snapping — `2/5` stays `2/5`-shaped).
- The square **grip** drags a whole block into another column or slot.
- **Arrow keys** nudge the selection; `Shift` makes bigger steps.
- **Dropping** an image or movie file onto a column uploads it into
  `Media/` and inserts the matching `!` / `!!` line — same as **＋ Media**.

## Keyboard summary

| Key | Action |
| --- | --- |
| `E` | Toggle edit mode. |
| Click | Select the element under the cursor. |
| `Escape` | Select the enclosing construct (walk up the breadcrumb). |
| Arrow keys | Nudge the selection (`Shift` = bigger steps). |
| `Del` | Delete the selection. |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo. |
| `F` | Fragment drawer. |
| `O` | Outline sidebar. |

Shortcuts never fire while you are typing in a field or text box.

## Fragment drawer

`F` (or **☰**) opens a drawer listing the current slide's fragments — every
`+`-flagged element and `> frag` block — in reveal order. Drag entries to
reorder the sequence; the `data-fragment-index` flags in the source are
rewritten accordingly.

## Outline sidebar

`O` (or **▤**) opens a sidebar listing every slide. From there you can
navigate, **add**, **duplicate**, **reorder** (drag) and **delete** slides
— whole-slide operations that would be tedious as text edits.

(save-history)=

## Save history — the time machine

The **🕐** button opens the save history. While the server runs, every
change to the `.pres` (from the browser *or* from your text editor) is
auto-committed to a shadow git repository inside the deck folder
(`.rv-history/` — invisible to your own git, no setup required):

- **Snapshot…** records a labelled snapshot ("before big rework");
- each entry offers **Diff** (what changed), **Peek** (a read-only preview
  of the deck as it was — the working file is untouched) and **Restore**;
- restoring first snapshots the current state, so nothing is ever lost, and
  **undo keeps working across restores**: `Ctrl+Z` after a restore brings
  you back.

Undo/redo itself is a cursor walking this same history, so it covers
browser edits *and* saves made in your text editor. If the file changed on
disk since the page's last sync, an edit is refused and the page resyncs —
nothing is ever overwritten blindly.

## Build errors

If a save produces a build error, the browser shows the error as an
overlay — with an *open in editor* button (uses `$REVEALER_EDITOR`, VS
Code's `code -g`, or `$EDITOR`) — while the last good version keeps being
served. Fix the line, save, and the deck reloads.

## Included files

Slides pulled in with `> include:` rebuild on save like the main file, but
are **read-only in the editor** — the panel names the file they come from;
open that file (or serve it directly) to edit them.

## Scope and safety

- The server binds to `127.0.0.1` only and serves a separate
  `<name>.dev.html` artifact, deleted on exit; the exported `<name>.html`
  is only written by `revealer build` or the ⬇ HTML button.
- Every edit is guarded by a checksum of the file it was computed against;
  concurrent hand edits can never be clobbered.
- The editor layer exists only in dev builds — exported decks contain none
  of it.
