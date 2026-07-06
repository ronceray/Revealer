"""P4b: palette-matched .mplstyle files ship with every deck's theme dir."""

from __future__ import annotations

from pathlib import Path

import pytest

from revealer import assets

THEMES = Path(assets.__file__).parent / "data" / "themes"

PRES = """> title: Style test

=== One

x
"""


def test_every_theme_has_a_matching_mplstyle():
    css = {p.stem for p in THEMES.glob("*.css")} - {"_revealer-base"}
    mpl = {p.stem for p in THEMES.glob("*.mplstyle")}
    assert css <= mpl, "themes missing an .mplstyle: {0}".format(css - mpl)


def test_mplstyles_land_in_deck_theme_dir(deck):
    pdir = deck(PRES, name="mp")
    assets.inject_revealer_assets(pdir / "reveal.js")
    dest = pdir / "reveal.js" / "dist" / "theme"
    for src in THEMES.glob("*.mplstyle"):
        assert (dest / src.name).is_file(), src.name


def test_mplstyles_parse_in_matplotlib():
    matplotlib = pytest.importorskip("matplotlib")
    for src in THEMES.glob("*.mplstyle"):
        params = matplotlib.rc_params_from_file(
            str(src), use_default_template=False)
        assert "axes.prop_cycle" in params, src.name
        assert "font.sans-serif" in params, src.name
