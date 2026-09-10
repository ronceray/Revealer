"""Layout-time diagnostics for a deck — the engine behind ``revealer check``.

The build's warnings are parse-time only. Everything that goes wrong at
*layout* time is invisible to them: a callout overflowing its pinned row onto
the figure below, a line of content pushing the citation off the bottom edge, a
logo strip rendered under the slide box, a media card cropped through an axis
label. A full review pass over a 24-slide deck found five such faults with the
build reporting zero warnings; screenshotting every slide and reading the
images was the only detection mechanism.

This module drives the same headless Chrome the PDF export already needs:
build a dev variant (source-line annotations, fragments forced visible so each
slide is measured in its most crowded state), load it ONCE, let
``data/check.js`` walk the deck in-page, and decode the findings it leaves in
the DOM. Findings are reported in the parser's own ``Warning: ...`` format, so
"zero warnings" comes to mean the deck is actually presentable.
"""

from __future__ import annotations

import base64
import html
import json
import re
import secrets
import subprocess
from pathlib import Path

from .build import build as build_presentation
from .build import slide_index
from .pdf import _find_chrome

DATA = Path(__file__).parent / "data"

# Findings are grouped by kind so a deck can silence a class it has decided
# about (`--skip crop`), and so the summary line reads usefully.
KINDS = ("overflow", "offslide", "crop", "empty", "sparse")

_OUT_RE = re.compile(r'<div id="rv-check-out" data-json="([^"]*)"')
_INIT_RE = re.compile(r"Reveal\.initialize\(\{")


class CheckError(RuntimeError):
    """The check could not run (no Chrome, a build failure, a broken page)."""


def _make_variant(dev_html: Path, opts: dict) -> Path:
    """A sibling of the dev build wired for one measuring pass.

    Fragments are shown and gating disabled (the crowded state is the one
    worth measuring), transitions are off so nothing is measured mid-fade,
    and the probe is appended with its options.
    """
    text = dev_html.read_text(encoding="utf-8")
    if not _INIT_RE.search(text):
        raise CheckError(
            "cannot locate Reveal.initialize() in the built HTML — "
            "the check injection anchor is gone")
    text = _INIT_RE.sub("Reveal.initialize({ fragments: false,", text, count=1)
    probe = (DATA / "check.js").read_text(encoding="utf-8")
    text = text.replace(
        "</head>",
        "<style>.fragment{opacity:1!important;visibility:visible!important;}"
        "*{transition:none !important;animation:none !important;}</style>"
        "</head>", 1)
    text = text.replace(
        "</body>",
        "<script>window.__RV_CHECK_OPTS__ = {0};</script>\n"
        "<script>{1}</script>\n</body>".format(json.dumps(opts), probe), 1)
    variant = dev_html.with_name("._check-{0}.html".format(secrets.token_hex(6)))
    variant.write_text(text, encoding="utf-8")
    return variant


