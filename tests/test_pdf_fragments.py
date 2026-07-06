"""P4d: pdfSeparateFragments — routes, fragment step counts, shot lists."""

from __future__ import annotations

from pathlib import Path

import pytest

from revealer import build as build_mod
from revealer.pdf import (
    _SEPARATE_RE,
    _count_fragment_steps,
    _route_segments,
    _routes,
    _shot_list,
)

PRES = """> title: Frag deck
> pdfSeparateFragments: true

=== One
always visible
> frag +
second
> end: frag
> frag +
third
> end: frag

=== Two

no fragments here

--- Stacked
> frag +3
explicit
> end: frag
"""


def test_setting_regex():
    assert _SEPARATE_RE.search("> pdfSeparateFragments: true\n")
    assert _SEPARATE_RE.search(">  pdfseparatefragments:  YES\n")
    assert not _SEPARATE_RE.search("> pdfSeparateFragments: false\n")


def test_count_fragment_steps_mixed():
    seg = ('<section><p class="fragment">a</p>'
           '<p class="fragment" data-fragment-index="2">b</p>'
           '<p class="fragment" data-fragment-index="2">c</p>'
           '<div class="x fragment y">d</div></section>')
    # 2 implicit (one step each) + one distinct explicit index
    assert _count_fragment_steps(seg) == 3
    assert _count_fragment_steps("<section><p>plain</p></section>") == 0


def test_routes_and_shots_on_built_deck(deck):
    pdir = deck(PRES, name="pf")
    out = build_mod.build(str(pdir / "pf.pres"))
    html = Path(out).read_text(encoding="utf-8")

    segs = _route_segments(html)
    assert _routes(html) == [(0, 0), (1, 0), (1, 1)]
    steps = {(h, v): _count_fragment_steps(seg) for h, v, seg in segs}
    assert steps[(0, 0)] == 2      # two implicit fragments
    assert steps[(1, 0)] == 0
    assert steps[(1, 1)] == 1      # one explicit index

    flat = _shot_list(html, separate=False)
    assert flat == ["#/0/0", "#/1/0", "#/1/1"]

    sep = _shot_list(html, separate=True)
    assert sep == ["#/0/0", "#/0/0/0", "#/0/0/1",
                   "#/1/0",
                   "#/1/1", "#/1/1/0"]


def test_export_cancel_before_render(deck, monkeypatch):
    """should_cancel firing on the first slide aborts with no output file."""
    from revealer import pdf as pdf_mod
    monkeypatch.setattr(pdf_mod, "_find_chrome", lambda: "/usr/bin/true")
    monkeypatch.setattr(pdf_mod.shutil, "which", lambda name: "/usr/bin/true")

    pdir = deck(PRES, name="pf")
    out = pdir / "pf.pdf"
    with pytest.raises(pdf_mod.ExportCancelled):
        pdf_mod.export_pdf(str(pdir / "pf.pres"), out=str(out),
                           log=lambda *a: None, should_cancel=lambda: True)
    assert not out.exists()  # nothing written on cancel


def test_missing_png_raises_not_silent_drop(deck, monkeypatch):
    """[6] Chrome exiting 0 without a PNG must abort, not ship a short PDF."""
    from revealer import pdf as pdf_mod
    monkeypatch.setattr(pdf_mod, "_find_chrome", lambda: "/usr/bin/true")
    monkeypatch.setattr(pdf_mod.shutil, "which", lambda name: "/usr/bin/true")
    monkeypatch.setattr(pdf_mod.subprocess, "run", lambda cmd, **kw: None)
    pdir = deck(PRES, name="pf")
    with pytest.raises(RuntimeError, match="rendered no image"):
        pdf_mod.export_pdf(str(pdir / "pf.pres"), out=str(pdir / "pf.pdf"),
                           log=lambda *a: None)


def test_chrome_failure_is_runtimeerror(deck, monkeypatch):
    """[7] A non-zero chrome exit surfaces as RuntimeError (cli catches that)."""
    import subprocess as sp

    from revealer import pdf as pdf_mod
    monkeypatch.setattr(pdf_mod, "_find_chrome", lambda: "/usr/bin/true")
    monkeypatch.setattr(pdf_mod.shutil, "which", lambda name: "/usr/bin/true")

    def fake_run(cmd, **kw):
        raise sp.CalledProcessError(1, cmd)

    monkeypatch.setattr(pdf_mod.subprocess, "run", fake_run)
    pdir = deck(PRES, name="pf")
    with pytest.raises(RuntimeError):
        pdf_mod.export_pdf(str(pdir / "pf.pres"), out=str(pdir / "pf.pdf"),
                           log=lambda *a: None)
