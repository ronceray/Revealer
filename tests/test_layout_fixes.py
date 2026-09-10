"""Regression fences for the 2026-09 issue batch: column sizing (#2 #3 #4
#5), the KaTeX bundle race (#1), the auto-fit floor (#7), `revealer index`
(#9), `> fill` in the grammar (#10), callout title sizes (#11), `h=` on a
stack layer (#17) and void paragraphs (#18)."""

from __future__ import annotations

import re

from helpers import build_deck

# Each section imports what it tests (the sections landed one commit per
# issue, and the file must stay green at every one of them).

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63f8ffff3f0300050001a5f645400000000049454e44ae426082"
)


def _warnings(capsys):
    return [line for line in capsys.readouterr().out.splitlines()
            if line.startswith("Warning:")]


def _flexes(html):
    return re.findall(r'<div class="region[^"]*" style="flex:([^;]+);', html)


# --- #2: fractions are shares of the row ------------------------------------

def test_fraction_columns_keep_their_ratio(deck):
    html = build_deck(deck(
        "=== T\n> fill\n> row\n> col 1/6\na\n> col 1/6\nb\n> col 1/6\nc\n"
        "> col 1/2\nd\n> end: row\n"))
    assert _flexes(html) == ["1 1 0", "1 1 0", "1 1 0", "3 1 0"]


def test_same_denominator_fractions_are_unchanged(deck):
    html = build_deck(deck("=== T\n> fill\n> row\n> col 2/5\na\n> col 3/5\nb\n> end: row\n"))
    assert _flexes(html) == ["2 1 0", "3 1 0"]


def test_fractions_over_one_row_warn(deck, capsys):
    build_deck(deck("=== T\n> fill\n> row\n> col 1/2\na\n> col 2/3\nb\n> end: row\n"))
    assert any("column fractions add up to 7/6" in line for line in _warnings(capsys))


# --- #3: whitespace before the first column is not a column ------------------

def test_blank_line_after_row_opens_no_column(deck):
    html = build_deck(deck(
        "=== T\n> fill\n\n> row\n\n> col 1/2\nleft\n> col 1/2\nright\n> end: row\n"))
    assert _flexes(html) == ["1 1 0", "1 1 0"]


def test_content_before_the_first_col_is_still_the_implicit_column(deck):
    html = build_deck(deck("=== T\n> fill\n> row\nlead\n> col\nnext\n> end: row\n"))
    assert len(_flexes(html)) == 2
    assert "lead" in html


# --- #4: percentages are shares of the usable width ---------------------------

def test_percent_columns_subtract_their_share_of_the_gaps(deck):
    html = build_deck(deck(
        "=== T\n> fill\n> row\n> col 17%\na\n> col 17%\nb\n> col 17%\nc\n"
        "> col 45%\nd\n> end: row\n"))
    fl = _flexes(html)
    assert fl[0] == "0 0 calc(17% - 0.51 * var(--gap-col))"
    assert fl[3] == "0 0 calc(45% - 1.35 * var(--gap-col))"


def test_single_percent_column_has_no_gap_term(deck):
    html = build_deck(deck("=== T\n> fill\n> row\n> col 60%\na\n> end: row\n"))
    assert _flexes(html) == ["0 0 60%"]


def test_percent_columns_use_the_row_gap(deck):
    html = build_deck(deck(
        "=== T\n> fill\n> row gap=20px\n> col 50%\na\n> col 50%\nb\n> end: row\n"))
    assert _flexes(html) == ["0 0 calc(50% - 0.5 * 20px)"] * 2
    assert "gap:20px;" in html


# --- #5: a bare length after `> row` is the gap, and says so ------------------

def test_bare_length_after_row_warns(deck, capsys):
    html = build_deck(deck("=== T\n> fill\n> row 60px\n> col\na\n> end: row\n"))
    assert "gap:60px;" in html
    w = _warnings(capsys)
    assert any("'> row 60px' sets the column gap" in line and "h=60" in line
               and "gap=60px" in line for line in w)


def test_gap_keyword_is_silent(deck, capsys):
    html = build_deck(deck("=== T\n> fill\n> row gap=60px h=200\n> col\na\n> end: row\n"))
    assert "gap:60px;" in html and "height:200px" in html
    assert _warnings(capsys) == []


# --- #18: markup that renders nothing takes no paragraph slot -----------------

def test_style_only_block_takes_no_paragraph_slot(deck):
    html = build_deck(deck("=== T\n\n<style>.x{color:red}</style>\n\nreal text\n"))
    assert html.count('<div class="rv-paragraph"') == 1
    assert "<style>.x{color:red}</style>" in html
    assert html.index("<style>.x") < html.index('<div class="rv-paragraph"')


def test_style_only_block_on_the_title_slide(deck):
    html = build_deck(deck(
        "> title: T\n\n>>> first: Deck\n\n<style>.x{color:red}</style>\n\n"
        '<div class="strip">strip</div>\n'))
    section = html[html.index("<section"):html.index("</section>")]
    assert section.count('<div class="rv-paragraph"') == 1
    assert "<style>.x{color:red}</style>" in section


def test_style_with_visible_content_keeps_its_paragraph(deck):
    html = build_deck(deck("=== T\n\n<style>.x{color:red}</style>\nvisible\n\nmore\n"))
    assert html.count('<div class="rv-paragraph"') == 2


# --- #17: `h=` on a layer's media sizes the stack -----------------------------

def test_layer_media_height_sizes_the_stack(deck):
    html = build_deck(deck(
        "=== T\n> fill\n> stack\n> layer\n! Media/a.png fill contain h=660px\n"
        "> layer +\n! Media/b.png fill contain\n> end: stack\n",
        media={"Media/a.png": PNG, "Media/b.png": PNG}))
    assert 'class="rv-stack" style="flex:0 0 660px;height:660px;"' in html


