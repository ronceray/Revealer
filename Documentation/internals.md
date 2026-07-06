# Internals

Notes for contributors: the contracts that hold the editing stack together.
File paths are relative to the repository root.

## The provenance contract

The WYSIWYG layer works because **dev builds know where every element came
from**. When `build.py` runs with `dev=True` (as the dev server does), it
annotates the generated HTML:

- `data-rv-src="N"` — the 1-based `.pres` line that produced the element;
- `data-rv-src-end="M"` — the last line of a multi-line construct;
- `data-rv-implicit` — marks wrappers with no own source line (e.g. the
  implicit first `> col` of a row);
- two `<meta>` tags carry the source file name and the SHA-256 of the
  exact bytes the build read.

Two invariants are enforced by tests:

1. **Prod purity**: a production build contains none of these annotations,
   and stripping them from a dev build yields the prod build **byte for
   byte** (`tests/helpers.py: strip_dev`). The editor can never leak into
   an exported deck.
2. **SHA precondition**: line numbers are only meaningful against the
   exact bytes that were built. Every edit request carries the sha; if the
   file changed since, the edit is refused (see below) — provenance is
   never trusted across a stale build.

## The edit protocol

The dev server (`src/revealer/serve.py`) exposes a small JSON API under
`/__rv__/` (localhost-only, token-guarded, dev builds only):

- `GET /__rv__/schema` — the construct grammar as JSON (see
  [the grammar registry](#the-grammar-registry)).
- `GET /__rv__/src?from=N&to=M` — the current source span + file sha.
- `POST /__rv__/edit` — `{sha256, edits: [...]}`: a batch of **semantic
  operations** referencing `.pres` line numbers.
- `POST /__rv__/undo` / `redo`, `POST /__rv__/export`,
  `PUT /__rv__/upload`, and the `history/*` endpoints below.

`src/revealer/edit.py` compiles the semantic ops into line-level text
primitives and applies them surgically — the rest of the file is never
touched, so a GUI session diffs like hand edits. The operations are:

`set_col_size`, `set_block_width`, `set_row_height`, `set_stack_height`,
`set_pin`, `set_media_size`, `set_row_gap`, `set_grid_gap`,
`set_fragment_index`, `move_block`, `delete_block`, `replace_lines`,
`insert_lines`, `insert_media`, `reorder_fragments`.

Failure semantics:

- **409** — the sha precondition failed (the file changed on disk). The
  client refetches and resyncs; nothing was written.
- **422** — the target line no longer matches the construct's own syntax.
  A provenance bug surfaces as a rejected edit, never as silent
  corruption.
- Batches are all-or-nothing; overlapping edits are rejected; writes are
  atomic (temp file + `os.replace`) and preserve the file's EOL flavour
  and trailing-newline state.

## The history model

Save history is a **shadow git repository** at `<deck>/.rv-history/`
(`git --git-dir`, work-tree = the deck folder — invisible to any real
repository around it). `serve.py` owns it:

- every successful rebuild with changed bytes auto-commits (`auto: HH:MM:SS`),
  staging the `.pres`, the deck's `.bib` files and any `> include:`d files
  inside the deck;
- manual snapshots from the editor commit with a `save:` prefix;
- **undo/redo is a cursor** walking the first-parent chain of this
  history. Undo moves the cursor to the parent commit and writes that
  blob back; redo walks forward. The cursor is revalidated against the
  working bytes on every use (`_resolve_position`) — it is never trusted
  blindly;
- committing while the cursor is detached first appends a **rewind
  commit** (the cursor's tree), so new work parents onto what the user
  was actually looking at, and redo history is preserved rather than
  destroyed. Restores from the time machine use the same mechanism, which
  is why undo works across restores.

Endpoints: `GET /__rv__/history` (list), `GET /__rv__/history/diff`,
`POST /__rv__/history/commit|restore|preview`. Without git installed, the
server degrades to a single before-image undo slot.

## The grammar registry

`src/revealer/grammar.py` is the **single source of truth** for the
`.pres` construct grammar. Each `ConstructSpec` carries the opener pattern,
head-token grammar, end token, nesting/terminator behaviour, CSS classes
and editor metadata. From this one table derive:

- the parser dispatch and block/paragraph atomicity rules in `build.py`;
- the anchor and token grammars of the semantic edit ops in `edit.py`;
- the JSON schema served at `GET /__rv__/schema`, which drives the browser
  editor's construct model, panel fields and cheatsheet;
- the generated [Constructs](reference/constructs.md) and
  [Directives](reference/directives.md) reference pages
  (`Documentation/gen_reference.py`, run at every docs build).

Behaviour (body rendering, emission templates, provenance attachment)
stays in `build.py`; the registry holds patterns and metadata only.

## Editor architecture

The browser editor is thirteen small JavaScript IIFE modules under
`src/revealer/data/js/editor/`, sharing a single `window.RV` namespace
(state bus, cross-module function table, UI chrome helpers). They are
injected into dev builds only — the wheel and exported decks never ship
them. The module list, load order and state-bus conventions are documented
in `src/revealer/data/js/editor/README.md`.

## Test harness

- **Python unit tests** — `tests/`, run with `pytest -q` from that folder.
  Hermetic: a deck fixture builds fully offline against an empty
  `reveal.js/` scaffold. Committed goldens freeze the prod build output
  byte-for-byte (`UPDATE_GOLDEN=1` to regenerate deliberately).
- **In-browser JS suites** — `src/revealer/data/js/test/` (wheel-excluded)
  holds a runner (`rvt.js`) and `suite-*.js` files exercising the editor
  against a real served deck. The dev server exposes the runner at
  `/__rv__/test` (test mode only); `tests/test_editor_js.py` drives it
  with headless Chrome and collects results. Requires Chrome and a
  reveal.js checkout at `Demo/reveal.js`.
- **Docs** — `sphinx -W` (warning-free is enforced); the reference pages
  are regenerated at every build and committed.