def _run_probe(variant: Path, timeout: int = 240) -> dict:
    chrome = _find_chrome()
    if chrome is None:
        raise CheckError(
            "No Chrome/Chromium found on PATH (needed to measure the layout).")
    try:
        proc = subprocess.run(
            [
                chrome,
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--hide-scrollbars",
                "--force-device-scale-factor=1",
                "--window-size=1920,1080",
                # Virtual time: the whole deck walk costs almost no wall clock,
                # but every timer the fit engine schedules still fires in order.
                "--virtual-time-budget=600000",
                "--run-all-compositor-stages-before-draw",
                "--dump-dom",
                "file://{0}".format(variant),
            ],
            check=True, capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise CheckError("Chrome timed out measuring the deck.") from exc
    except subprocess.CalledProcessError as exc:
        raise CheckError(
            "Chrome failed measuring the deck (exit {0}).".format(exc.returncode)
        ) from exc
    m = _OUT_RE.search(proc.stdout)
    if not m:
        raise CheckError(
            "the layout probe produced no result — the page may have failed to "
            "load (try opening the deck in a browser).")
    payload = json.loads(
        base64.b64decode(html.unescape(m.group(1))).decode("utf-8"))
    if not payload.get("ok"):
        raise CheckError("the layout probe failed: {0}".format(
            payload.get("error", "unknown error")))
    return payload


def _file_table(dev_html: Path) -> list[str]:
    """Paths of the source files a dev build was made from (index 0 = main)."""
    m = re.search(r'<meta name="rv-src-files" content="([^"]*)"',
                  dev_html.read_text(encoding="utf-8"))
    if not m:
        return [""]
    try:
        table = json.loads(html.unescape(m.group(1)))
    except ValueError:
        return [""]
    return [""] + [e.get("path", "") for e in table[1:]]


def check(pres: str, dead_space: bool = False, skip: tuple = (),
          keep_dev: bool | None = None) -> dict:
    """Measure a deck's rendered layout. Returns the probe payload, annotated.

    Each finding gains ``where`` (``slide 8/1``) and ``at`` (``file:line``),
    ready to print. Nothing is written to the deck except the dev build the
    measurement needs (removed again unless it was already there).
    """
    pfile = Path(pres).expanduser().resolve()
    dev_path = pfile.with_name(pfile.stem + ".dev.html")
    existed = dev_path.exists() if keep_dev is None else bool(keep_dev)
    dev_html = Path(build_presentation(str(pfile), dev=True))
    variant = _make_variant(dev_html, {"deadSpace": bool(dead_space)})
    try:
        payload = _run_probe(variant)
    finally:
        try:
            variant.unlink()
        except OSError:
            pass
        if not existed:
            try:
                dev_html.unlink()
            except OSError:
                pass

    files = _file_table(dev_html) if dev_html.exists() else [""]
    # The .pres reading of each slide, so a finding can name the slide the
    # way `revealer index` does even when the section carries no title.
    try:
        titles = {e["index"]: e["title"] for e in slide_index(str(pfile))
                  if e["index"] is not None}
    except OSError:
        titles = {}

    findings = []
    for slide in payload.get("slides", []):
        for f in slide.get("findings", []):
            if f["kind"] in skip:
                continue
            f["where"] = "slide {0}".format(slide["index"])
            f["title"] = slide.get("title") or titles.get(slide["index"], "")
            f["at"] = _at(f.get("line"), f.get("file"), files)
            findings.append(f)
    for f in payload.get("bands", []):
        if f["kind"] in skip:
            continue
        f["where"] = "deck"
        f["title"] = ""
        f["at"] = ""
        findings.append(f)

    payload["findings"] = findings
    payload["files"] = files
    return payload


def _at(line, file_idx, files) -> str:
    if not line:
        return ""
    try:
        name = files[int(file_idx)] if file_idx else ""
    except (ValueError, IndexError):
        name = ""
    return "{0}:{1}".format(name, line) if name else "line {0}".format(line)


def format_findings(payload: dict) -> list[str]:
    """The findings as ``Warning:`` lines, in the parser's own format."""
    out = []
    for f in payload.get("findings", []):
        where = f["where"]
        if f.get("title"):
            where += " ({0})".format(f["title"])
        if f.get("at"):
            where += " {0}".format(f["at"])
        out.append("Warning: {0}: {1}".format(where, f["message"]))
    return out


def run_check(pres: str, dead_space: bool = False, skip: tuple = (),
              log=print) -> int:
    """Check a deck and print the findings. Returns the number of findings."""
    payload = check(pres, dead_space=dead_space, skip=skip)
    lines = format_findings(payload)
    for line in lines:
        log(line)
    n_slides = len(payload.get("slides", []))
    if lines:
        kinds = {}
        for f in payload["findings"]:
            kinds[f["kind"]] = kinds.get(f["kind"], 0) + 1
        summary = ", ".join("{0} {1}".format(v, k) for k, v in sorted(kinds.items()))
        log("{0} finding(s) over {1} slides ({2}).".format(
            len(lines), n_slides, summary))
    else:
        log("No layout problems over {0} slides.".format(n_slides))
    return len(lines)


__all__ = ["check", "run_check", "format_findings", "CheckError", "KINDS"]