def test_stack_h_wins_over_the_layer_media_h(deck):
    html = build_deck(deck(
        "=== T\n> fill\n> stack h=300\n> layer\n! Media/a.png fill h=660\n> end: stack\n",
        media={"Media/a.png": PNG}))
    assert 'style="flex:0 0 300px;height:300px;"' in html


def test_disagreeing_layer_heights_warn(deck, capsys):
    build_deck(deck(
        "=== T\n> fill\n> stack\n> layer\n! Media/a.png fill h=600\n"
        "> layer +\n! Media/a.png fill h=400\n> end: stack\n",
        media={"Media/a.png": PNG}))
    assert any("different heights (600px and 400px)" in line for line in _warnings(capsys))


# --- #7: the auto-fit floor is a setting, defaulting near 1 -------------------

def test_fit_floor_default(deck):
    html = build_deck(deck("=== A\n\ntext\n"))
    assert 'data-rv-fit-floor="0.85"' in html


def test_fit_floor_deck_and_slide_overrides(deck):
    html = build_deck(deck(
        "> fit-floor: 0.9\n\n=== A\n\ntext\n\n=== B\n> fit-floor: 0.5\n\ntext\n"))
    assert html.count('data-rv-fit-floor="0.9"') == 1
    assert html.count('data-rv-fit-floor="0.5"') == 1
    assert "fit-floor" not in html.split("Reveal.initialize", 1)[1]  # not a reveal option


# --- #9: `revealer index` -----------------------------------------------------

def test_slide_index_matches_reveal_numbering(tmp_path):
    d = tmp_path / "ix"
    (d / "reveal.js").mkdir(parents=True)
    (d / "part.pres").write_text("--- Included vertical\n\ntext\n")
    (d / "ix.pres").write_text(
        ">>> first: Title\n=== One\n--- One b\n> visibility: hidden\n--- One c\n"
        "%%% Part\n=== Two\n> include: part.pres\n>>> biblio\n")
    from revealer.build import slide_index

    ix = slide_index(str(d / "ix.pres"))
    assert [(e["index"], e["marker"], e["title"]) for e in ix] == [
        ("0", ">>> first:", "Title"), ("1", "===", "One"), (None, "---", "One b"),
        ("1/1", "---", "One c"), ("2", "%%%", "Part"), ("3", "===", "Two"),
        ("3/1", "---", "Included vertical"), ("4", ">>> biblio", "")]
    assert ix[2]["hidden"] is True
    assert (ix[6]["file"], ix[6]["line"]) == ("part.pres", 1)
    assert (ix[1]["file"], ix[1]["line"]) == ("", 2)


# --- #1: the KaTeX bundle is synced, not deleted-and-recopied -----------------

def test_katex_sync_is_idempotent_and_repairs_a_damaged_copy(tmp_path):
    from revealer import assets

    src = assets.DATA / "katex"
    dest = tmp_path / "katex"
    want = assets._tree_manifest(src)
    assets._sync_tree(src, dest)
    assert assets._tree_manifest(dest) == want
    # a partially deleted bundle (what the old race left behind) is repaired
    next(p for p in dest.rglob("*") if p.is_file()).unlink()
    assets._sync_tree(src, dest)
    assert assets._tree_manifest(dest) == want
    # an up-to-date copy is left untouched
    stamp = {p: p.stat().st_mtime_ns for p in dest.rglob("*") if p.is_file()}
    assets._sync_tree(src, dest)
    assert {p: p.stat().st_mtime_ns for p in dest.rglob("*") if p.is_file()} == stamp


def test_concurrent_katex_syncs_never_leave_a_partial_bundle(tmp_path):
    import contextlib
    import random
    import threading

    from revealer import assets

    src = assets.DATA / "katex"
    dest = tmp_path / "katex"
    assets._sync_tree(src, dest)
    files = [p for p in dest.rglob("*") if p.is_file()]
    errors: list[BaseException] = []

    def builder(seed):
        rng = random.Random(seed)
        try:
            for _ in range(6):
                with contextlib.suppress(OSError):
                    rng.choice(files).unlink()   # stale -> forces a refresh
                assets._sync_tree(src, dest)
        except BaseException as exc:  # noqa: BLE001 - collected for the assert
            errors.append(exc)

    threads = [threading.Thread(target=builder, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors
    assert assets._tree_manifest(dest) == assets._tree_manifest(src)


# --- #10: `> fill` and `> space` are grammar constructs -----------------------

def test_fill_and_space_are_in_the_grammar():
    from revealer import grammar

    fill = grammar.REGISTRY["fill"]
    assert fill.terminator is grammar.Terminator.SINGLE_LINE
    assert set(fill.head[0].keywords) == {"between", "center", "around", "end"}
    assert grammar.REGISTRY["space"].terminator is grammar.Terminator.SINGLE_LINE
    sch = grammar.schema()
    assert "fill" in sch["constructs"] and "space" in sch["constructs"]
    assert "> fill center" in [c[1] for c in sch["constructs"]["fill"]["cheat"]]
    assert not any(c[1] in ("> fill", "> space") for c in sch["staticCheat"])


def test_fill_modes_render_the_section_classes(deck):
    for mode in ("between", "center", "around", "end"):
        html = build_deck(deck("=== T\n> fill {0}\n\ntext\n".format(mode), name="fill_" + mode), name="fill_" + mode)
        assert 'class="rv-fill rv-fill-{0}"'.format(mode) in html
