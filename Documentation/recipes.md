# Recipes

Task-oriented workflows that combine the pieces documented elsewhere.

## Self-updating figures

Treat figures as build products: reference `fig.pdf` from the slides, let a
`> build:` hook regenerate it from your analysis script, and let the
[figures pipeline](figures.md) convert it to SVG on the fly:

```text
> build: python figs.py

=== Results
! decay.pdf
```

Every build (and every save under `revealer serve`) reruns the script, so
the deck can never drift out of sync with the data. See
[Figures pipeline](figures.md) for PDF→SVG caching and the details of
build hooks.

## Plots that match the theme

Every theme ships a palette-matched matplotlib style, copied into each deck
at `reveal.js/dist/theme/<theme>.mplstyle` (slide-ready font sizes, the
theme's color cycle, no chartjunk):

```python
# figs.py
import matplotlib.pyplot as plt

plt.style.use("reveal.js/dist/theme/revealer.mplstyle")

fig, ax = plt.subplots(figsize=(6, 4))
ax.plot(x, y, label="theory")
ax.set_xlabel(r"$t/\tau$")
ax.legend()
fig.savefig("Media/decay.pdf")
```

Combined with the recipe above, a theme change restyles the plots at the
next build. To make your own theme (CSS variables + an `.mplstyle`), see
[Themes](themes.md).

## Managing citations

Point the deck at your BibTeX file once, cite per slide, and add an
auto-generated bibliography section:

```text
> bibtex: refs.bib

=== Related work
> cite: smith2026
A key result was reported<ref:smith2026>.

>>> biblio
```

Short citations appear in the slide footer; `>>> biblio` renders the full,
paginated list. Details in [Bibliography](bibliography.md).

## Assembling a lecture course with include

Keep each lecture in its own `.pres` and assemble master decks with
`> include:`:

```text
# course.pres
>>> first: Statistical Physics — full course

> include: lecture-01/lecture-01.pres
> include: lecture-02/lecture-02.pres
> include: lecture-03/lecture-03.pres
```

- Includes are expanded at build time, recursively; paths resolve relative
  to the including file and must stay inside the deck folder.
- While serving the master deck, saving *any* included file rebuilds it —
  but included slides are read-only in the [browser editor](editor.md);
  serve the individual lecture to edit it there.
- The same mechanism factors out a shared preamble (macros, settings) or a
  standard closing slide across many talks.

## Reproducible decks

A presentation folder is self-contained and rebuildable years later:

- `.revealer.toml` records the enabled extensions, the reveal.js version
  and the **commit pins** of every third-party plugin. Rebuilding or
  re-installing a deck (`revealer update`, an implicit setup) re-downloads
  exactly what is recorded — not whatever the plugins' branches have moved
  to.
- `revealer update --force MyTalk` deliberately re-pins to the versions
  shipped with your current Revealer and rewrites the record — the
  recommended way to migrate an old deck forward.
- `> macros:`, `> bibtex:` and `> build:` all reference files inside the
  deck folder, so the folder (plus your figure scripts) is the complete
  archive of the talk. The `.rv-history/` shadow repository created by the
  editor adds a local save history on top.

## PDF handouts, one page per fragment

`revealer pdf MyTalk` exports one fully-revealed page per slide — right for
a handout. For a PDF that steps through the talk the way the audience saw
it, set:

```text
> pdfSeparateFragments: true
```

and each fragment state becomes its own page. See
[`revealer pdf`](reference/cli.md#revealer-pdf-target) for the export
mechanics and requirements.
