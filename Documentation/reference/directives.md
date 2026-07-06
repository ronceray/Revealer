<!-- GENERATED FILE — DO NOT EDIT.
     Source of truth: src/revealer/grammar.py
     Regenerate with:  python3 Documentation/gen_reference.py
     (also runs automatically at every Sphinx build via conf.py) -->

# Contextual directives

These directives take their **scope from where they are written**
(see [authoring › sizes and alignment](../authoring.md#sizes-and-alignment)):
attached to a paragraph they style that paragraph; alone at the top of
a slide or column they set that scope's default; in the settings block
they set the presentation default.

| directive | aliases | scopes | consumed on `> fill` slides |
| --- | --- | --- | --- |
| `> size:` | — | slide, block, paragraph | yes |
| `> align:` | — | slide, block, paragraph | yes |
| `> paragraph-spacing:` | `paragraph_spacing` | slide, block, paragraph | yes |

```{note}
Only the *contextual* directives live in this registry. The many
fixed-scope `> key: value` parameters (settings, per-slide options,
table/grid options) are listed in [Settings & directives](settings.md).
```
