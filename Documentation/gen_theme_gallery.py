"""Regenerate the theme-gallery screenshots embedded in ``themes.md``.

``Demo/Themes.pres`` renders one identical slide per theme (via the
per-slide ``> theme:`` switch). This script screenshots each of those
slides with headless Chrome into ``Documentation/_static/themes/<theme>.png``
— the images committed and shown in the docs' theme gallery.

Usage (requires Chrome/Chromium; run from anywhere):

    revealer build Demo/Themes.pres        # or the dev CLI equivalent
    python3 Documentation/gen_theme_gallery.py

Unlike ``gen_reference.py`` this does NOT run at Sphinx build time — it
needs a built deck and a browser. Re-run it after adding a theme to
``Demo/Themes.pres`` (and list the new theme in ``themes.md``).

Stdlib only.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent
REPO = DOCS.parent
PRES = REPO / "Demo" / "Themes.pres"
HTML = REPO / "Demo" / "Themes.html"
OUT = DOCS / "_static" / "themes"

CHROME_NAMES = ("google-chrome", "google-chrome-stable", "chromium",
                "chromium-browser", "chrome")
SIZE = "960,540"


def _chrome() -> str:
    for name in CHROME_NAMES:
        path = shutil.which(name)
        if path:
            return path
    sys.exit("gen_theme_gallery: no Chrome/Chromium on PATH")


def _themes() -> list[str]:
    """Theme slide order = the `> theme:` lines of Themes.pres."""
    lines = PRES.read_text(encoding="utf-8").splitlines()
    return [m.group(1) for l in lines
            if (m := re.match(r">\s*theme:\s*(\S+)\s*$", l))]


def main() -> None:
    if not HTML.is_file():
        sys.exit("gen_theme_gallery: build Demo/Themes.pres first "
                 "(revealer build Demo/Themes.pres)")
    chrome = _chrome()
    OUT.mkdir(parents=True, exist_ok=True)
    themes = _themes()
    if not themes:
        sys.exit("gen_theme_gallery: no `> theme:` lines found in Themes.pres")
    for i, theme in enumerate(themes, start=1):  # slide 0 is the title slide
        png = OUT / (theme + ".png")
        cmd = [chrome, "--headless=new", "--disable-gpu", "--no-sandbox",
               "--hide-scrollbars", "--force-device-scale-factor=1",
               "--virtual-time-budget=9000",
               "--run-all-compositor-stages-before-draw",
               "--window-size=" + SIZE, "--screenshot=" + str(png),
               "file://{0}#/{1}".format(HTML, i)]
        res = subprocess.run(cmd, capture_output=True)
        if res.returncode != 0 or not png.is_file() or png.stat().st_size == 0:
            sys.exit("gen_theme_gallery: Chrome failed on slide {0} ({1})"
                     .format(i, theme))
        print("wrote {0}".format(png.relative_to(REPO)))
    print("{0} themes captured".format(len(themes)))


if __name__ == "__main__":
    main()
