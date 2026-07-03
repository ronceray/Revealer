"""Shared fixtures: hermetic decks that build fully offline.

``build.build()`` only needs a ``reveal.js/`` folder next to the ``.pres``;
``generate_index_html`` writes the index from an in-code template and
``inject_revealer_assets`` copies package data — no network involved.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
DATA = Path(__file__).resolve().parent / "data"


@pytest.fixture()
def deck(tmp_path):
    """A factory: deck(pres_text) -> deck dir containing a ready-to-build .pres."""

    def make(pres_text: str, name: str = "test", media: dict[str, bytes] | None = None) -> Path:
        pdir = tmp_path / name
        (pdir / "reveal.js").mkdir(parents=True)
        (pdir / name).with_suffix(".pres")
        (pdir / (name + ".pres")).write_text(pres_text)
        for rel, content in (media or {}).items():
            dest = pdir / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(content)
        return pdir

    return make


@pytest.fixture()
def demo_deck(tmp_path):
    """A copy of the repo's Demo deck (with a minimal reveal.js scaffold)."""
    src = REPO / "Demo"
    pdir = tmp_path / "Demo"
    pdir.mkdir()
    for f in ("Demo.pres", "Simple.pres", "biblio.bib"):
        shutil.copyfile(src / f, pdir / f)
    if (src / "Media").is_dir():
        shutil.copytree(src / "Media", pdir / "Media")
    (pdir / "reveal.js").mkdir()
    return pdir
