# revealer-slides Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code skill (`.claude/skills/revealer-slides/`) that makes any Claude session a competent Revealer slide author, with its syntax reference generated from `grammar.py` so it can never drift.

**Architecture:** Four skill files — a lean hand-written `SKILL.md` (workflow + golden rules), a **generated** `references/syntax.md` (emitted by `Documentation/gen_reference.py` from the grammar registry, committed like `reference/constructs.md`), a hand-written `references/patterns.md` whose every ```` ```pres ```` snippet is build-verified by a test, a hand-written `references/verify.md`, plus `scripts/snap.sh` (headless-Chrome slide screenshots). Two new tests keep the generated file current and the patterns honest. A docs note ships the symlink install.

**Tech Stack:** Python ≥ 3.11 stdlib (generator), pytest (existing suite conventions), bash (snap.sh), Sphinx/MyST (docs note).

**Spec:** `docs/superpowers/specs/2026-07-18-revealer-slides-skill-design.md`

## Global Constraints

- Repo root: `/home/ronceray/Dropbox/WORK/MYTOOLKITS/Revealer`. All paths below are relative to it; run all commands from it unless stated.
- Test environment: system python lacks the project deps. Create once and reuse:
  `python3 -m venv /tmp/rvskill-venv && /tmp/rvskill-venv/bin/pip install -q -e . pytest`
  Run tests as `/tmp/rvskill-venv/bin/pytest tests/ -q` (full suite must stay green after every task).
- `Documentation/gen_reference.py` stays **stdlib-only** (its docstring promises this).
- Generated files carry the existing `HEADER` banner verbatim and are **committed**; `gen_reference.generate()` only rewrites on content change (keeps Sphinx `-W` incremental builds clean).
- Sphinx must stay `-W`-clean (checked in Task 5).
- Commit messages follow the repo's `type(scope): summary` style and end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Do not touch `src/revealer/` — this feature changes no runtime/CLI code, so the user's pipx install needs no refresh.
- `.pres` syntax in every file below is authoritative from `Documentation/authoring.md` + `grammar.py`; if a kitchen-sink test warns, fix the snippet to the documented form — never weaken the zero-warnings assertion.

---

### Task 1: Generator emits the skill's syntax reference

**Files:**
- Modify: `Documentation/gen_reference.py`
- Create: `.claude/skills/revealer-slides/references/syntax.md` (generated output, committed)
- Test: `tests/test_skill_reference.py`

**Interfaces:**
- Consumes: `grammar.REGISTRY` / `grammar.DIRECTIVES` (existing), `Documentation/reference/settings.md` (inlined at generation time).
- Produces: `gen_reference.render_skill_syntax() -> str`; `gen_reference._directive_rows(g) -> list[str]`; `gen_reference._construct_section(spec, g, *, anchor: bool = True)`; module constant `SKILL_REFS: Path` = `<repo>/.claude/skills/revealer-slides/references`; the committed `syntax.md`. Tasks 3–4 rely on the directory `.claude/skills/revealer-slides/` existing after this task.

- [ ] **Step 1: Write the failing test**

Create `tests/test_skill_reference.py`:

```python
"""The skill's generated syntax reference stays in lockstep with the grammar.

`.claude/skills/revealer-slides/references/syntax.md` is a committed
generated file (like Documentation/reference/constructs.md). Regenerate
with `python3 Documentation/gen_reference.py` after touching grammar.py
or Documentation/reference/settings.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO / "Documentation") not in sys.path:
    sys.path.insert(0, str(REPO / "Documentation"))

import gen_reference  # noqa: E402

from revealer import grammar  # noqa: E402

SYNTAX = REPO / ".claude" / "skills" / "revealer-slides" / "references" / "syntax.md"


def test_syntax_md_is_committed_and_current():
    assert SYNTAX.is_file(), (
        "missing generated file — run python3 Documentation/gen_reference.py")
    assert SYNTAX.read_text(encoding="utf-8") == gen_reference.render_skill_syntax(), (
        "syntax.md is stale — run python3 Documentation/gen_reference.py")


def test_every_construct_and_directive_is_documented():
    text = SYNTAX.read_text(encoding="utf-8")
    for spec in grammar.REGISTRY.values():
        assert "## {0}".format(spec.label) in text, spec.name
    for d in grammar.DIRECTIVES.values():
        assert "`> {0}:`".format(d.name) in text, d.name


def test_no_myst_anchors_leak_into_the_skill_file():
    text = SYNTAX.read_text(encoding="utf-8")
    assert "(construct-" not in text
    assert "```{note}" not in text
```

- [ ] **Step 2: Run it to verify it fails**

Run: `/tmp/rvskill-venv/bin/pytest tests/test_skill_reference.py -q`
Expected: FAIL — `AttributeError: module 'gen_reference' has no attribute 'render_skill_syntax'` (or the `SYNTAX.is_file()` assert).

- [ ] **Step 3: Implement the generator changes**

In `Documentation/gen_reference.py`:

3a. Update the module docstring's page list (lines 6–9) to name three outputs:

```python
"""Generate the language reference pages from the grammar registry.

