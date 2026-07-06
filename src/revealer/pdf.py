"""PDF export for Revealer presentations.

reveal.js' built-in ``?print-pdf`` path does not cooperate with Revealer's
absolutely-positioned, JS-fitted content (it renders blank). Instead we render
one PNG per slide with headless Chrome — all fragments shown — and stitch the
images into a PDF with ``img2pdf``.

Requirements: a Chrome/Chromium binary and ``img2pdf`` on PATH.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from .build import build as build_presentation

_CHROME_NAMES = (
    "google-chrome-stable",
    "google-chrome",
    "chromium",
    "chromium-browser",
    "chrome",
)


class ExportCancelled(RuntimeError):
    """Raised when a PDF export is cancelled between slides."""


def _find_chrome() -> str | None:
    for name in _CHROME_NAMES:
        path = shutil.which(name)
        if path:
            return path
    return None


_INIT_RE = re.compile(r"Reveal\.initialize\(\{")


def _make_variant(html_path: Path) -> Path:
    """Write a sibling HTML with fragment gating disabled (all content shown)."""
    h = html_path.read_text(encoding="utf-8")
    if not _INIT_RE.search(h):
        raise RuntimeError(
            "cannot locate Reveal.initialize() in the built HTML — "
            "the PDF variant injection anchor is gone")
    h = _INIT_RE.sub("Reveal.initialize({ fragments: false,", h, count=1)
    h = h.replace(
        "</head>",
        "<style>.fragment{opacity:1!important;visibility:visible!important;}</style></head>",
    )
    variant = html_path.with_name("._pdf_variant-{0}.html".format(os.getpid()))
    variant.write_text(h, encoding="utf-8")
    return variant


def _route_segments(html: str) -> list[tuple[int, int, str]]:
    """(h, v, section_html) for every slide, in reveal navigation order."""
    marker = '<div class="slides">'
    if marker not in html:
        return [(0, 0, html)]
    body = html.split(marker, 1)[1]

    out: list[tuple[int, int, str]] = []
    depth = 0
    top_start = 0
    inner_start = 0
    inners: list[str] = []
    h = -1
    for m in re.finditer(r"<section\b[^>]*>|</section>", body):
        if m.group().startswith("</"):
            depth -= 1
            if depth == 1:
                inners.append(body[inner_start:m.end()])
            elif depth == 0:
                segment = body[top_start:m.end()]
                h += 1
                if inners:
                    out.extend((h, v, seg) for v, seg in enumerate(inners))
                    inners = []
                else:
                    out.append((h, 0, segment))
            elif depth < 0:
                break
        else:
            if depth == 0:
                top_start = m.start()
            elif depth == 1:
                inner_start = m.start()
            depth += 1
    return out or [(0, 0, html)]


def _routes(html: str) -> list[tuple[int, int]]:
    """Return the (horizontal, vertical) index of every slide, in order."""
    return [(h, v) for h, v, _seg in _route_segments(html)]


_FRAG_TAG_RE = re.compile(r"<[^>]*class=\"[^\"]*\bfragment\b[^\"]*\"[^>]*>")
_FRAG_IDX_RE = re.compile(r"data-fragment-index=\"(-?\d+)\"")


def _count_fragment_steps(segment: str) -> int:
    """Number of fragment steps on a slide.

    Distinct explicit ``data-fragment-index`` values are one step each;
    every index-less fragment is its own step (reveal assigns them
    sequential indexes). A mixed implicit/explicit slide can in principle
    overcount when reveal resolves an implicit fragment onto an explicit
    index — the extra screenshot then duplicates a state, never skips one.
    """
    explicit: set[int] = set()
    implicit = 0
    for tag in _FRAG_TAG_RE.findall(segment):
        m = _FRAG_IDX_RE.search(tag)
        if m:
            explicit.add(int(m.group(1)))
        else:
            implicit += 1
    return len(explicit) + implicit


_SEPARATE_RE = re.compile(
    r"^>\s*pdfSeparateFragments\s*:\s*(true|yes|on|1)\s*$", re.M | re.I)


def _shot_list(html: str, separate: bool) -> list[str]:
    """URL hash suffixes to screenshot, one per PDF page."""
    shots: list[str] = []
    for h, v, seg in _route_segments(html):
        shots.append("#/{0}/{1}".format(h, v))
        if separate:
            shots.extend("#/{0}/{1}/{2}".format(h, v, f)
                         for f in range(_count_fragment_steps(seg)))
    return shots


def export_pdf(pres_or_html: str, out: str | None = None, width: int = 1920,
               height: int = 1080, log=print, progress=None,
               separate_fragments: bool | None = None,
               should_cancel=None) -> str:
    """Export a presentation to PDF. Accepts a ``.pres`` (built first) or ``.html``.

    ``should_cancel`` (optional) is polled between slides; when it returns
    true the render aborts with :class:`ExportCancelled` and no file is
    written.
    """
    chrome = _find_chrome()
    if chrome is None:
        raise RuntimeError("No Chrome/Chromium found on PATH (needed for PDF export).")
    if shutil.which("img2pdf") is None:
        raise RuntimeError("img2pdf not found on PATH (install it for PDF export).")

    src = Path(pres_or_html).expanduser().resolve()
    if src.suffix == ".pres":
        html_path = Path(build_presentation(str(src)))
    else:
        html_path = src

    out_path = Path(out).expanduser().resolve() if out else html_path.with_suffix(".pdf")

    if separate_fragments is None and src.suffix == ".pres":
        separate_fragments = bool(
            _SEPARATE_RE.search(src.read_text(encoding="utf-8")))
    separate = bool(separate_fragments)

    html_text = html_path.read_text(encoding="utf-8")
    shots = _shot_list(html_text, separate)
    if separate:
        # fragment states are addressed on the UNMODIFIED deck (#/h/v/f);
        # a force-show variant would defeat the whole point
        variant = html_path
        log("Rendering {0} pages (fragments separated) to PDF...".format(len(shots)))
    else:
        variant = _make_variant(html_path)
        log("Rendering {0} slides to PDF...".format(len(shots)))

    pngs: list[str] = []
    try:
        with tempfile.TemporaryDirectory() as td:
            for i, suffix in enumerate(shots):
                if should_cancel is not None and should_cancel():
                    raise ExportCancelled("cancelled after {0}/{1} slides".format(
                        i, len(shots)))
                if progress is not None:
                    progress(i, len(shots))
                png = os.path.join(td, "slide_{0:03d}.png".format(i))
                url = "file://{0}{1}".format(variant, suffix)
                subprocess.run(
                    [
                        chrome,
                        "--headless=new",
                        "--disable-gpu",
                        "--no-sandbox",
                        "--hide-scrollbars",
                        "--force-device-scale-factor=1",
                        "--window-size={0},{1}".format(width, height),
                        "--virtual-time-budget=9000",
                        "--run-all-compositor-stages-before-draw",
                        "--screenshot={0}".format(png),
                        url,
                    ],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                if os.path.exists(png):
                    pngs.append(png)
            if not pngs:
                raise RuntimeError("No slides were rendered.")
            subprocess.run(["img2pdf", "--output", str(out_path), *pngs], check=True)
    finally:
        if variant != html_path:
            try:
                variant.unlink()
            except OSError:
                pass

    log("Wrote {0}".format(out_path))
    return str(out_path)
