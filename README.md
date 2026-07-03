# Revealer

Revealer is an overlay of [reveal.js](https://revealjs.com/) designed to easily
create beautiful scientific presentations.

In a mindset close to LaTeX, a presentation is a single text file (`.pres`)
holding both its parameters and its content; media live in an associated folder.
A command-line tool downloads and updates the reveal.js engine and its plugins
for you, and a near-WYSIWYG loop is available inside VS Code.

📖 **Full documentation: <https://candelierlab.github.io/Revealer>**

## Installation

Requires Python ≥ 3.11. [pipx](https://pipx.pypa.io/) is recommended:

```bash
git clone https://github.com/CandelierLab/Revealer.git
cd Revealer
pipx install .
```

This installs the `revealer` command, together with all its Python
dependencies (`typer`, `questionary`, `rich`, `tomli-w`, `bibtexparser`) in an
isolated environment — there is nothing else to install by hand.

## Quick start

```bash
revealer root ~/Presentations   # remember where presentations live
revealer new MyTalk             # scaffold a folder + reveal.js + MyTalk.pres
revealer build MyTalk           # generate the HTML
```

Other commands: `revealer serve` (live reload while you edit), `revealer open`,
`revealer pdf`, `revealer select`, `revealer list`, `revealer plugins`,
`revealer update [--force]`. See the
[CLI documentation](https://candelierlab.github.io/Revealer/cli.html).

## Live editing

`revealer serve MyTalk` builds the deck, opens it in your browser, and then
rebuilds + reloads on every save — keeping your place, and showing build
errors in an overlay. No editor extensions needed; a VS Code-based loop is
also described in the
[installation guide](https://candelierlab.github.io/Revealer/installation.html).

## A `.pres` file at a glance

```
# --- SETTINGS ---
> author: First author
> event: Somewhere, 01/01/2026
> theme: revealer
> slideNumber: c/t

# --- CONTENT ---
>>> first: My presentation
> subtitle: Based on reveal.js

=== A slide
This slide is <i>very</i> informative.

* Bullet one
* Bullet two
```

The full syntax (slides, columns, code, citations, dark mode, SVG animation, …)
is documented at <https://candelierlab.github.io/Revealer>.

## Themes

Two themes ship in: `revealer` (default, neutral) and `ljp` (Laboratoire Jean
Perrin branding). Any stock reveal.js theme also works. Select one with
`> theme: <name>` in the settings.

## License

reveal.js is © Hakim El Hattab and released under the MIT license.
