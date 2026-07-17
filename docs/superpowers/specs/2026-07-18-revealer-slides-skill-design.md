# Design: `revealer-slides` — a Claude Code skill for authoring `.pres` presentations

- **Date:** 2026-07-18
- **Status:** approved (brainstormed and validated section-by-section)
- **Repo:** Revealer (this repository)

## Problem

Writing a talk with Claude today means re-explaining the `.pres` language every
session, and Claude has no standing instructions for the build/verify loop, so
it either guesses syntax or produces slides nobody looked at. Revealer already
generates its human documentation from the grammar registry; the same machinery
can keep an agent-facing skill permanently in sync.

## Goal

A Claude Code skill that makes any Claude session a competent Revealer slide
author: it knows the `.pres` DSL, scaffolds or locates decks, writes idiomatic
slides, builds them, and visually verifies the result with headless-Chrome
screenshots before calling the work done.

## Decisions (made during brainstorming)

1. **Home: repo source + personal install.** The skill lives in this repo at
   `.claude/skills/revealer-slides/` (versioned, regenerable, later shippable
   to all Revealer users). A symlink from `~/.claude/skills/revealer-slides`
   activates it in every Claude session on the machine — including talk
   folders, where slide-writing actually happens. The repo lives in Dropbox,
   so the symlink target is stable across machines and the installed skill
   always tracks the working tree.
2. **Scope: full loop.** Scaffold → author → build → screenshot-verify →
   iterate → export. Not authoring-only: slides that were never looked at are
   usually broken slides.
3. **Sync strategy: generated reference (approach A).** The skill's syntax
   reference is emitted from `src/revealer/grammar.py` by
   `Documentation/gen_reference.py` — the same generator that produces
   `Documentation/reference/constructs.md` and the editor cheatsheet. The
   hand-written parts are only what generation cannot produce: workflow,
   idiomatic patterns, failure signatures.

## Non-goals

- Revealer *development* knowledge (grammar/editor/runtime internals,
  scratchpad-venv workflows). The skill is for writing talks and says so.
- A distribution mechanism for other users (`revealer skill install`, plugin
  packaging). Explicitly future work; v1 only documents the symlink install.
- Driving the live browser editor over CDP. The skill's verification is
  build + static screenshots; a human watching `revealer serve` already has
  live reload.

## Anatomy

```
Revealer/.claude/skills/revealer-slides/
├── SKILL.md                  hand-written — workflow + golden rules (~150 lines)
├── references/
│   ├── syntax.md             GENERATED from grammar.py by gen_reference.py
│   ├── patterns.md           hand-written — idiomatic .pres patterns, verified snippets
│   └── verify.md             hand-written — build diagnostics + screenshot loop
└── scripts/
    └── snap.sh               screenshot helper (slide N, optional fragment forcing)
```

## SKILL.md

The only file always loaded into context, so it stays lean (~150 lines).

- **Frontmatter.** `name: revealer-slides`; description names the triggers
  explicitly: *"Author and edit Revealer `.pres` presentations. Use when the
  user asks for slides, a talk, a deck, a presentation, or mentions
  `.pres`/Revealer."*
- **Workflow.**
  1. *Locate or scaffold.* Find the `.pres` in scope, or `revealer new NAME
     --here` for a fresh talk. Ensure a `reveal.js/` engine sits next to the
     `.pres` (`revealer update <dir>` downloads it).
  2. *Author.* Golden rules below; open `references/syntax.md` before writing
     any construct you are not sure of; media files go in `Media/`.
  3. *Build.* `revealer build <target>`; on failure read the file:line
     diagnostics, fix, rebuild.
  4. *Verify.* Screenshot the slides you changed with `scripts/snap.sh`;
     check for overflow, missing media, broken layout. Full-deck sweep before
     declaring a talk done.
  5. *Export.* `revealer pdf <target>` on request.
- **Golden rules.** The ~15 lines that prevent most parse errors: `===` new
  slide, `---` vertical slide, `%%%` section, `>>>` special slides
  (`first:`, `biblio`); settings as `> key: value`; block constructs open
  with `> name` and close with `> end: name`; `||` starts a text column;
  fragments `+` / `+N`; media
  `! file | caption` and `!! movie`; math `$…$` / `$$…$$`; `@@` code;
  `[ … ]` highlight; `#` comments; raw HTML allowed anywhere.
