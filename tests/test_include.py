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
    entries, includes = _expand_includes(MAIN, str(pdir))
    # main lines keep their numbers; included lines carry None + file name
    origins = [(o, f) for o, f, _line in entries]
    assert (1, None) in origins                       # settings line
    assert (None, "lectures/l1.pres") in origins      # from l1
    assert (None, "l2.pres") in origins               # nested, nearest file
    assert [o for o, f in origins if o is not None] == sorted(
        o for o, f in origins if o is not None)
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
    # every data-rv-src points into the MAIN file (invariant by construction)
    main_lines = MAIN.count("\n")
    for m in re.finditer(r'data-rv-src="(\d+)"', html):
        assert 1 <= int(m.group(1)) <= main_lines
    # included slides carry the data-rv-inc marker instead
    assert 'data-rv-inc="lectures/l1.pres"' in html
    assert 'data-rv-inc="l2.pres"' in html
    # included body text sits in elements without provenance
    frag = html.split("included body L1")[0].rsplit("<", 1)[0]
    assert "data-rv-src" not in frag.split("<section")[-1]

    # prod build: no dev markers at all
    prod = Path(build_mod.build(str(pdir / "crs.pres"))).read_text(encoding="utf-8")
    assert "data-rv-inc" not in prod and "data-rv-src" not in prod
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
