"""Test helpers for build/round-trip invariants."""

from __future__ import annotations

import re
from pathlib import Path

from revealer.build import build

# Everything a dev build may add on top of a prod build.
_DEV_META_RE = re.compile(r'<meta name="rv-src-(?:file|sha)" content="[^"]*">\n')
_SRC_ATTR_RE = re.compile(r' data-rv-(?:src|src-end|implicit)="[^"]*"')


def build_deck(pdir: Path, name: str = "test", dev: bool = False) -> str:
    """Build <pdir>/<name>.pres and return the generated HTML text."""
    out = build(str(Path(pdir) / (name + ".pres")), dev=dev)
    return Path(out).read_text()


def strip_dev(html: str) -> str:
    """Remove every dev-only addition from a dev build's HTML."""
    html = _DEV_META_RE.sub("", html)
    html = _SRC_ATTR_RE.sub("", html)
    return html


def src_annotations(html: str) -> list[tuple[int, int | None]]:
    """All (data-rv-src, data-rv-src-end|None) pairs found in the HTML."""
    out = []
    for m in re.finditer(r'data-rv-src="(\d+)"(?: data-rv-src-end="(\d+)")?', html):
        out.append((int(m.group(1)), int(m.group(2)) if m.group(2) else None))
    return out
