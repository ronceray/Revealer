"""Guards for the P9 localization work.

(a) The editor catalog (editor/i18n.js) must define identical key sets for
    ``en`` and ``fr`` — a missing translation would silently fall back to
    English at runtime, so we catch it here instead.
(b) The CLI catalog (revealer.i18n) must likewise have matching key sets.
(c) A representative sample of high-visibility strings must actually be wired
    through RV.t / i18n.t — the old hardcoded literals are gone. Scoped to a
    curated handful of known call sites (not an exhaustive sweep).
"""

from __future__ import annotations

import re
from pathlib import Path

from revealer import i18n

REPO = Path(__file__).resolve().parents[1]
EDITOR = REPO / "src" / "revealer" / "data" / "js" / "editor"

_KEY_RE = re.compile(r"^\s*['\"]([\w.]+)['\"]\s*:", re.M)


def _editor_catalogs() -> tuple[list[str], list[str]]:
    """Return (en_keys, fr_keys) parsed from the two marked object literals."""
    js = (EDITOR / "i18n.js").read_text(encoding="utf-8")
    assert "/* i18n:en */" in js and "/* i18n:fr */" in js, "catalog markers missing"
    en_part = js.split("/* i18n:en */", 1)[1].split("/* i18n:fr */", 1)[0]
    fr_part = js.split("/* i18n:fr */", 1)[1]
    return _KEY_RE.findall(en_part), _KEY_RE.findall(fr_part)


def test_editor_catalog_parity():
    en, fr = _editor_catalogs()
    assert len(en) == len(set(en)), "duplicate keys in the editor en catalog"
    assert len(fr) == len(set(fr)), "duplicate keys in the editor fr catalog"
    assert set(en) == set(fr), (
        "editor en/fr key sets differ: "
        "en-only={0} fr-only={1}".format(
            sorted(set(en) - set(fr)), sorted(set(fr) - set(en)))
    )
    assert len(en) > 50, "the editor catalog looks suspiciously small"


def test_cli_catalog_parity():
    en, fr = set(i18n.CATALOG["en"]), set(i18n.CATALOG["fr"])
    assert en == fr, "CLI en/fr key sets differ: en-only={0} fr-only={1}".format(
        sorted(en - fr), sorted(fr - en))
    assert len(en) > 15, "the CLI catalog looks suspiciously small"


def test_cli_translation_interpolates_and_localizes(monkeypatch):
    # English by default, French when LANG is fr*, with param interpolation.
    monkeypatch.delenv("LC_ALL", raising=False)
    monkeypatch.delenv("LC_MESSAGES", raising=False)
    monkeypatch.setenv("LANG", "en_US.UTF-8")
    assert i18n.t("cli.built", path="deck.html") == "[green]Built[/green] deck.html"
    monkeypatch.setenv("LANG", "fr_FR.UTF-8")
    assert i18n.t("cli.built", path="deck.html") == "[green]Compilé[/green] deck.html"
    # An unknown key falls back to the key itself.
    assert i18n.t("cli.does_not_exist") == "cli.does_not_exist"


def test_high_visibility_strings_are_wired_through_rv_t():
    """A curated sample: known call sites use RV.t, old literals are gone."""
    shell = (EDITOR / "shell.js").read_text(encoding="utf-8")
    panel = (EDITOR / "panel.js").read_text(encoding="utf-8")
    drawer = (EDITOR / "drawer.js").read_text(encoding="utf-8")
    history = (EDITOR / "history.js").read_text(encoding="utf-8")
    outline = (EDITOR / "outline.js").read_text(encoding="utf-8")

    # Converted call sites exist.
    for needle in ("RV.t('toast.exportCancelled')", "RV.t('export.cancel')",
                   "RV.t('toolbar.editTitle')"):
        assert needle in shell, "shell.js missing " + needle
    for needle in ("RV.t('panel.nothing')", "RV.t('panel.delete')"):
        assert needle in panel, "panel.js missing " + needle
    assert "RV.t('drawer.title')" in drawer
    assert "RV.t('history.title')" in history
    assert "RV.t('outline.title')" in outline

    # Old hardcoded literals no longer appear in the modules (only in i18n.js).
    assert "'Export cancelled'" not in shell
    assert "'Exporting slide '" not in shell
    assert "Nothing selected" not in panel
    assert "Fragments (reveal order)" not in drawer
    assert "Save history" not in history      # the box title moved to the catalog
    assert "title: 'Slides'" not in outline
