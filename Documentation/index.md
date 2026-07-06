# Revealer

Revealer turns a **plain-text `.pres` file** into a polished
[reveal.js](https://revealjs.com/) presentation — and pairs it with a
**live, in-browser WYSIWYG editor** that writes every change back into that
same text file.

In a mindset close to LaTeX, one readable source holds the whole talk:
settings, slides, layout, math, figures, citations. Media live in a folder
next to it. The `revealer` command manages the reveal.js engine and its
plugins for you, serves the deck with live reload while you write, and
exports self-contained HTML or a lossless PDF.

## A 30-second taste

A presentation can be as small as this:

```text
>>> first: Diffusion in crowded media
> subtitle: Group seminar

=== The question

How does crowding change the propagator?

* Anomalous exponents
* Finite-size effects

> eq +
\langle x^2(t) \rangle \sim t^\alpha
```

Save it as `talk.pres` and run:

```bash
revealer talk.pres
```

Your browser opens on the deck; every save rebuilds and reloads it in place,
and the ✏ button switches to edit mode — click, drag and type directly on
the slides, with each change written back to `talk.pres` as a minimal text
edit.

## Simple demo

<div class="rv-home-demo">

```html
>>> first: Simple Revealer demo
> subtitle: A tiny `.pres` file

=== First slide

A slide can be just a title and a few lines of HTML. <br>

* Write text
* Add bullets
* Save and build

--- A vertical sub-slide

Use <code>---</code> to create a slide below the previous one.
```

<iframe src="Simple.html" title="Simple Revealer demo"></iframe>

</div>

<p class="rv-complete-link"><a href="Demo.html">Open the complete demo</a></p>

## Contents

```{toctree}
:maxdepth: 2
:caption: Getting started

quickstart
installation
```

```{toctree}
:maxdepth: 2
:caption: Guides

authoring
editor
figures
themes
svg
bibliography
recipes
```

```{toctree}
:maxdepth: 2
:caption: Reference

reference/index
```

```{toctree}
:maxdepth: 1
:caption: Contributing

internals
```
