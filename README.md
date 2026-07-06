# Revealer

Revealer turns a **plain-text `.pres` file** into a polished
[reveal.js](https://revealjs.com/) presentation — and pairs it with a
**live, in-browser WYSIWYG editor** that writes every change back into that
same text file.

In a mindset close to LaTeX, one readable source holds the whole talk:
settings, slides, layout, math, figures, citations. Media live in a folder
next to it. The `revealer` command manages the reveal.js engine and its
plugins for you.

📖 **Full documentation: <https://ronceray.github.io/Revealer/>**

## Install and run

Requires Python ≥ 3.11. [pipx](https://pipx.pypa.io/) is recommended:

```bash
git clone https://github.com/ronceray/Revealer.git
cd Revealer
pipx install .
```

```bash
revealer new talk        # scaffold: folder + reveal.js + talk.pres
revealer talk/talk.pres  # serve it: live reload + browser editor
```

Pointing `revealer` at a `.pres` file is all it takes: the deck opens in
your browser, rebuilds on every save, and the ✏ button switches to edit
mode — click, drag and type directly on the slides, with each change
written back to the `.pres` as a minimal text edit.

## A `.pres` file at a glance

```
# --- SETTINGS ---
> author: Your name
> event: Somewhere, 01/01/2026
> theme: revealer
> slideNumber: c/t

# --- CONTENT ---
>>> first: My presentation
> subtitle: Based on reveal.js

=== A slide

Plain text, **bold**, $E = mc^2$ and raw HTML all work.

* Bullet one
* Bullet two

=== A figure-heavy slide
> fill
> row
> col 2/5 center
! Media/setup.png | The setup
> col 3/5
> eq +
\langle x^2(t) \rangle = 2 D t
> end: row
```

## Features

- **WYSIWYG browser editor** — select, drag, resize, reorder; side panel
  with parameter fields and the live source; fragment drawer; slide
  outline; undo/redo and a shadow-git **save history** with snapshots,
  diffs and restores. Everything writes minimal edits to the `.pres`.
- **Layout DSL** — rows/columns, grids of cards, media stacks, pinned
  overlays, callout boxes, framed equations; everything can reveal as a
  fragment.
- **Figure pipeline** — PDF figures auto-convert to SVG, `> build:` hooks
  regenerate plots before every compile, and each theme ships a matching
  matplotlib style.
- **Math** — KaTeX, bundled offline, with your own LaTeX macros
  (`> macros: defs.tex`).
- **PDF export** — lossless, one page per slide or per fragment state.
- **Lecture courses** — assemble master decks from per-lecture files with
  `> include:`.
- **Reproducible decks** — reveal.js version and plugin commits are pinned
  per presentation in `.revealer.toml`.

## Requirements beyond Python

All Python dependencies install automatically. Some features use external
tools and degrade gracefully without them: **git** (save history),
**Chrome/Chromium + `img2pdf`** (PDF export), **`pdftocairo`** from
poppler-utils (PDF figures).

## About this fork

This is a fork of
[CandelierLab/Revealer](https://github.com/CandelierLab/Revealer),
extending it with the layout DSL, the browser editor, the figure pipeline
and PDF export. See [CHANGELOG.md](CHANGELOG.md).

## License

MIT. reveal.js is © Hakim El Hattab and released under the MIT license.
