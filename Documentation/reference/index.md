# Reference

The complete surface of Revealer, in four pages:

- [Constructs](constructs.md) — every block construct of the `.pres`
  language: opener syntax, parameters, end tokens, CSS classes.
  **Generated from the grammar registry** (`src/revealer/grammar.py`), the
  same table that drives the parser and the browser editor — it cannot
  drift from the code.
- [Contextual directives](directives.md) — `size` / `align` /
  `paragraph-spacing` and their position-dependent scope. Also generated.
- [Settings & directives](settings.md) — every `> key: value` presentation
  setting and per-slide directive.
- [Command-line tool](cli.md) — every `revealer` sub-command.

```{toctree}
:maxdepth: 2

constructs
directives
settings
cli
```
