# Figures pipeline

Revealer treats figures as build products: the `.pres` references image
files, and the deck build can regenerate them from your scripts so slides
never drift out of sync with the analysis.

## PDF figures

`! fig.pdf` (or `> svg: fig.pdf`) converts the PDF to SVG on the fly with
`pdftocairo` and caches the result in `Media/.rv-cache/` keyed on the file's
mtime — TikZ output, journal figures and matplotlib PDFs drop straight in.

## Build hooks

A `> build:` line in the settings block runs a shell command from the deck
folder before every compile (and on every save in `revealer serve`):

```
> title: My talk
> build: python figs.py
```

Use it to regenerate plots from data. Hooks time out after 300 s and a
failing hook aborts the build with its output shown.

## Theme-matched matplotlib styles

Every theme ships a palette-matched matplotlib style next to its CSS, copied
into each deck at `reveal.js/dist/theme/<theme>.mplstyle` (large slide-ready
fonts, theme color cycle, no chartjunk):

```python
# figs.py
import matplotlib
import matplotlib.pyplot as plt

plt.style.use("reveal.js/dist/theme/sfi.mplstyle")

fig, ax = plt.subplots(figsize=(6, 4))
ax.plot(x, y, label="theory")
ax.set_xlabel(r"$t/\tau$")
ax.legend()
fig.savefig("Media/decay.pdf")
```

```
> build: python figs.py

=== Results
! decay.pdf
```

The figure inherits the deck's colors and stays legible from the back of the
room; the PDF→SVG conversion keeps it vector all the way to the screen.
