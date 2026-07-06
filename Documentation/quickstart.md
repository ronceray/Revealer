# Quickstart

From nothing to an edited, exported talk in five commands.

## 1. Install

```bash
git clone https://github.com/ronceray/Revealer.git
cd Revealer
pipx install .
```

This puts the `revealer` command on your PATH with all its Python
dependencies isolated. See [Installation](installation.md) for details and
the optional external tools (headless Chrome for PDF export, `pdftocairo`
for PDF figures).

## 2. Create a presentation

```bash
revealer root ~/Presentations   # once: where your talks live
revealer new MyTalk
```

`revealer new` scaffolds a folder under the root: a pre-filled
`MyTalk.pres`, a downloaded reveal.js engine with the extensions you pick,
and a `.revealer.toml` recording the exact versions. Use
`revealer new MyTalk --here` to create it in the current directory instead.

## 3. Open it — write and edit live

```bash
revealer MyTalk/MyTalk.pres
```

Pointing `revealer` straight at a `.pres` file (or its folder) starts the
dev server: the deck opens in your browser and rebuilds + reloads on every
save, keeping your slide. The toolbar in the top-left corner is the
[browser editor](editor.md):

- **✏ Edit** (or press `E`) — click any element on a slide to select it,
  then edit it in the side panel, drag its handles, or nudge it with the
  arrow keys;
- every change is written **into `MyTalk.pres` itself** as a minimal text
  edit — there is no separate save, and you can keep a text editor open on
  the same file at the same time.

Prefer typing? Edit `MyTalk.pres` in your editor of choice and just save —
the browser follows. The [authoring guide](authoring.md) covers the whole
language; the essentials:

```text
=== A slide title            # === starts a slide, --- a vertical one

Plain text, **bold**, $E=mc^2$ and raw HTML all work.

* bullets
  * nested bullets

! Media/figure.png | caption # images: drop the file in Media/
```

## 4. Export

```bash
revealer build MyTalk        # -> MyTalk/MyTalk.html (self-contained deck)
revealer pdf MyTalk          # -> MyTalk/MyTalk.pdf  (one page per slide)
```

Both are also one click away in the served deck's toolbar (⬇ HTML /
⬇ PDF).

## Where to go next

- [Authoring guide](authoring.md) — the `.pres` language, end to end.
- [The browser editor](editor.md) — everything the WYSIWYG layer can do.
- [Figures pipeline](figures.md) — regenerate matplotlib/TikZ figures at
  every build, theme-matched.
- [Reference](reference/index.md) — every construct, directive, setting and
  CLI command.
