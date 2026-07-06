"""Committed goldens: the prod build output is frozen byte-for-byte.

Regenerate deliberately with:  UPDATE_GOLDEN=1 pytest tests/test_build_golden.py
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from helpers import build_deck
from test_srcmap import FULL, MEDIA

GOLDEN = Path(__file__).parent / "data" / "golden"


def _check(name: str, html: str):
    path = GOLDEN / (name + ".html")
    if os.environ.get("UPDATE_GOLDEN"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(html, encoding="utf-8")
        pytest.skip("golden updated")
    assert path.is_file(), (
        "missing golden {0} — run UPDATE_GOLDEN=1 pytest to create".format(path.name))
    assert html == path.read_text(encoding="utf-8"), (
        "{0} changed byte-wise vs golden; if intended, UPDATE_GOLDEN=1".format(name))


def test_golden_full_fixture(deck):
    _check("full", build_deck(deck(FULL, media=MEDIA)))


def test_golden_demo(demo_deck):
    _check("demo", build_deck(demo_deck, name="Demo"))


def test_golden_simple(demo_deck):
    _check("simple", build_deck(demo_deck, name="Simple"))