- **Routing table.** When to open each reference: construct parameters →
  `syntax.md`; composing a layout → `patterns.md`; build failure or visual
  check → `verify.md`. Progressive disclosure keeps the per-session cost
  near zero until needed.

## Generated reference: `references/syntax.md`

- **Emitter.** `Documentation/gen_reference.py` gains one more output, written
  from the same grammar registry as `reference/constructs.md`: the quick
  syntax card, per-construct entries (opens-with / closed-by / parameters /
  directives), then the settings and directives tables — a compact merge of
  today's `constructs.md` + `settings.md` + `directives.md`.
- **Format.** Plain Markdown for a machine author: example-first, no
  Sphinx/MyST roles or cross-references that only resolve in the docs site.
- **Header.** Same `GENERATED FILE — DO NOT EDIT` banner naming
  `src/revealer/grammar.py` as source of truth and the regenerate command.
- **Lifecycle.** Regenerates on every manual `python3
  Documentation/gen_reference.py` and automatically at every Sphinx build via
  `conf.py` — any grammar change that updates the docs updates the skill in
  the same commit. Sphinx stays `-W`-clean.
- **Drift test.** A test in `tests/` runs the generator into a temp dir and
  asserts the emitted file exists and contains every construct name in the
  registry, so drift is caught even when nobody builds the docs.

## Patterns: `references/patterns.md`

Distilled from `authoring.md`/`recipes.md`. Each pattern is one sentence of
*when to use* plus one `.pres` snippet:

title slide (`>>> first:` + subtitle) · two-column text+figure ·
`> fill` canvas layouts · grid of cards · stack/layer build-ups · pins ·
callouts and framed equations with fragments · tables · citations
(`.bib` setup) · speaker notes · SVG animation steps · `figs.py`
self-updating figures.

**Every snippet must build.** During implementation the snippets are assembled
into a kitchen-sink deck, built with the working-tree `revealer`, and
screenshotted — no unproven syntax ships in the skill. The build (not the
screenshots) joins `tests/` so CI keeps the snippets honest.

## Verification: `references/verify.md` + `scripts/snap.sh`

- **`snap.sh <built.html> <slide> <out.png> [--fragments]`.** Copies the built
  HTML to a temp file; with `--fragments` injects
  `<style>.fragment{opacity:1 !important; visibility:visible !important}</style>`
  (the same trick `pdf.py` uses) so hidden fragment content is visible; then
  `google-chrome --headless=new --screenshot=<out> --window-size=1920,1080
  "file://…#/N"`. Falls back to `chromium`; `#/N/M` reaches vertical slides.
- **Protocol.** Screenshot only the slides you changed; full-deck sweep before
  declaring the talk done. What to look for: clipped or overflowing text,
  broken-image icons, unbalanced columns, fragments that never reveal.
- **Degradation.** If `revealer` is missing, point at the pipx install; if
  Chrome is missing, skip the visual step with an explicit warning rather than
  fail. When the user is watching a `revealer serve` session, the browser
  already follows every save — screenshots are redundant; say so instead of
  burning tokens.

## Install and documentation

- Personal install (v1, this machine):
  `ln -s <repo>/.claude/skills/revealer-slides ~/.claude/skills/revealer-slides`
- A short "Claude Code skill" note in `Documentation/installation.md` with the
  symlink one-liner, making the skill a documented, shippable feature of the
  project.

## Validation layers

1. Generator drift test in `tests/` (syntax.md exists, covers every construct).
2. Kitchen-sink deck built from every `patterns.md` snippet (build in CI;
   screenshots during implementation).
3. Dogfood: fresh Claude session in a scratch talk folder, "make me a 5-slide
   talk", observe the skill trigger and run the loop end to end.
4. Docs note published; Sphinx build stays `-W`-clean.

## Future work (explicitly out of v1)

- `revealer skill` CLI verb (or plugin packaging) to install/update the skill
  for end users without cloning the repo.
- Editor-driving verification over CDP for animation/timing checks.