``src/revealer/grammar.py`` is the single source of truth for the ``.pres``
construct grammar (it also drives the parser, the semantic edit operations
and the browser editor's schema). This script projects that registry into
three Markdown pages:

- ``reference/constructs.md`` — one section per construct;
- ``reference/directives.md`` — the contextual directives table;
- ``../.claude/skills/revealer-slides/references/syntax.md`` — the
  agent-facing syntax reference bundled with the revealer-slides Claude
  Code skill (constructs + directives + an inlined copy of
  ``reference/settings.md``, MyST-free).

It runs automatically at every Sphinx build (wired into ``conf.py``), and
only rewrites a file when its content actually changed, so incremental
builds stay clean. The generated pages are committed: to refresh them by
hand, run ``python3 Documentation/gen_reference.py``.

Stdlib only — the grammar module itself has no third-party imports.
"""
```

3b. Below the `SRC = DOCS.parent / "src"` line, add:

```python
SKILL_REFS = DOCS.parent / ".claude" / "skills" / "revealer-slides" / "references"
```

3c. Make the anchor line optional in `_construct_section`. Replace its first line

```python
def _construct_section(spec, g) -> list[str]:
    out = ["(construct-{0})=".format(spec.name), "", "## {0}".format(spec.label), ""]
```

with

```python
def _construct_section(spec, g, *, anchor: bool = True) -> list[str]:
    out = ["(construct-{0})=".format(spec.name), ""] if anchor else []
    out += ["## {0}".format(spec.label), ""]
```

3d. Factor the directives table rows out of `render_directives`. Add above it:

```python
def _directive_rows(g) -> list[str]:
    rows = ["| directive | aliases | scopes | consumed on `> fill` slides |",
            "| --- | --- | --- | --- |"]
    for d in g.DIRECTIVES.values():
        rows.append("| {0} | {1} | {2} | {3} |".format(
            _code("> {0}:".format(d.name)),
            ", ".join(_code(a) for a in d.aliases) if d.aliases else "—",
            ", ".join(d.scopes),
            "yes" if d.on_fill else "no"))
    return rows
```

and in `render_directives`, replace the two table-header lines plus the `for d in g.DIRECTIVES.values(): out.append(...)` loop with:

```python
    out += _directive_rows(g)
```

(The prose lines before the table and the ```` ```{note} ```` block after it stay exactly as they are; only the header rows + loop are replaced.)

3e. Add the skill renderer after `render_directives`:

```python
def render_skill_syntax() -> str:
    """The agent-facing syntax reference bundled with the revealer-slides skill."""
    g = _grammar()
    out = [HEADER + "# .pres syntax reference", ""]
    out += [
        "The complete `.pres` language, generated from the grammar registry",
        "(`src/revealer/grammar.py`) — authoritative for every construct and",
        "parameter. The settings tables at the end are inlined from",
        "`Documentation/reference/settings.md`. Relative links refer to the",
        "Revealer documentation, not to files of this skill.",
        "",
    ]
    out += _cheat_card(g)
    out += ["## Construct index", ""]
    out.append("| construct | opens with | closed by | movable |")
    out.append("| --- | --- | --- | --- |")
    for spec in g.REGISTRY.values():
        out.append("| {0} | {1} | {2} | {3} |".format(
            spec.label,
            _code(_base_form(spec).split("  ")[0].strip()),
            _closed_by(spec, g).split(" (")[0],
            "yes" if spec.movable else "no"))
    out.append("")
    for spec in g.REGISTRY.values():
        out += _construct_section(spec, g, anchor=False)
    out += ["## Contextual directives", ""]
    out += [
        "These directives take their scope from where they are written:",
        "attached to a paragraph they style that paragraph; alone at the top",
        "of a slide or column they set that scope's default; in the settings",
        "block they set the presentation default.",
        "",
    ]
    out += _directive_rows(g)
    out.append("")
    settings = (DOCS / "reference" / "settings.md").read_text(encoding="utf-8")
    settings = settings.replace(
        "# Settings & directives", "# Settings & per-slide directives", 1)
    out.append(settings.rstrip())
    out.append("")
    return "\n".join(out).rstrip() + "\n"
```

3f. Register the third target in `generate()`:

```python
def generate() -> list[Path]:
    """Write the generated pages; return the paths that changed."""
    targets = {
        DOCS / "reference" / "constructs.md": render_constructs(),
        DOCS / "reference" / "directives.md": render_directives(),
        SKILL_REFS / "syntax.md": render_skill_syntax(),
    }
    return [p for p, text in targets.items() if _write_if_changed(p, text)]
```

- [ ] **Step 4: Generate the file and verify the tests pass**

Run: `python3 Documentation/gen_reference.py`
Expected: `wrote .claude/skills/revealer-slides/references/syntax.md` (the two reference pages report up to date — their content is unchanged by this task; if constructs.md/directives.md ARE rewritten, the refactor changed their bytes: diff and fix until `git diff Documentation/reference/` is empty).

Run: `git diff --stat Documentation/reference/` → empty; then `/tmp/rvskill-venv/bin/pytest tests/test_skill_reference.py -q`
Expected: 3 passed.

- [ ] **Step 5: Full suite + commit**

Run: `/tmp/rvskill-venv/bin/pytest tests/ -q` — all green.

```bash
git add Documentation/gen_reference.py .claude/skills/revealer-slides/references/syntax.md tests/test_skill_reference.py
git commit -m "feat(skill): generate agent-facing syntax reference from the grammar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: snap.sh — headless-Chrome slide screenshots

**Files:**
- Create: `.claude/skills/revealer-slides/scripts/snap.sh` (mode 755)

**Interfaces:**
- Consumes: a built `<Name>.html` sitting next to its `reveal.js/` + `Media/` (relative asset paths — this is why the `--fragments` temp copy MUST live in the same directory).
- Produces: `snap.sh <deck.html> <slide> <out.png> [--fragments]`; exit 0 = wrote screenshot, 1 = bad input, 2 = usage, 3 = no Chrome/Chromium on PATH. Tasks 4 and 6 call it with exactly this contract.

- [ ] **Step 1: Write the script**

Create `.claude/skills/revealer-slides/scripts/snap.sh`:

```bash
#!/usr/bin/env bash
# snap.sh — screenshot one slide of a built Revealer deck.
#
#   snap.sh <deck.html> <slide> <out.png> [--fragments]
#
#   <slide>      reveal.js index: N, or N/M for a vertical slide
#   --fragments  force every fragment visible (the same trick revealer pdf
#                uses), so hidden fragment content shows in the shot
#
# Exit codes: 0 ok, 1 bad input, 2 usage, 3 no Chrome/Chromium found.
set -euo pipefail

[ $# -ge 3 ] || { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
html=$1; slide=$2; out=$3; frag=${4:-}

[ -f "$html" ] || { echo "snap.sh: no such file: $html" >&2; exit 1; }

chrome=$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)
[ -n "$chrome" ] || { echo "snap.sh: no google-chrome/chromium on PATH — cannot verify visually" >&2; exit 3; }

src=$html
if [ "$frag" = "--fragments" ]; then
    # The copy must stay NEXT TO the original: the built HTML references
    # reveal.js/ and Media/ relative to its own directory.
    src=$(mktemp -p "$(dirname "$html")" --suffix=.html .snap-XXXXXX)
    trap 'rm -f "$src"' EXIT
    sed 's|</head>|<style>.fragment{opacity:1 !important; visibility:visible !important}</style></head>|' \
        "$html" > "$src"
fi

abs=$(readlink -f "$src")
"$chrome" --headless=new --disable-gpu --hide-scrollbars \
    --window-size=1920,1080 --screenshot="$out" \
    "file://$abs#/$slide" >/dev/null 2>&1
echo "$out"
```

- [ ] **Step 2: Syntax-check and exercise the failure paths**

```bash
bash -n .claude/skills/revealer-slides/scripts/snap.sh
chmod +x .claude/skills/revealer-slides/scripts/snap.sh
.claude/skills/revealer-slides/scripts/snap.sh || echo "usage exit: $?"
.claude/skills/revealer-slides/scripts/snap.sh nope.html 1 /tmp/x.png || echo "missing-file exit: $?"
```

Expected: no syntax errors; `usage exit: 2` after the usage text; `missing-file exit: 1`.

- [ ] **Step 3: Smoke-test against a real page**

```bash
printf '<html><head></head><body class="fragment">hello</body></html>' > /tmp/rvskill-smoke.html
.claude/skills/revealer-slides/scripts/snap.sh /tmp/rvskill-smoke.html 0 /tmp/rvskill-smoke.png --fragments
ls -la /tmp/rvskill-smoke.png && ls /tmp/.snap-* 2>/dev/null || echo "tmp cleaned"
```

Expected: prints `/tmp/rvskill-smoke.png`, the PNG exists and is non-empty, and no `.snap-*` temp file survives. (If Chrome is genuinely absent on this machine, expected exit is 3 — note it and continue; Task 6 requires Chrome.) A real-deck screenshot happens in Task 6.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/revealer-slides/scripts/snap.sh
git commit -m "feat(skill): headless-Chrome slide screenshot helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: patterns.md + the kitchen-sink build test

**Files:**
- Create: `.claude/skills/revealer-slides/references/patterns.md`
- Test: `tests/test_skill_patterns.py`

**Interfaces:**
- Consumes: the `deck` fixture (`tests/conftest.py`) and `build_deck` (`tests/helpers.py`); the warning-capture idiom from `tests/test_warnings.py` (`capsys`, lines starting `"Warning:"`).
- Produces: the fence contract — every ```` ```pres ```` block in patterns.md is a standalone deck that must build with zero warnings against the stub asset set below; illustrative-only examples use ```` ```text ````. Task 4's SKILL.md points authors at this file.

- [ ] **Step 1: Write the failing test**

Create `tests/test_skill_patterns.py`:

```python
"""Every ```pres snippet in the skill's patterns.md builds warning-free.

The fence language IS the contract: ```pres blocks are extracted verbatim,
each built as a standalone deck against the stub assets below, and must
produce zero `Warning:` lines. Illustrative-only examples (build hooks,
includes, PDF figures) use ```text fences and are not built.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from helpers import build_deck

REPO = Path(__file__).resolve().parents[1]
PATTERNS = REPO / ".claude" / "skills" / "revealer-slides" / "references" / "patterns.md"

_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63f8ffff3f0300050001a5f645400000000049454e44ae426082"
)
_SVG = (b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
        b'<rect id="box" width="10" height="10" fill="#cccccc"/>'
        b'<circle id="dot" cx="5" cy="5" r="2"/>'
        b'<path id="arrow" d="M0 5h10" stroke="#000"/></svg>')
_BIB = (b"@article{smith2026,\n"
        b"  author  = {Smith, Ada},\n"
        b"  title   = {A key result},\n"
        b"  journal = {Nature},\n"
        b"  year    = {2026},\n"
        b"}\n")

# The asset contract stated at the top of patterns.md — keep the two in sync.
MEDIA = {
    "Media/figure.png": _PNG,
    "Media/photo.jpg": _PNG,
    "Media/logo.png": _PNG,
    "Media/base.png": _PNG,
    "Media/overlay.png": _PNG,
    "Media/movie.mp4": b"\x00fakemp4",
    "Media/diagram.svg": _SVG,
    "refs.bib": _BIB,
}


def _snippets() -> list[str]:
    assert PATTERNS.is_file(), "patterns.md missing"
    return re.findall(r"```pres\n(.*?)```", PATTERNS.read_text(encoding="utf-8"),
                      re.DOTALL)


def _warnings(capsys):
    return [l for l in capsys.readouterr().out.splitlines()
            if l.startswith("Warning:")]


def test_patterns_has_a_real_library():
    assert len(_snippets()) >= 10


@pytest.mark.parametrize("idx", range(40))
def test_pattern_snippet_builds_warning_free(deck, capsys, idx):
    snippets = _snippets()
    if idx >= len(snippets):
        pytest.skip("no snippet #{0}".format(idx))
    html = build_deck(deck(snippets[idx], media=MEDIA))
    assert _warnings(capsys) == [], "snippet #{0} warned".format(idx)
    assert "<section" in html
```

(The fixed `range(40)` parametrization keeps collection independent of the file's existence, so this test fails — rather than errors at collection — before patterns.md exists, and every snippet still gets its own test id.)

- [ ] **Step 2: Run it to verify it fails**

Run: `/tmp/rvskill-venv/bin/pytest tests/test_skill_patterns.py -q`
Expected: FAIL — `patterns.md missing`.

- [ ] **Step 3: Write patterns.md**

Create `.claude/skills/revealer-slides/references/patterns.md` with exactly this content:

````markdown
# .pres patterns

Idiomatic building blocks for Revealer talks. Copy a pattern, swap the
asset names, adjust the text. One sentence says when to use each.

<!-- CONTRACT (enforced by tests/test_skill_patterns.py): every ```pres
     fence is extracted and built as a standalone deck against stub
     assets — each must build with ZERO "Warning:" lines. Illustrative
     examples that cannot build hermetically (build hooks, includes,
     PDF figures) use ```text fences instead.
     Assets a ```pres snippet may reference (exact paths):
       Media/figure.png  Media/photo.jpg  Media/logo.png  Media/base.png
       Media/overlay.png Media/movie.mp4  Media/diagram.svg  refs.bib
     (diagram.svg contains ids #box, #dot, #arrow) -->

## Minimal talk

The smallest complete deck: settings, generated title slide, one content
slide.

```pres
> title: My talk
> author: Ada Lovelace
> event: Seminar, 2026
> slideNumber: c/t

>>> first: My talk
> subtitle: A one-line pitch

=== The point

One idea per slide, stated plainly.

* Context
* + Result revealed on click
```

## Title slide with photos and logos

Add `> photo:` under an author to switch the title slide to a photo grid;
logos repeat.

```pres
> title: Collaboration talk
> author: Ada Lovelace
  > photo: Media/photo.jpg
> author: Charles Babbage
> affiliation: Analytical Engines Ltd
> logo: Media/logo.png
> event: London, 1843

>>> first: Collaboration talk
```

## Two columns: text next to a figure

`||` opens/closes the block, `|` starts the next column; widths are
optional flex-basis values.

```pres
=== Model vs data

|| 40%
> align: left
**Model.** Overdamped Langevin dynamics:

$$\dot x = -\mu \nabla U + \sqrt{2D}\,\xi(t)$$
| 55%
! Media/figure.png | Trajectories in the trap
||
```

## Figure-heavy canvas: fill + row/col

For exact geometry, `> fill` switches the slide to a full-height layout;
rows split into sized columns.

```pres
=== Experimental setup
> fill
> row
> col 2/5 center
Optical tweezers hold the bead at the focus.

! Media/figure.png contain
> col 3/5 center
!! Media/movie.mp4 loop | The experiment, 20× speed
> end: row
```

## Grid of cards

Cards with titles, fragment reveals and background colours; `compact`
would size the grid to its content instead of the slide.

```pres
=== Three contributions
> grid(1,3)
> gap: 24px

> card | Theory
A new fluctuation identity

> card + | Simulation
Validated across four orders of magnitude

> card +: #EFF4FF
And it holds out of equilibrium

> end: grid
```

## Stack: build a figure up in layers

Layers cross-fade as fragments; `clear` keeps a layer transparent
(see-through overlay), `h=` pins the height.

```pres
=== The mechanism, step by step
> fill
> stack h=520
> layer
! Media/base.png fill
> layer +
! Media/overlay.png fill
> layer + clear
! Media/diagram.svg fill contain
> end: stack
```

## Pin: absolute annotation over the slide

Center lands at x% y% of the slide body; optional width %; `+` reveals it
as a fragment.

```pres
=== Setup
> fill
! Media/figure.png contain

> pin: 72% 18% 18% +
[Anomaly here]{.accent}
> end: pin
```

## Callout boxes and framed equations

`> info` / `> warn` / `> good` boxes with optional titles; `> eq` frames
math with the theme accent (auto-wrapped in `$$` when it has no `$`).

```pres
=== Key result

> info Dataset
African elephant, Kruger National Park, 2019–2024
> end: info

> eq +
\langle x^2(t) \rangle = 2 D t
> end: eq

> good + Take-home
Diffusion is anomalous below the crossover scale
> end: good
```

## Fragment sequencing

`+` reveals in document order; `+N` sets an explicit index for
simultaneous or out-of-order reveals; `> frag` wraps arbitrary content.

```pres
=== Reveal sequence

* Always visible
* + First click
* +3 Later, out of order
* +2 Second click

> frag 2
This block appears together with the +2 bullet: $e^{i\pi} = -1$.
> end: frag
```

## Table

Cells are centered; `> row` starts a new row and its first cell; closing
`> end: table` is optional at the end of a slide but keep it explicit.

```pres
=== Parameter summary
> table(2,2)
> border: true

> cell
$D$ (µm²/s)

> cell: #f5f5f5
$1.2 \pm 0.1$

> row
$\tau$ (s)

> cell
$0.48 \pm 0.03$

> end: table
```

## Code and a highlighted takeaway

`@@` fences take a language and reveal.js attributes; `[ … ]` on its own
line is a highlighted block.

```pres
=== Implementation

@@ python data-line-numbers
def msd(x, lag):
    return ((x[lag:] - x[:-lag]) ** 2).mean()
@@

[ Ten lines of NumPy — no C extension needed. ]
```

## Talk structure: sections, verticals, backups

`%%%` makes a full-bleed divider (header removed); `---` hangs vertical
slides under the last `===` — perfect for backup slides.

```pres
>>> first: A structured talk

%%% Part I — Setup
> relief: none
> background: #0F4C75

=== Main argument

The talk's spine lives on `===` slides.

--- Backup: gory details
> style: dark

Press ↓ during questions to reach this.
```

## Citations and bibliography

Point settings at the BibTeX file once; cite per slide; `>>> biblio`
renders the paginated reference list.

```pres
> bibtex: refs.bib

=== Related work
> cite: smith2026

A key result was reported<ref:smith2026>.

>>> biblio
> title: References
```

## Speaker notes

Everything after `> notes:` is notes; the optional value sets their font
size for this slide.

```pres
=== Main result

The visible slide content.

> notes: 1.1em
Explain the intuition before showing the equation.
```

## SVG animation

Inline the SVG (`> svg:`), pre-hide elements by id, then animate
attributes step by step — each step is a fragment.

```pres
=== How the mechanism unfolds
> svg: Media/diagram.svg
> hide: #dot, #arrow
> animate: #box fill:#0F4C75
> animate: #dot opacity:1 @ 1s
> animate: #arrow opacity:1; transform:translate(2,0) @ 300ms

Each arrow press advances one step; stepping back reverts it.
```

## KaTeX macros

Declare once in settings (or `> macros: defs.tex` for a file of
`\newcommand`s), use everywhere.

```pres
> macro: \half \frac{1}{2}
> macro: \R \mathbb{R}

=== Notation

Positions live in $\R^3$; kinetic energy is $\half m v^2$.
```

## Sizes and alignment

Alone (blank line after), a directive restyles the whole slide or column;
attached to a paragraph, just that paragraph. Sizes accept factors or the
role names `title` / `lede` / `body` / `sm` / `fine`.

```pres
=== Fine print
> size: lede
> align: left

This slide defaults to lede-sized, left-aligned text.

> size: 0.7
* This attached list is at 70%
* and so is this item
```

## Self-updating figures (illustrative — runs your scripts)

Reference a PDF figure and let a build hook regenerate it before every
compile; the theme-matched matplotlib style keeps plots on-palette. Not
build-tested here: `> build:` executes a shell command and `! fig.pdf`
needs `pdftocairo`.

```text
> build: python figs.py

=== Results
! Media/decay.pdf | MSD vs lag time
```

```text
# figs.py
import matplotlib.pyplot as plt
plt.style.use("reveal.js/dist/theme/revealer.mplstyle")
fig, ax = plt.subplots(figsize=(6, 4))
ax.plot(x, y, label="theory")
ax.legend()
fig.savefig("Media/decay.pdf")
```

## Lecture course from includes (illustrative — needs sibling files)

`> include:` splices another `.pres` at build time (recursive, deck-local
paths); serve the master and saving any part rebuilds.

```text
>>> first: Statistical Physics — full course

> include: lecture-01/lecture-01.pres
> include: lecture-02/lecture-02.pres
```
````

- [ ] **Step 4: Run the test; fix snippets (never the assertion) until green**

Run: `/tmp/rvskill-venv/bin/pytest tests/test_skill_patterns.py -q`
Expected: 41 items — `test_patterns_has_a_real_library` + 17 built snippets passing + 23 skips.

If a snippet warns, the warning names the line and reason (see `tests/test_warnings.py` for the exact message forms); correct the snippet to the documented syntax from `Documentation/authoring.md`. Two known risk spots: `> frag 2` (documented as `> frag [N]` in authoring.md §Fragments — if it warns, drop the index and use bare `> frag` with a `+2` on the paragraph instead) and `> card + | Simulation` (title-after-flag per authoring.md §Callout; if the `|` title form on cards warns, move the title into the card body). Record any such correction in the commit message.

- [ ] **Step 5: Full suite + commit**

Run: `/tmp/rvskill-venv/bin/pytest tests/ -q` — all green.

```bash
git add .claude/skills/revealer-slides/references/patterns.md tests/test_skill_patterns.py
git commit -m "feat(skill): build-verified .pres pattern library

Every \`\`\`pres snippet is built as a standalone deck in CI and must
produce zero build warnings.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: SKILL.md + verify.md — the skill entry point

**Files:**
- Create: `.claude/skills/revealer-slides/SKILL.md`
- Create: `.claude/skills/revealer-slides/references/verify.md`

**Interfaces:**
- Consumes: `references/syntax.md` (Task 1), `references/patterns.md` (Task 3), `scripts/snap.sh` and its exit codes (Task 2).
- Produces: the skill's always-loaded entry point. Frontmatter `name: revealer-slides`; the routing table below is what future edits must preserve.

- [ ] **Step 1: Write SKILL.md**

Create `.claude/skills/revealer-slides/SKILL.md`:

````markdown
---
name: revealer-slides
description: Author and edit Revealer .pres presentations. Use when the user asks for slides, a talk, a deck, a presentation, or mentions .pres/Revealer — creating a deck, writing or restyling slides, fixing layout, building or exporting to PDF.
---

# Revealer slide authoring

Revealer compiles a plain-text `.pres` file into a reveal.js
presentation. This skill is for **writing talks**. It is not about
developing Revealer itself (grammar, editor, runtime) — that work happens
in the Revealer repo against its own docs.

## The loop

1. **Locate or scaffold.**
   - Existing talk: find the `.pres` (a deck is a folder holding
     `<Name>.pres`, `Media/`, and a `reveal.js/` engine).
   - New talk: write `<Name>/<Name>.pres` yourself from the "Minimal
     talk" pattern (references/patterns.md), then run
     `revealer update <Name>` once to download the reveal.js engine.
     (`revealer new` scaffolds too, but prompts interactively — only
     suggest it to the user, never run it yourself.)
2. **Author.** Golden rules below. Media files live in `Media/` inside
   the deck folder; every path is relative to the deck folder. Before
   writing a construct you are not sure of, open references/syntax.md.
3. **Build.** `revealer build <path/to/Name.pres>` → `<Name>.html` next
   to it. The build never fails on syntax — it prints
   `Warning: line N: …` for anything it had to drop or reinterpret.
   **Zero warnings is the bar**; references/verify.md decodes them.
4. **Verify visually.** Screenshot every slide you changed:
   `scripts/snap.sh <Name>.html <slide> shot.png --fragments`
   then READ the image: clipped text, broken-image icons, unbalanced
   columns, overlays landing wrong. Sweep the whole deck once before
   declaring the talk done. Exit 3 means no Chrome — say you could not
   verify visually; never claim slides look right unseen.
5. **Export** on request: `revealer pdf <target>` (one page per slide,
   fragments shown; `> pdfSeparateFragments: true` for one page per
   step).

If the user has `revealer serve` running (or opened the deck with plain
`revealer <file>.pres`), their browser already rebuilds and reloads on
every save, keeping the current slide — point them at the slide instead
of screenshotting.

## Golden rules

- Settings are `> key: value` lines **before** the first slide; content
  after. `#` starts a comment. Raw HTML passes through anywhere.
- Slides: `=== Title` (horizontal) · `--- Title` (vertical, under the
  last `===`) · `%%% Title` (section divider) · `>>> first: Title`
  (generated title slide) · `>>> biblio` (bibliography).
- Block constructs open with `> name …` and close with `> end: name`:
  `row`, `grid(r,c)`, `table(r,c)`, `stack`, `pin:`, `info`/`warn`/
  `good`, `eq`, `frag`. Their sub-items (`> col`, `> card`, `> layer`,
  `> cell`) run to the next marker — never write a sub-item outside its
  parent.
- Text columns: `||` opens/closes the block, `|` starts the next column.
  Layout canvas: `> fill`, then `> row` / `> col 2/5 center`;
  `> space: 40px` for fixed gaps (bare `> space` only inside `> fill`).
- Bullets: `* text`, nested by two spaces. Fragments: trailing `+` or
  `+N` on bullets (`* + text`), media, `> col`, `> card`, `> layer`,
  `> pin:`, boxes, `> eq`.
- Media: `! Media/f.png [flags] [| caption]` (image) · `!! Media/m.mp4`
  (video). Flags: `fill` `contain` `cover` `top`, `h=…`/`w=…`, `loop`
  `autoplay` `controls`. The file must exist — a missing path is a
  build warning.
- Math: `$inline$`, `$$display$$`; `> eq` for a framed equation
  (auto-wrapped in `$$` when it contains no `$`). Code: `@@ lang` … `@@`.
  Highlight: `[ text ]` alone on a line.
- Inline: `**bold**` `*italic*` `` `code` `` `[text](url)`
  `[text]{.accent}` `[text]{color=#c0392b}`; escape markers with `\`.
- One idea per slide. Let the fit engine shrink content — if a shot
  shows tiny text, split the slide instead of fighting sizes.
- Prefer constructs over raw HTML; prefer editing the smallest region
  of the `.pres` you can.

## When unsure

| Need | Open |
| --- | --- |
| Exact parameters/forms of any construct, all settings | references/syntax.md — generated from the grammar, authoritative |
| How to compose a slide (columns, grids, stacks, pins, citations, SVG animation, macros…) | references/patterns.md — copy-paste snippets, all build-verified |
| A `Warning:` line, visual checks, screenshots, PDF export | references/verify.md |

If `revealer` is not on PATH: install with
`pipx install .` from a clone of https://github.com/ronceray/Revealer.
````

- [ ] **Step 2: Write verify.md**

Create `.claude/skills/revealer-slides/references/verify.md`:

````markdown
# Build, warnings, and visual verification

## Build

    revealer build path/to/Name.pres     # writes Name.html next to the .pres

The build **never fails on a syntax mistake** — bad lines are dropped or
reinterpreted, and each one prints `Warning: line N: …` on the build
output. Zero warnings is the bar. The messages and their fixes:

| Warning | Fix |
| --- | --- |
| `unrecognized directive dropped: > …` | typo in a construct opener (e.g. `> grid(a,b)`) — check references/syntax.md |
| `> card belongs inside a > grid` (and similar hints) | construct child written outside its parent — add the parent or move the child |
| `stray '> end: name'` | it closes nothing — remove it or fix the opener it was meant to close |
| `'> info' is never closed and swallowed '> …'` | add the missing `> end: info` before the next construct |
| `bare '> space' fills only inside a '> fill' slide` | use `> space: 40px`, or make it a `> fill` slide |
| `media file not found: …` | wrong path/case — media paths are relative to the deck folder |

The only thing that aborts a build is a **failing `> build:` hook**
(your figure script): its output is shown; fix the script or drop the
hook.

## Screenshots

    scripts/snap.sh Name.html <slide> out.png [--fragments]

- `<slide>` is the reveal.js index shown in the URL: `4`, or `4/2` for
  the 2nd vertical slide under horizontal slide 4. Slide 0 is the title.
- `--fragments` forces every fragment visible (what `revealer pdf`
  does); without it, un-revealed fragment content is invisible.
- Exit 3 = no Chrome/Chromium on PATH. Report "not visually verified"
  — do not guess.

What to look for in the shot:

- Text clipped or overflowing its box; a block shrunk unreadably small
  by the fit engine → split the slide or drop content.
- Broken-image icons → path or case mismatch (build also warned).
- Badly unbalanced columns → try `> column-width: auto` on the slide.
- A `> pin:` or `> stack` overlay landing in the wrong place → adjust
  the percentages / `h=`.
- Fragments that never appear (check with and without `--fragments`).

Iterate on the slides you changed; before declaring the talk done,
sweep every slide once.

## When the user is watching

`revealer serve` (or `revealer <file>.pres`) already rebuilds and
reloads their browser on each save, preserving the slide and fragment.
Tell them what to look at instead of screenshotting. Build errors show
as a browser overlay while the last good build keeps being served.

## PDF export

    revealer pdf <target>        # one page per slide, fragments shown
    revealer pdf <target> -o slides.pdf

`> pdfSeparateFragments: true` in the settings gives one page per
fragment state. Requires Chrome/Chromium and `img2pdf`.
````

- [ ] **Step 3: Sanity checks**

```bash
head -5 .claude/skills/revealer-slides/SKILL.md   # frontmatter opens with --- and name:
grep -c '^' .claude/skills/revealer-slides/SKILL.md   # ≈ 110–170 lines
ls .claude/skills/revealer-slides/references/          # patterns.md syntax.md verify.md
/tmp/rvskill-venv/bin/pytest tests/ -q                 # still green
```

Every file SKILL.md routes to must exist (`syntax.md`, `patterns.md`, `verify.md`, `scripts/snap.sh`).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/revealer-slides/SKILL.md .claude/skills/revealer-slides/references/verify.md
git commit -m "feat(skill): revealer-slides entry point and verification guide

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Personal install, docs note, changelog, Sphinx gate

**Files:**
- Modify: `Documentation/installation.md` (new section before `## VS Code integration`)
- Modify: `CHANGELOG.md` (unreleased entry, matching the file's existing format)
- Create: symlink `~/.claude/skills/revealer-slides` (machine state, not committed)

**Interfaces:**
- Consumes: the complete skill directory (Tasks 1–4).
- Produces: the documented install one-liner; a `-W`-clean Sphinx build proving the docs note and the generated file are consistent.

- [ ] **Step 1: Install the skill personally (symlink, idempotent)**

```bash
mkdir -p ~/.claude/skills
ln -sfT "$(pwd)/.claude/skills/revealer-slides" ~/.claude/skills/revealer-slides
ls -la ~/.claude/skills/revealer-slides/
```

Expected: the symlink resolves and lists SKILL.md, references/, scripts/.

- [ ] **Step 2: Add the docs section**

In `Documentation/installation.md`, insert immediately before the `## VS Code integration` heading:

````markdown
## Claude Code skill

The repository ships a [Claude Code](https://claude.com/claude-code)
skill that teaches Claude the `.pres` language and the build/verify
loop, so it can write and fix talks with you. Enable it for every
Claude session on your machine by symlinking it into your personal
skills folder:

```bash
mkdir -p ~/.claude/skills
ln -sfT "$(pwd)/.claude/skills/revealer-slides" ~/.claude/skills/revealer-slides
```

Run this from the repository root. In any Claude Code session — for
instance in a talk folder — asking for slides then activates the skill:
Claude writes the `.pres`, runs `revealer build`, and checks the result
with headless-Chrome screenshots. The skill's syntax reference is
generated from the grammar registry (like the
[reference](reference/index.md)), so it always matches your checkout.

````

- [ ] **Step 3: Changelog entry**

Read the top of `CHANGELOG.md` and add, in the file's existing format (create an unreleased section at the top if none exists), one entry:

> **Added** — `revealer-slides` Claude Code skill (`.claude/skills/revealer-slides/`): agent-facing authoring skill with a grammar-generated syntax reference, a build-verified pattern library, and a headless-Chrome screenshot verifier. Install: see *Installation › Claude Code skill*.

- [ ] **Step 4: Sphinx must stay -W clean**

```bash
python3 -m venv /tmp/rvskill-docs && /tmp/rvskill-docs/bin/pip install -q -r Documentation/requirements.txt
/tmp/rvskill-docs/bin/sphinx-build -W -b html Documentation Documentation/_build/html
git status --short   # conf.py regenerated pages — must show NO unexpected changes
```

Expected: build succeeds with zero warnings; `git status` shows only the files this task edits (a dirty `syntax.md`/`constructs.md` here means Task 1's output was not committed current — regenerate and amend).

- [ ] **Step 5: Full suite + commit**

Run: `/tmp/rvskill-venv/bin/pytest tests/ -q` — all green.

```bash
git add Documentation/installation.md CHANGELOG.md
git commit -m "docs(skill): install note for the revealer-slides skill; changelog

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Dogfood — author a real deck with the skill's own instructions

**Files:**
- Scratch only (`/tmp/rvskill-dogfood/`), plus fixes to any skill file the dogfood proves wrong (each fix re-runs that file's test/check from its own task before committing).

**Interfaces:**
- Consumes: everything. This task validates the *instructions*, not just the code: follow SKILL.md literally, as a fresh reader would.

- [ ] **Step 1: Scaffold exactly as SKILL.md says**

```bash
mkdir -p /tmp/rvskill-dogfood/Dogfood/Media
cd /tmp/rvskill-dogfood/Dogfood
```

Write `Dogfood.pres` starting from the "Minimal talk" pattern, then extend it to a 5-slide talk that exercises: two-column text+figure, a grid of cards with fragments, a stack, a callout + framed equation, and speaker notes (copy the patterns, using 2–3 real PNG/SVG files you generate into `Media/` — e.g. with python from the venv: a matplotlib-free SVG written by hand is fine).

Then the engine step from SKILL.md: `revealer update /tmp/rvskill-dogfood/Dogfood` — using the venv CLI (`/tmp/rvskill-venv/bin/revealer`), which reflects the working tree. **This step needs the network**; if `revealer update` refuses to run on a folder without `.revealer.toml` or without network, copy an engine instead (`cp -r /home/ronceray/Dropbox/WORK/MYTOOLKITS/Revealer/Demo/reveal.js .` if present) AND fix SKILL.md's scaffold instructions to match observed reality — that discovery is the point of this task.

- [ ] **Step 2: Build, chase warnings to zero**

```bash
/tmp/rvskill-venv/bin/revealer build /tmp/rvskill-dogfood/Dogfood/Dogfood.pres
```

Expected: `Dogfood.html` appears; zero `Warning:` lines. Any warning here that a patterns.md snippet produced means Task 3 missed it — fix the pattern and its test.

- [ ] **Step 3: Screenshot and READ every slide**

```bash
cd /tmp/rvskill-dogfood/Dogfood
snap=/home/ronceray/Dropbox/WORK/MYTOOLKITS/Revealer/.claude/skills/revealer-slides/scripts/snap.sh
"$snap" Dogfood.html 0 s0.png --fragments
"$snap" Dogfood.html 1 s1.png --fragments
# … one per slide
```

Open each PNG (Read tool) and check against verify.md's list: title slide populated, columns balanced, cards + fragments visible (because `--fragments`), stack layers stacked, equation framed and rendered by KaTeX, no broken-image icons. A blank or engine-less page means the reveal.js copy failed in Step 1 — resolve before judging slides.

- [ ] **Step 4: Fold discoveries back**

Every friction found (a SKILL.md instruction that didn't survive contact, a missing warning row in verify.md, a pattern that renders ugly at 1920×1080) gets fixed in the corresponding skill file now. Re-run that file's own checks (Task 1/3 tests, Task 4 sanity greps). If nothing needed fixing, say so explicitly in the final report.

- [ ] **Step 5: Final full suite + commit (if any fixes) + report**

```bash
/tmp/rvskill-venv/bin/pytest tests/ -q
git add -A .claude/skills/revealer-slides Documentation
git diff --cached --quiet || git commit -m "fix(skill): adjustments from dogfood run

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Report: deck path, screenshot verdicts per slide, and every skill-file adjustment made. The remaining validation layer — a fresh interactive Claude session in a talk folder ("make me a 5-slide talk") — is the user's to run, since it needs a real session with the personal skill active.
