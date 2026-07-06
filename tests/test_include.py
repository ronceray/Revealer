"""P5b: `> include: file.pres` — build-only expansion with an origin map."""

from __future__ import annotations

import re
import threading
from pathlib import Path

from revealer import build as build_mod
from revealer import serve as serve_mod
from revealer.build import _expand_includes, collect_includes

MAIN = """> title: Course

=== Intro

main intro body

> include: lectures/l1.pres

=== Outro

main outro body
"""

L1 = """=== Lecture one

included body L1

> include: l2.pres
"""

L2 = """=== Lecture two

included body L2
"""


def _course(deck):
    pdir = deck(MAIN, name="crs", media={
        "lectures/l1.pres": L1.encode("utf-8"),
        "lectures/l2.pres": L2.encode("utf-8"),
    })
    return pdir


def test_expansion_origin_map(deck):
    pdir = _course(deck)
    files = [{"path": "crs.pres", "sha": "x", "lines": MAIN.count("\n")}]
    entries, includes = _expand_includes(MAIN, str(pdir), _files=files)
    # main lines keep their plain numbers; included lines are stride-encoded
    # into their own file's coordinates (P8 multi-file provenance)
    origins = [(o, f) for o, f, _line in entries]
    assert (1, None) in origins                             # settings line
    stride = build_mod._FILE_STRIDE
    assert (stride + 1, "lectures/l1.pres") in origins      # l1 line 1
    assert (2 * stride + 1, "lectures/l2.pres") in origins  # nested l2 line 1
    assert [fe["path"] for fe in files] == [
        "crs.pres", "lectures/l1.pres", "lectures/l2.pres"]
    assert all(len(fe["sha"]) == 64 for fe in files[1:])
    assert [Path(i).name for i in includes] == ["l1.pres", "l2.pres"]


def test_circular_and_traversal_guards(tmp_path, capsys):
    (tmp_path / "a.pres").write_text("> include: b.pres\n")
    (tmp_path / "b.pres").write_text("> include: a.pres\nbody b\n")
    import os
    entries, includes = _expand_includes(
        (tmp_path / "a.pres").read_text(), str(tmp_path),
        _stack=(os.path.realpath(tmp_path / "a.pres"),))
    assert "body b" in "".join(line for _o, _f, line in entries)
    assert len(includes) == 1  # the circular hop was skipped
    _expand_includes("> include: ../outside.pres\n", str(tmp_path))
    out = capsys.readouterr().out
    assert "circular" in out and "outside the deck folder" in out


def test_build_annotations_and_invariant(deck):
    pdir = _course(deck)
    out = build_mod.build(str(pdir / "crs.pres"), dev=True)
    html = Path(out).read_text(encoding="utf-8")

    # all included content rendered
    for text in ("included body L1", "included body L2", "main outro body"):
        assert text in html
    # P8: every annotation is per-file — an element without data-rv-f points
    # into the main file; with data-rv-f=<idx> into that included file
    main_lines = MAIN.count("\n")
    for m in re.finditer(r'data-rv-src="(\d+)"(?! data-rv-f)', html):
        assert 1 <= int(m.group(1)) <= main_lines
    assert re.search(r'data-rv-src="\d+" data-rv-f="1"', html)
    assert re.search(r'data-rv-src="\d+" data-rv-f="2"', html)
    # the file table meta carries per-file shas
    fm = re.search(r'<meta name="rv-src-files" content="([^"]*)">', html)
    assert fm is not None
    import html as _html
    import json as _json
    table = _json.loads(_html.unescape(fm.group(1)))
    assert [t["path"] for t in table] == [
        "crs.pres", "lectures/l1.pres", "lectures/l2.pres"]
    assert all(len(t["sha256"]) == 64 for t in table)
    # the human hint marker is still emitted on included sections
    assert 'data-rv-inc="lectures/l1.pres"' in html

    # prod build: no dev markers at all
    prod = Path(build_mod.build(str(pdir / "crs.pres"))).read_text(encoding="utf-8")
    for marker in ("data-rv-inc", "data-rv-src", "data-rv-f=", "rv-src-files"):
        assert marker not in prod
    assert "included body L2" in prod


def test_collect_includes(deck):
    pdir = _course(deck)
    incs = collect_includes(str(pdir / "crs.pres"))
    assert [Path(i).name for i in incs] == ["l1.pres", "l2.pres"]
    assert all(Path(i).is_absolute() for i in incs)


def test_serve_tracks_includes_and_history_stages_them(deck):
    pdir = _course(deck)
    httpd, sess, stop = serve_mod.create_server(pdir / "crs.pres", port=0,
                                                watch=False)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        assert [Path(i).name for i in sess.includes] == ["l1.pres", "l2.pres"]
        if sess.history_mode == "git":
            # the initial auto-commit staged the included files too
            proc = serve_mod._hgit_text(pdir, "ls-files")
            assert "lectures/l1.pres" in proc.stdout
            assert "lectures/l2.pres" in proc.stdout
    finally:
        stop.set()
        httpd.shutdown()
