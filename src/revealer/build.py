"""Build a reveal.js HTML presentation from a ``.pres`` source file.

This module contains the historical Revealer build logic, refactored into
importable functions and with several bugs fixed:

* bibtex entries without a ``journal`` field no longer crash the build;
* ``maxRefsPerPage`` is always coerced to an integer;
* bare ``except:`` clauses have been narrowed;
* the template file handle is closed via a context manager;
* bullet lists and column blocks left open at the end of a slide are closed;
* no personal path is hard-coded any more.

It also adds inline SVG animation driven from the ``.pres`` file (see
``> svg:`` and ``> animate:`` commands).
"""

from __future__ import annotations

import hashlib
import json as _json
import os
import re
import shutil
import subprocess
from pathlib import Path

from . import assets
from . import grammar as _grammar


class _SimpleBibBase:
    def __init__(self, entries):
        self.entries = entries


def _strip_bib_value(value: str) -> str:
    value = value.strip().rstrip(",").strip()
    while len(value) >= 2 and ((value[0] == "{" and value[-1] == "}") or (value[0] == '"' and value[-1] == '"')):
        value = value[1:-1].strip()
    return value.replace("\n", " ")


def _parse_bib_fields(body: str) -> dict[str, str]:
    fields = {}
    chunks = []
    start = 0
    depth = 0
    quote = False
    for index, char in enumerate(body):
        if char == '"' and (index == 0 or body[index - 1] != "\\"):
            quote = not quote
        elif not quote:
            if char == "{":
                depth += 1
            elif char == "}" and depth:
                depth -= 1
            elif char == "," and depth == 0:
                chunks.append(body[start:index])
                start = index + 1
    chunks.append(body[start:])

    for chunk in chunks:
        match = re.match(r"\s*([A-Za-z][\w-]*)\s*=\s*(.*)\s*$", chunk, re.DOTALL)
        if match:
            fields[match.group(1).lower()] = _strip_bib_value(match.group(2))
    return fields


def _parse_bibtex_fallback(text: str):
    entries = []
    pos = 0
    while True:
        at = text.find("@", pos)
        if at == -1:
            break
        brace = text.find("{", at)
        if brace == -1:
            break
        comma = text.find(",", brace)
        if comma == -1:
            break

        key = text[brace + 1:comma].strip()
        depth = 1
        end = comma + 1
        while end < len(text) and depth:
            if text[end] == "{":
                depth += 1
            elif text[end] == "}":
                depth -= 1
            end += 1

        entry = _parse_bib_fields(text[comma + 1:end - 1])
        if key:
            entry["ID"] = key
            entries.append(entry)
        pos = end
    return _SimpleBibBase(entries)


def _append_setting(target: dict, key: str, value: str) -> None:
    if key in target:
        if not isinstance(target[key], list):
            target[key] = [target[key]]
        target[key].append(value)
    else:
        target[key] = value


def _as_list(value) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


_NEWCOMMAND_RE = re.compile(
    r"\\(?:re)?newcommand\*?\s*\{?\\(\w+)\}?\s*(?:\[(\d+)\])?\s*\{")


def _parse_tex_macros(text: str) -> dict[str, str]:
    r"""Extract ``\newcommand``-style macros from LaTeX source.

    Returns ``{"\\name": "body"}`` pairs for KaTeX's ``macros`` option
    (KaTeX infers the argument count from the highest ``#n`` in the body,
    so the ``[n]`` declaration can be dropped). Bodies are read with a
    balanced-brace scan, so nested groups survive.
    """
    # Drop LaTeX comments (unescaped % to end of line) so a commented-out
    # \newcommand is never ingested.
    text = re.sub(r"(?<!\\)%.*", "", text)
    macros: dict[str, str] = {}
    for m in _NEWCOMMAND_RE.finditer(text):
        depth, i = 1, m.end()
        start = i
        while i < len(text) and depth:
            if text[i] == "{" and text[i - 1] != "\\":
                depth += 1
            elif text[i] == "}" and text[i - 1] != "\\":
                depth -= 1
            i += 1
        if depth == 0:
            macros["\\" + m.group(1)] = text[start:i - 1].strip()
    return macros


def _parse_inline_macro(value: str) -> tuple[str, str] | None:
    """``> macro: \\half \\frac{1}{2}`` -> (``\\half``, ``\\frac{1}{2}``)."""
    m = re.match(r"\s*(\\\w+)\s+(\S.*)$", value)
    return (m.group(1), m.group(2).strip()) if m else None


def _strip_tags(value: str) -> str:
    return re.sub(r"<[^>]*>", "", value)


def _initials(value: str) -> str:
    words = re.findall(r"\b\w", _strip_tags(value), flags=re.UNICODE)
    return "".join(words[:2]).upper()


def _format_bib_author_short(author: str) -> str:
    author = " ".join(author.replace("\n", " ").split())
    if not author:
        return ""

    if "," in author:
        family, given = [part.strip() for part in author.split(",", 1)]
    else:
        parts = author.split(" ")
        family = parts[-1]
        given = " ".join(parts[:-1])

    initials = "".join(part[0] + ". " for part in re.findall(r"\b\w+", given, flags=re.UNICODE))
    return initials + family


class Bibtex:
    """Minimal bibtex reader producing short/long HTML descriptions."""

    JOURNAL_SHORT = {
        "Proceedings of the National Academy of Sciences of the United States of America": "PNAS",
        "Physical Review Letters": "PRL",
        "eLife": "eLife",
    }

    def __init__(self, bibfile: str, pdir: str):
        self.error = None
        self.item_num = []
        self.item_tag = {}

        bfile = os.path.join(pdir, bibfile)
        if not os.path.exists(bfile):
            self.error = 'Bibtex file "{:s}" not found.'.format(bfile)
            return

        with open(bfile) as bibtex_file:
            try:
                import bibtexparser
            except ImportError:
                self.base = _parse_bibtex_fallback(bibtex_file.read())
            else:
                self.base = bibtexparser.load(bibtex_file)

    def add_entry(self, tag):
        if self.error is not None:
            return False
        if tag in self.item_tag:
            return True

        for entry in self.base.entries:
            if entry.get("ID") != tag:
                continue

            # Append entry
            self.item_num.append(entry)
            self.item_tag[tag] = entry
            entry["revealer-number"] = len(self.item_num)

            # Author short description
            al = entry.get("author", "").split(" and ")
            sd = ""
            for i, a in enumerate(al):
                sd += _format_bib_author_short(a)

                if len(al) > 2:
                    sd += " <i>et al.</i>"
                    break
                elif i < len(al) - 1:
                    sd += ", "
            entry["authors-short"] = sd

            # Journal short description
            journal = entry.get("journal")
            if journal is not None:
                entry["journal-short"] = self.JOURNAL_SHORT.get(journal, journal)
            break

        return tag in self.item_tag

    def short_description(self, tag):
        if self.error is not None:
            return ""
        item = self.item_tag[tag]
        if "journal-short" in item:
            return "{:d}. {:s}, <i>{:s}</i> ({:s})".format(
                item["revealer-number"], item["authors-short"], item["journal-short"], item.get("year", "")
            )
        return "{:d}. {:s} ({:s})".format(
            item["revealer-number"], item["authors-short"], item.get("year", "")
        )

    def long_description(self, tag):
        if self.error is not None:
            return ""
        item = self.item_tag[tag]
        return "{:d}. {:s}: {:s} {:s} {:s} {:s}".format(
            item["revealer-number"],
            item["authors-short"],
            "<i>" + item["title"] + "</i>," if "title" in item else "",
            item.get("journal", ""),
            "(" + item["year"] + ")" if "year" in item else "",
            ' - <a class="doi" href="https://doi.org/{0}">{0}</a>'.format(item["doi"]) if "doi" in item else "",
        )


def _is_truthy(value: str) -> bool:
    return value.strip().lower() in {"true", "yes", "1", "on"}


# --- Source provenance --------------------------------------------------------
#
# Every line list flowing through the content pipeline is accompanied by a
# parallel "source map": a list of 1-based `.pres` line numbers (or None for
# synthetic lines) with the same indices. The map is threaded unconditionally
# so there is a single code path; only the *emission* of `data-rv-src`
# attributes is gated on dev builds (see `build(dev=True)`), which keeps
# normal builds byte-identical.

_DEV = False


def _src_attr(start: int | None, end: int | None = None) -> str:
    """The dev-only provenance attribute(s) for an emitted element.

    Origins are stride-encoded (see ``_FILE_STRIDE``); elements from an
    included file carry ``data-rv-f`` with the file-table index. A span
    crossing a file boundary keeps only its start (never a wrong span).
    """
    if not _DEV or start is None:
        return ""
    f, own = divmod(int(start), 10_000_000)
    out = ' data-rv-src="{0}"'.format(own)
    if f:
        out += ' data-rv-f="{0}"'.format(f)
    if end is not None and end != start:
        fe, own_e = divmod(int(end), 10_000_000)
        if fe == f and own_e != own:
            out += ' data-rv-src-end="{0}"'.format(own_e)
    return out


def _nosrc(lines: list) -> list:
    return [None] * len(lines)


def _trim_empty_edges(lines: list, src: list) -> tuple[list, list]:
    """Drop empty edge lines — the lockstep twin of ``text.strip("\\n")``."""
    start, end = 0, len(lines)
    while start < end and lines[start] == "":
        start += 1
    while end > start and lines[end - 1] == "":
        end -= 1
    return lines[start:end], src[start:end]


def _trim_ws_edges(lines: list, src: list) -> tuple[list, list]:
    """The lockstep twin of ``"\\n".join(lines).strip().split("\\n")``.

    Whitespace-only edge lines are dropped, and the first / last surviving
    lines are lstripped / rstripped, exactly like ``str.strip()`` acting on
    the joined text. Degenerate all-whitespace input yields ``([""], [None])``
    to mirror ``"".split("\\n") == [""]``.
    """
    start, end = 0, len(lines)
    while start < end and lines[start].strip() == "":
        start += 1
    while end > start and lines[end - 1].strip() == "":
        end -= 1
    if start == end:
        return [""], [None]
    out = list(lines[start:end])
    out[0] = out[0].lstrip()
    out[-1] = out[-1].rstrip()
    return out, src[start:end]


# --- Block / paragraph model ------------------------------------------------
#
# A slide's (or column's) content is organised as blocks (columns) laid out
# horizontally, each split into paragraphs separated by blank lines. `size` and
# `align` directives resolve to a scope (presentation / slide / block /
# paragraph) depending on where they appear (see the documentation).


_SCOPED_DIRECTIVE_RE = re.compile(r"^>\s*(size|align|paragraph[-_]spacing)\s*:\s*(.*)$")
_TABLE_OPEN_RE = re.compile(r"^>\s*table\(\s*\d+\s*,\s*\d+\s*\)\s*$")
_TABLE_END_RE = re.compile(r"^>\s*end\s*:\s*table\s*$")
# Block macros of the layout DSL (grid / pin / row / callouts / eq / frag /
# stack): their whole `> xxx` .. `> end: xxx` span is kept atomic through
# block / paragraph splitting, like code blocks and tables.
_MACRO_OPEN_RE = re.compile(_grammar.macro_open_pattern())

# Legacy-renderer dispatch order/patterns derive from the registry. `box`
# uses a capturing variant group so the handler learns which callout kind.
_DISPATCH: list[tuple[str, re.Pattern]] = [
    (name, re.compile(r"^>\s*(info|warn|good)\b" if name == "box"
                      else _grammar.dispatch_pattern(name)))
    for name, spec in _grammar.REGISTRY.items()
    if spec.terminator is _grammar.Terminator.END_PAIRED
    and spec.name != "code"
]
_BLOCK_END_RE = re.compile(r"^>\s*end\s*:\s*\w+\s*$")


_MARKDOWN = True  # set per-build from `> markdown:` (default on)

_PDIR = ""  # deck folder of the build in progress (set per-build)


def _figure_src(path: str) -> str:
    """Media path hook: PDF figures are converted to cached SVGs.

    ``fig.pdf`` → ``Media/.rv-cache/fig.svg`` via ``pdftocairo -svg``,
    reconverted only when the PDF is newer than the cache. Non-PDF paths
    pass through untouched.
    """
    if not path.lower().endswith(".pdf") or not _PDIR:
        return path
    src = os.path.join(_PDIR, path)
    if not os.path.isfile(src):
        return path  # broken path: let the browser show the missing image
    cache_dir = os.path.join(_PDIR, "Media", ".rv-cache")
    stem = os.path.splitext(os.path.basename(path))[0]
    dest = os.path.join(cache_dir, stem + ".svg")
    if not os.path.isfile(dest) or os.path.getmtime(dest) < os.path.getmtime(src):
        if shutil.which("pdftocairo") is None:
            raise RuntimeError(
                "PDF figure {0} needs 'pdftocairo' (install poppler-utils)".format(path))
        os.makedirs(cache_dir, exist_ok=True)
        proc = subprocess.run(
            ["pdftocairo", "-svg", src, dest],
            capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise RuntimeError(
                "pdftocairo failed on {0}: {1}".format(path, proc.stderr.strip()[-400:]))
    return "Media/.rv-cache/{0}.svg".format(stem)


_BUILD_HOOK_RE = re.compile(r"^>\s*build\s*:\s*(.+?)\s*$")
_SLIDE_MARKER_RE = re.compile(r"^(>>> first:|>>> biblio|=== |--- |%%% )")


def _run_build_hooks(pdir: str, pres_text: str) -> None:
    """Run `> build: <command>` hooks (settings block) before compiling.

    Commands run in the deck folder, so figure-generation scripts and
    Makefiles regenerate media before it is read. A failing hook aborts the
    build with the command's output (surfaced in the dev-server overlay).
    """
    for line in pres_text.split("\n"):
        if _SLIDE_MARKER_RE.match(line):
            break
        m = _BUILD_HOOK_RE.match(line)
        if not m:
            continue
        cmd = m.group(1)
        proc = subprocess.run(
            cmd, shell=True, cwd=pdir, capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise RuntimeError(
                "build hook failed ({0}):\n{1}".format(
                    cmd, (proc.stderr or proc.stdout).strip()[-800:]))


_MD_PROTECT_RE = re.compile(r"(\$\$.+?\$\$|\$[^$\n]+\$|<[^>]*>)")
_MD_SPAN_RE = re.compile(r"\[([^\[\]]+)\]\{([^{}]+)\}")
_MD_LINK_RE = re.compile(r"\[([^\[\]]+)\]\(([^()\s]+)\)")
_MD_CODE_RE = re.compile(r"`([^`]+)`")
_MD_BOLD_RE = re.compile(r"\*\*(\S(?:[^*]*?\S)?)\*\*")
_MD_ITAL_RE = re.compile(r"(?<![\w*])\*(\S(?:[^*]*?\S)?)\*(?![\w*])")


def _md_span_sub(m):
    classes, styles = [], []
    for a in m.group(2).split():
        if re.match(r"^\.[A-Za-z][\w-]*$", a):
            classes.append(a[1:])
        elif a.startswith("color="):
            styles.append("color:" + _escape_attr(a[6:]))
        elif a.startswith("size="):
            styles.append("font-size:" + _escape_attr(a[5:]))
    attr = ""
    if classes:
        attr += ' class="{0}"'.format(" ".join(classes))
    if styles:
        attr += ' style="{0}"'.format(";".join(styles))
    if not attr:
        return m.group(0)
    return "<span{0}>{1}</span>".format(attr, m.group(1))


def _md_segment(seg: str) -> str:
    seg = seg.replace("\\*", "\x00").replace("\\`", "\x01").replace("\\[", "\x02")
    seg = _MD_CODE_RE.sub(r"<code>\1</code>", seg)
    seg = _MD_SPAN_RE.sub(_md_span_sub, seg)
    seg = _MD_LINK_RE.sub(r'<a href="\2" target="_blank">\1</a>', seg)
    seg = _MD_BOLD_RE.sub(r"<b>\1</b>", seg)
    seg = _MD_ITAL_RE.sub(r"<i>\1</i>", seg)
    return seg.replace("\x00", "*").replace("\x01", "`").replace("\x02", "[")


def _inline_md(text: str) -> str:
    r"""Inline formatting: **bold**, *italic*, `code`, [text](url), [text]{.role}.

    Math spans ($…$ / $$…$$) and HTML tags are left untouched; \* \` \[
    escape the markers. Disabled per deck with ``> markdown: false``.
    """
    if not _MARKDOWN or not text:
        return text
    if "*" not in text and "`" not in text and "[" not in text:
        return text
    parts = _MD_PROTECT_RE.split(text)
    for i in range(0, len(parts), 2):
        parts[i] = _md_segment(parts[i])
    return "".join(parts)


# --- inline source map (P7): source columns -> rendered text ------------------
#
# `inline_segments(line)` mirrors the `_inline_md` pipeline as a tokenizer
# and reports, per source-column range, what it renders to:
#   kind "text"        visible characters (escapes resolved)
#   kind "markup"      marker chars that render to tags (contribute no text)
#   kind "math-opaque" $...$ spans (atomic; KaTeX replaces them client-side)
#   kind "tag-opaque"  raw HTML tags (atomic)
# The map is SELF-VALIDATING: if concatenating the rendered pieces does not
# byte-match `_inline_md(line)`, the whole line is refused (None) — the
# selection bubble then simply hides. A wrong map is impossible by
# construction; only coverage can be lost.

_MD_ESCAPES = {"\\*": "\x00\x1a", "\\`": "\x00\x1b", "\\[": "\x00\x1c"}
_MD_UNESCAPE = {"\x00\x1a": "*", "\x00\x1b": "`", "\x00\x1c": "["}


def _seg_text(raw: str) -> str:
    for sent, ch in _MD_UNESCAPE.items():
        raw = raw.replace(sent, ch)
    return raw


def _md_tokenize(seg: str, base: int, out: list) -> None:
    """Tokenize a non-protected stretch; columns are absolute via *base*.

    *seg* has escape pairs replaced by 2-char sentinels (length-preserving),
    so marker regexes cannot match escaped characters.
    """
    pos = 0
    while pos < len(seg):
        matches = []
        for name, regex in (("code", _MD_CODE_RE), ("span", _MD_SPAN_RE),
                            ("link", _MD_LINK_RE), ("bold", _MD_BOLD_RE),
                            ("ital", _MD_ITAL_RE)):
            m = regex.search(seg, pos)
            if m:
                matches.append((m.start(), ("code", "span", "link", "bold",
                                            "ital").index(name), name, m))
        if not matches:
            out.append([base + pos, base + len(seg), _seg_text(seg[pos:]), "text"])
            return
        matches.sort()
        _st, _prec, name, m = matches[0]
        if m.start() > pos:
            out.append([base + pos, base + m.start(),
                        _seg_text(seg[pos:m.start()]), "text"])
        a, b = m.start(), m.end()
        if name == "code":
            out.append([base + a, base + a + 1, "<code>", "markup"])
            _md_tokenize(seg[a + 1:b - 1], base + a + 1, out)
            out.append([base + b - 1, base + b, "</code>", "markup"])
        elif name == "span":
            rendered = _md_span_sub(m)
            if rendered == m.group(0):
                # unrecognized role: stays literal, inner markers still apply
                out.append([base + a, base + a + 1, "[", "text"])
                _md_tokenize(m.group(1), base + a + 1, out)
                tail = a + 1 + len(m.group(1))
                out.append([base + tail, base + b,
                            _seg_text(seg[tail:b]), "text"])
            else:
                open_tag = rendered[:rendered.index(">") + 1]
                out.append([base + a, base + a + 1, open_tag, "markup"])
                _md_tokenize(m.group(1), base + a + 1, out)
                out.append([base + a + 1 + len(m.group(1)), base + b,
                            "</span>", "markup"])
        elif name == "link":
            open_tag = '<a href="{0}" target="_blank">'.format(m.group(2))
            out.append([base + a, base + a + 1, open_tag, "markup"])
            _md_tokenize(m.group(1), base + a + 1, out)
            out.append([base + a + 1 + len(m.group(1)), base + b, "</a>", "markup"])
        elif name == "bold":
            out.append([base + a, base + a + 2, "<b>", "markup"])
            _md_tokenize(m.group(1), base + a + 2, out)
            out.append([base + b - 2, base + b, "</b>", "markup"])
        else:  # ital
            out.append([base + a, base + a + 1, "<i>", "markup"])
            _md_tokenize(m.group(1), base + a + 1, out)
            out.append([base + b - 1, base + b, "</i>", "markup"])
        pos = b


def inline_segments(text: str):
    """The per-line source map for rendered inline text (or None if refused)."""
    if not text:
        return []
    if not _MARKDOWN or ("*" not in text and "`" not in text and "[" not in text
                         and "$" not in text and "<" not in text):
        return [[0, len(text), text, "text"]]
    segs: list = []
    last = 0
    for m in _MD_PROTECT_RE.finditer(text):
        if m.start() > last:
            stretch = text[last:m.start()]
            for esc, sent in _MD_ESCAPES.items():
                stretch = stretch.replace(esc, sent)
            _md_tokenize(stretch, last, segs)
        kind = "math-opaque" if m.group().startswith("$") else "tag-opaque"
        segs.append([m.start(), m.end(), m.group(), kind])
        last = m.end()
    if last < len(text):
        stretch = text[last:]
        for esc, sent in _MD_ESCAPES.items():
            stretch = stretch.replace(esc, sent)
        _md_tokenize(stretch, last, segs)
    if "".join(s2[2] for s2 in segs) != _inline_md(text):
        return None  # tokenizer/renderer disagreement: refuse, never lie
    return segs


_SIZE_ROLES = {"title": 1.6, "lede": 1.25, "body": 1.0, "sm": 0.8, "fine": 0.65}


def _parse_scale(value, default=1.0):
    """Parse a relative size: ``0.8``, ``80%``, or a role name (``lede``, ``sm``)."""
    text = str(value).strip()
    if text.lower() in _SIZE_ROLES:
        return _SIZE_ROLES[text.lower()]
    percent = text.endswith("%")
    try:
        number = float(text.rstrip("%").strip())
    except (TypeError, ValueError):
        return default
    return number / 100.0 if percent else number


def _parse_float(value, default):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


def _norm_align(value):
    align = str(value).strip().lower()
    if align in {"left", "center", "right", "justify"}:
        return align
    return None


def _split_into_blocks(lines, src=None):
    """Split content lines into blocks on ``||`` / ``|`` separators.

    Returns ``(preamble_lines, blocks)`` where each block is a dict with
    ``lines``, a parallel source map ``src``, the line number of the ``||`` /
    ``|`` separator that opened it (``sep``), and an optional ``width``. Code
    blocks (``@@``) and tables are kept atomic so separators inside them are
    ignored.
    """
    if src is None:
        src = _nosrc(lines)
    preamble = []
    preamble_src = []
    blocks = []
    current = None
    in_code = False
    in_table = False
    macro_depth = 0
    started = False

    def emit(line, ln):
        if current is not None:
            current["lines"].append(line)
            current["src"].append(ln)
        else:
            preamble.append(line)
            preamble_src.append(ln)

    for line, ln in zip(lines, src):
        stripped = line.strip()

        if stripped.startswith("@@"):
            in_code = not in_code
            emit(line, ln)
            continue
        if in_code:
            emit(line, ln)
            continue
        if _TABLE_OPEN_RE.match(stripped):
            in_table = True
            emit(line, ln)
            continue
        if in_table:
            emit(line, ln)
            if _TABLE_END_RE.match(stripped):
                in_table = False
            continue
        if _MACRO_OPEN_RE.match(stripped):
            macro_depth += 1
            emit(line, ln)
            continue
        if macro_depth > 0:
            if _BLOCK_END_RE.match(stripped):
                macro_depth -= 1
            emit(line, ln)
            continue

        if stripped.startswith("||"):
            width = stripped[2:].strip() or None
            if not started:
                started = True
                current = {"lines": [], "src": [], "sep": ln, "width": width}
            else:
                if current is not None:
                    blocks.append(current)
                current = None
            continue
        if started and stripped.startswith("|"):
            width = stripped[1:].strip() or None
            if current is not None:
                blocks.append(current)
            current = {"lines": [], "src": [], "sep": ln, "width": width}
            continue

        emit(line, ln)

    if current is not None:
        blocks.append(current)

    if not blocks:
        blocks = [{"lines": preamble, "src": preamble_src, "sep": None, "width": None}]
        preamble = []

    return preamble, blocks


def _split_into_paragraphs(lines, src=None):
    """Split block lines into paragraphs on blank lines.

    Returns a list of ``{"directives": [(key, value)...], "body": [lines...],
    "body_src": [linenos...]}``. Leading ``size`` / ``align`` /
    ``paragraph-spacing`` directives are attached to the paragraph; a
    paragraph with directives but no body sets block-scope defaults. Code
    blocks and tables are kept atomic.
    """
    if src is None:
        src = _nosrc(lines)
    groups = []
    current = []

    in_code = False
    in_table = False
    macro_depth = 0

    def flush():
        nonlocal current
        if any(item.strip() for item, _ln in current):
            groups.append(current)
        current = []

    for line, ln in zip(lines, src):
        stripped = line.strip()
        if stripped.startswith("@@"):
            in_code = not in_code
            current.append((line, ln))
            continue
        if in_code:
            current.append((line, ln))
            continue
        if _TABLE_OPEN_RE.match(stripped):
            in_table = True
            current.append((line, ln))
            continue
        if in_table:
            current.append((line, ln))
            if _TABLE_END_RE.match(stripped):
                in_table = False
            continue
        if _MACRO_OPEN_RE.match(stripped):
            macro_depth += 1
            current.append((line, ln))
            continue
        if macro_depth > 0:
            if _BLOCK_END_RE.match(stripped):
                macro_depth -= 1
            current.append((line, ln))
            continue
        if stripped == "":
            flush()
            continue
        current.append((line, ln))
    flush()

    paragraphs = []
    for group in groups:
        directives = []
        body = []
        body_src = []
        for line, ln in group:
            match = _SCOPED_DIRECTIVE_RE.match(line.strip())
            if match and not body:
                key = match.group(1).replace("_", "-")
                directives.append((key, match.group(2).strip()))
            else:
                body.append(line)
                body_src.append(ln)
        paragraphs.append({"directives": directives, "body": body, "body_src": body_src})
    return paragraphs


def _render_block(block, base_size, base_align, base_spacing):
    """Render one block (column) into a ``.column`` div of ``.rv-paragraph``."""
    paragraphs = _split_into_paragraphs(block["lines"], block.get("src"))

    block_size = base_size
    block_align = base_align
    block_spacing = base_spacing

    rendered = []
    for para in paragraphs:
        if not para["body"]:
            # Directive-only paragraph -> block-scope defaults.
            for key, value in para["directives"]:
                if key == "size":
                    block_size = base_size * _parse_scale(value)
                elif key == "align":
                    block_align = _norm_align(value) or block_align
                elif key == "paragraph-spacing":
                    block_spacing = _parse_float(value, block_spacing)
            continue

        para_size = block_size
        para_align = block_align
        for key, value in para["directives"]:
            if key == "size":
                para_size = block_size * _parse_scale(value)
            elif key == "align":
                para_align = _norm_align(value) or para_align

        body_html = _contentify_legacy("\n".join(para["body"]), src=para["body_src"])
        styles = []
        if abs(para_size - 1.0) > 1e-6:
            styles.append("font-size:{:.4f}em".format(para_size))
        if para_align:
            styles.append("text-align:{}".format(para_align))
        attr = ' style="{}"'.format(";".join(styles)) if styles else ""
        para_lns = [ln for ln in para["body_src"] if ln is not None]
        attr += _src_attr(para_lns[0] if para_lns else None,
                          para_lns[-1] if para_lns else None)
        rendered.append('<div class="rv-paragraph"{}>{}</div>'.format(attr, body_html))

    col_styles = ["--rv-para-spacing:{:.3f}".format(block_spacing)]
    if block.get("width"):
        col_styles.append("flex-basis:{}".format(_escape_attr(block["width"])))
    blk_lns = [ln for ln in block.get("src", []) if ln is not None]
    blk_attr = _src_attr(
        block.get("sep") if block.get("sep") is not None else (blk_lns[0] if blk_lns else None),
        blk_lns[-1] if blk_lns else None,
    )
    return '<div class="column" style="{}"{}>{}</div>'.format(
        ";".join(col_styles), blk_attr, "".join(rendered)
    )


def contentify(html, base_size=1.0, base_align=None, paragraph_spacing=0.5, fill=False, src=None):
    """Convert Revealer content into blocks and paragraphs.

    ``base_size`` / ``base_align`` / ``paragraph_spacing`` are the inherited
    presentation-scope defaults. The content is split into blocks (columns) and
    paragraphs; ``size`` and ``align`` directives resolve to slide, block or
    paragraph scope depending on their position. ``src`` is the parallel
    source map of ``html``'s lines (see the provenance section above).
    """
    all_lines = (html or "").split("\n")
    if src is None:
        src = _nosrc(all_lines)
    else:
        # `html` was accumulated line-by-line (each ending in "\n"), so the
        # split carries one trailing "" beyond the map.
        if len(all_lines) == len(src) + 1 and all_lines[-1] == "":
            all_lines = all_lines[:-1]
        assert len(all_lines) == len(src), (len(all_lines), len(src))
    lines, src = _trim_empty_edges(all_lines, src)
    if not any(line.strip() for line in lines):
        return ""

    if fill:
        # `> fill` slides use the flex layout DSL (rows / cols / stacks): render
        # the whole body with the line renderer, without block / paragraph
        # wrappers, so the flex chain resolves heights against the canvas.
        # Scoped directives are consumed here (they used to leak as literal
        # text): `size` applies to the whole slide body, the rest is inert.
        fill_size = None
        kept_lines, kept_src = [], []
        for line, ln in zip(lines, src):
            m = _SCOPED_DIRECTIVE_RE.match(line.strip())
            if m and _grammar.DIRECTIVES.get(m.group(1).replace("_", "-"),
                                             None) is not None:
                key = m.group(1).replace("_", "-")
                if key == "size":
                    fill_size = _parse_scale(m.group(2).strip(), None)
                # align is handled by the legacy renderer; keep it in-stream
                if key == "align":
                    kept_lines.append(line)
                    kept_src.append(ln)
                continue
            kept_lines.append(line)
            kept_src.append(ln)
        body = _contentify_legacy("\n".join(kept_lines), src=kept_src)
        if fill_size is not None and abs(fill_size - 1.0) > 1e-6:
            body = '<div class="rv-fillsize" style="font-size:{:.4f}em;display:contents">{}</div>'.format(
                fill_size, body)
        return body

    preamble, blocks = _split_into_blocks(lines, src)

    slide_size = base_size
    slide_align = base_align
    slide_spacing = paragraph_spacing
    for line in preamble:
        match = _SCOPED_DIRECTIVE_RE.match(line.strip())
        if not match:
            continue
        key, value = match.group(1).replace("_", "-"), match.group(2).strip()
        if key == "size":
            slide_size = base_size * _parse_scale(value)
        elif key == "align":
            slide_align = _norm_align(value) or slide_align
        elif key == "paragraph-spacing":
            slide_spacing = _parse_float(value, slide_spacing)

    columns = "".join(
        _render_block(block, slide_size, slide_align, slide_spacing) for block in blocks
    )
    return '<div class="multi-column">{}</div>'.format(columns)


def _contentify_legacy(html: str, src: list | None = None) -> str:
    """Render a paragraph body (lists, code, tables, highlight, raw HTML).

    This is the historical per-line renderer. It is now used to render the body
    of each paragraph produced by :func:`contentify`, which handles the block
    (column) and paragraph structure on top of it. ``src`` is the parallel
    source map of ``html``'s lines.
    """

    raw_lines = html.split("\n")
    if src is None:
        src = _nosrc(raw_lines)
    assert len(raw_lines) == len(src), (len(raw_lines), len(src))
    lines, src = _trim_ws_edges(raw_lines, src)
    html = ""
    codemode = False
    colmode = False
    alignmode = False

    # Stack to manage nested unordered lists: one entry per open <ul>
    ul_stack: list[int] = []
    li_open: list[bool] = []
    list_style_injected = False

    def _inject_list_styles():
        # Generate CSS rules for several nesting levels. Styles: changing
        # list marker and slightly decreasing font-size per level.
        markers = ["disc", "circle", "square", "decimal", "lower-alpha", "lower-roman"]
        rules = ["<style> .rv-list { margin: 0 0 0 1em; padding-left: 1em; }"]
        for lvl in range(1, 11):
            marker = markers[(lvl - 1) % len(markers)]
            size = max(0.7, 1.0 - 0.06 * (lvl - 1))
            rules.append(
                ".rv-list.lvl-{lvl} li {{ list-style-type: {marker}; font-size: {size}em; margin: 0.2em 0; }}".format(
                    lvl=lvl, marker=marker, size=("{:.2f}".format(size))
                )
            )
        rules.append("</style>")
        return "".join(rules)

    def _close_lists():
        nonlocal html
        while ul_stack:
            if li_open and li_open[-1]:
                html += "</li>"
                li_open[-1] = False
            html += "</ul>"
            ul_stack.pop()
            li_open.pop()

    def _close_align():
        nonlocal html, alignmode
        if alignmode:
            html += "</div>"
            alignmode = False

    def _open_align(value: str) -> bool:
        nonlocal html, alignmode
        align = value.strip().lower()
        if align in {"none", "default", "reset"}:
            _close_align()
            return True
        if align not in {"left", "center", "right", "justify"}:
            return False
        _close_align()
        html += '<div class="rv-align rv-align-{0}">'.format(align)
        alignmode = True
        return True

    def _escape_style_value(value: str) -> str:
        return value.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")

    def _parse_table(start_index: int):
        start = re.match(r"^>\s*table\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*$", lines[start_index])
        row_count, column_count = int(start.group(1)), int(start.group(2))
        margin = "0"
        border = False
        cells = []
        current_cell = None
        current_row = 1
        current_column = 0
        index = start_index + 1

        def start_cell(background: str | None, new_row: bool = False):
            nonlocal current_cell, current_row, current_column
            if new_row:
                current_row += 1
                current_column = 1
            else:
                current_column += 1
                if current_column > column_count:
                    current_row += 1
                    current_column = 1
            current_cell = {
                "row": current_row,
                "column": current_column,
                "background": background or "transparent",
                "content": [],
                "src": [],
                "head": src[index],
            }
            cells.append(current_cell)

        while index < len(lines):
            line = lines[index]
            if re.match(r"^>\s*end\s*:\s*table\s*$", line):
                index += 1
                break

            option = re.match(r"^>\s*(margin|border)\s*:\s*(.*?)\s*$", line)
            if option:
                key, value = option.group(1), option.group(2)
                if key == "margin":
                    margin = value or "0"
                else:
                    border = _is_truthy(value)
                index += 1
                continue

            cell = re.match(r"^>\s*cell(?:\s*:\s*(.*?))?\s*$", line)
            if cell:
                start_cell(cell.group(1))
                index += 1
                continue

            row = re.match(r"^>\s*row(?:\s*:\s*(.*?))?\s*$", line)
            if row:
                start_cell(row.group(1), new_row=True)
                index += 1
                continue

            if current_cell is None and not line.strip():
                index += 1
                continue
            if current_cell is None:
                start_cell(None)
            current_cell["content"].append(line)
            current_cell["src"].append(src[index])
            index += 1

        table_classes = "rv-table bordered" if border else "rv-table"
        out = (
            "<style>"
            ".rv-table-wrap{{box-sizing:border-box;width:100%;}}"
            ".rv-table{{display:grid;width:100%;box-sizing:border-box;}}"
            ".rv-table-cell{{display:flex;align-items:center;justify-content:center;text-align:center;"
            "box-sizing:border-box;padding:.25em;overflow:hidden;}}"
            ".rv-table-cell>div{{width:100%;}}"
            ".rv-table.bordered .rv-table-cell{{border:1px solid #444;}}"
            "</style>"
            '<div class="rv-table-wrap" style="padding:{margin};">'
            '<div class="{table_classes}" style="grid-template-columns:repeat({cols},minmax(0,1fr));'
            'grid-template-rows:repeat({rows},auto);">'
        ).format(
            margin=_escape_style_value(margin),
            table_classes=table_classes,
            cols=column_count,
            rows=row_count,
        )
        out = out.replace(
            '<div class="rv-table-wrap" style=',
            '<div class="rv-table-wrap"{0} style='.format(
                _src_attr(src[start_index], src[index - 1])),
            1,
        )
        for cell in cells:
            style = (
                "grid-row:{row};grid-column:{column};background:{background};"
            ).format(
                row=cell["row"],
                column=cell["column"],
                background=_escape_style_value(cell["background"]),
            )
            cell_lns = [ln for ln in cell["src"] if ln is not None]
            cell_attr = _src_attr(cell.get("head"), cell_lns[-1] if cell_lns else None)
            out += '<div class="rv-table-cell"{attr} style="{style}"><div>'.format(
                attr=cell_attr, style=style)
            out += _contentify_legacy("\n".join(cell["content"]), src=cell["src"]) if cell["content"] else ""
            out += "</div></div>"
        out += "</div></div>"
        return out, index

    def _parse_grid(start_index: int):
        """Parse a ``> grid(rows, cols)`` ... ``> end: grid`` block.

        Cards are introduced with ``> card`` (optionally ``> card +`` to make
        the card a reveal.js fragment, and ``> card: #bg`` for a background).
        Cards auto-flow left-to-right, top-to-bottom.
        """
        start = re.match(r"^>\s*grid\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*(compact)?\s*$", lines[start_index])
        row_count, column_count = int(start.group(1)), int(start.group(2))
        compact = bool(start.group(3))
        margin = "0"
        gap = "18px"
        cards = []
        current = None
        index = start_index + 1

        while index < len(lines):
            line = lines[index]
            if re.match(r"^>\s*end\s*:\s*grid\s*$", line):
                index += 1
                break

            opt = re.match(r"^>\s*(margin|gap)\s*:\s*(.*?)\s*$", line)
            if opt:
                if opt.group(1) == "margin":
                    margin = opt.group(2) or "0"
                else:
                    gap = opt.group(2) or "18px"
                index += 1
                continue

            card = re.match(r"^>\s*card\b(.*)$", line)
            if card:
                spec = card.group(1).strip()
                title = None
                if "|" in spec:
                    spec, title = spec.split("|", 1)
                    title = title.strip() or None
                bg = None
                if ":" in spec:
                    spec, bg = spec.split(":", 1)
                    bg = bg.strip() or None
                parts = spec.split()
                cf, ca, parts = _frag_attrs(parts)  # + / +N fragment flag
                plain = "plain" in parts
                extra = [p for p in parts if p != "plain"]  # any other tokens = extra classes
                current = {"frag": bool(cf), "fattr": ca, "plain": plain, "bg": bg, "classes": extra,
                           "title": title, "content": [], "src": [], "head": src[index]}
                cards.append(current)
                index += 1
                continue

            if current is None and not line.strip():
                index += 1
                continue
            if current is None:
                current = {"frag": False, "plain": False, "bg": None,
                           "content": [], "src": [], "head": src[index]}
                cards.append(current)
            current["content"].append(line)
            current["src"].append(src[index])
            index += 1

        wrap_cls = "rv-grid-wrap compact" if compact else "rv-grid-wrap"
        row_tmpl = "auto" if compact else "minmax(0,1fr)"
        out = (
            "<style>"
            ".rv-content-inner:has(> .rv-grid-wrap){{height:100%;}}"
            "</style>"
            '<div class="{wrap_cls}" style="padding:{margin};">'
            '<div class="rv-grid" style="grid-template-columns:repeat({cols},minmax(0,1fr));'
            'grid-template-rows:repeat({rows},{row_tmpl});gap:{gap};">'
        ).format(
            wrap_cls=wrap_cls,
            margin=_escape_style_value(margin),
            cols=column_count,
            rows=row_count,
            row_tmpl=row_tmpl,
            gap=_escape_style_value(gap),
        )
        out = out.replace(
            '<div class="{0}" style='.format(wrap_cls),
            '<div class="{0}"{1} style='.format(
                wrap_cls, _src_attr(src[start_index], src[index - 1])),
            1,
        )
        for c in cards:
            cls = "rv-cell" if c.get("plain") else "rv-card"
            if c.get("classes"):
                cls += " " + " ".join(c["classes"])
            if c["frag"]:
                cls += " fragment"
            style = "background:{0};".format(_escape_style_value(c["bg"])) if c["bg"] else ""
            card_lns = [ln for ln in c["src"] if ln is not None]
            out += '<div class="{cls}" style="{style}"{fa}{sa}>'.format(
                cls=cls, style=style, fa=c.get("fattr", ""),
                sa=_src_attr(c.get("head"), card_lns[-1] if card_lns else None))
            if c.get("title"):
                out += '<div class="card-title">{0}</div>'.format(_inline_md(c["title"]))
            out += _contentify_legacy("\n".join(c["content"]), src=c["src"]) if c["content"] else ""
            out += "</div>"
        out += "</div></div>"
        return out, index

    def _parse_pin(start_index: int):
        """Parse a ``> pin: x% y% [w%] [+]`` ... ``> end: pin`` overlay block.

        ``x``/``y`` place the overlay's centre (percent of the slide body);
        an optional third value sets its width; a trailing ``+`` makes the
        overlay a reveal.js fragment.
        """
        m = re.match(r"^>\s*pin\s*:\s*(.*?)\s*$", lines[start_index])
        spec = m.group(1)
        frag = "+" in spec
        spec = spec.replace("+", " ")
        nums = spec.split()
        x = nums[0] if len(nums) > 0 else "50%"
        y = nums[1] if len(nums) > 1 else "50%"
        w = nums[2] if len(nums) > 2 else None

        content = []
        content_src = []
        index = start_index + 1
        while index < len(lines):
            line = lines[index]
            if re.match(r"^>\s*end\s*:\s*pin\s*$", line):
                index += 1
                break
            content.append(line)
            content_src.append(src[index])
            index += 1

        style = "left:{x};top:{y};".format(x=_escape_style_value(x), y=_escape_style_value(y))
        if w:
            style += "width:{w};".format(w=_escape_style_value(w))
        cls = "rv-pin fragment" if frag else "rv-pin"
        out = '<div class="{cls}"{sa} style="{style}">'.format(
            cls=cls, sa=_src_attr(src[start_index], src[index - 1]), style=style)
        out += _contentify_legacy("\n".join(content), src=content_src) if content else ""
        out += "</div>"
        return out, index

    def _frag_attrs(tokens: list[str]):
        """Extract a `+` / `+N` fragment flag from *tokens*.

        Returns ``(class_suffix, attr, remaining_tokens)`` — `" fragment"` and an
        optional ``data-fragment-index`` when a flag is present.
        """
        cls, attr, rest = "", "", []
        for t in tokens:
            mm = re.match(r"^\+(\d+)?$", t)
            if mm:
                cls = " fragment"
                if mm.group(1):
                    attr = ' data-fragment-index="{0}"'.format(mm.group(1))
            else:
                rest.append(t)
        return cls, attr, rest

    def _col_flex(size: str) -> str:
        """Map a `> col` size spec (``2/5``, ``40%``, ``2``, ``300px``, ``""``) to a flex value."""
        if not size:
            return "1 1 0"
        m = re.match(r"^(\d+)\s*/\s*\d+$", size)
        if m:
            return "{0} 1 0".format(m.group(1))
        if re.match(r"^\d+(?:px|%|em|rem|vh|vw)$", size):
            return "0 0 {0}".format(size)
        if re.match(r"^\d+$", size):
            return "{0} 1 0".format(size)
        return "1 1 0"

    def _parse_row(start_index: int):
        """Parse ``> row [+[N]] [gap]`` … ``> col [size] [+[N]]`` … ``> end: row``.

        Emits a flex ``.row`` of ``.region`` columns. Nests (a col may contain a
        row). Sizes are fractions (``2/5``), percents, px, or bare flex integers.
        """
        head = re.match(r"^>\s*row\b(.*)$", lines[start_index]).group(1).split()
        fcls, fattr, head = _frag_attrs(head)
        # optional fixed height (`h=460` / `h=460px`): pins the row's height so its
        # content keeps the same size/position from one slide to the next
        height = None
        rest = []
        for t in head:
            m = re.match(r"^h=(\d+)(?:px)?$", t)
            if m:
                height = m.group(1) + "px"
            else:
                rest.append(t)
        gap = rest[0] if rest else "var(--gap-col)"

        cells: list[dict] = []
        current = None
        depth = 1
        index = start_index + 1

        def _ensure_cell():
            nonlocal current
            if current is None:
                current = {"flex": "1 1 0", "fcls": "", "fattr": "", "lines": [],
                           "src": [], "head": None}
                cells.append(current)

        while index < len(lines):
            line = lines[index]
            if re.match(r"^>\s*row\b", line):
                depth += 1
                _ensure_cell()
                current["lines"].append(line)
                current["src"].append(src[index])
                index += 1
                continue
            if re.match(r"^>\s*end\s*:\s*row\s*$", line):
                depth -= 1
                if depth == 0:
                    index += 1
                    break
                current["lines"].append(line)
                current["src"].append(src[index])
                index += 1
                continue
            col = re.match(r"^>\s*col\b(.*)$", line) if depth == 1 else None
            if col:
                toks = col.group(1).split()
                cf, ca, toks = _frag_attrs(toks)
                words = {t.lower() for t in toks}
                center = "center" in words
                extra = ""
                if "relative" in words:
                    extra += "position:relative;"
                if "clip" in words:
                    extra += "overflow:hidden;"
                toks = [t for t in toks if t.lower() not in ("center", "relative", "clip")]
                size = toks[0] if toks else ""
                current = {
                    "flex": _col_flex(size), "fcls": cf, "fattr": ca,
                    "justify": "center" if center else "flex-start", "extra": extra,
                    "lines": [], "src": [], "head": src[index],
                }
                cells.append(current)
                index += 1
                continue
            _ensure_cell()
            current["lines"].append(line)
            current["src"].append(src[index])
            index += 1

        inner = ""
        for c in cells:
            cell_lns = [ln for ln in c["src"] if ln is not None]
            if c.get("head") is not None:
                sa = _src_attr(c["head"], cell_lns[-1] if cell_lns else None)
            else:
                # Implicit first cell: no `> col` line exists to edit.
                sa = ' data-rv-implicit="1"' if _DEV else ""
            inner += '<div class="region{cf}" style="flex:{flex};gap:var(--gap-row);justify-content:{just};{extra}"{ca}{sa}>'.format(
                cf=c["fcls"], flex=c["flex"], just=c.get("justify", "flex-start"),
                extra=c.get("extra", ""), ca=c["fattr"], sa=sa
            )
            inner += _contentify_legacy("\n".join(c["lines"]), src=c["src"]) if c["lines"] else ""
            inner += "</div>"
        row_flex = "flex:0 0 {0};height:{0};".format(height) if height else "flex:1 1 auto;"
        out = (
            '<div class="row{fcls}" style="{row_flex}min-height:0;align-items:stretch;'
            'gap:{gap};"{fattr}{sa}>{inner}</div>'
        ).format(fcls=fcls, row_flex=row_flex, gap=_escape_style_value(gap), fattr=fattr,
                 sa=_src_attr(src[start_index], src[index - 1]), inner=inner)
        return out, index

    def _parse_box(start_index: int, kind: str):
        """Parse ``> info|warn|good [+[N]] [Title]`` … ``> end: info|warn|good`` → a callout box."""
        head = re.match(r"^>\s*(?:info|warn|good)\b(.*)$", lines[start_index]).group(1).split()
        fcls, fattr, head = _frag_attrs(head)
        title = " ".join(head).strip()
        box_cls = {"info": "box-info", "warn": "box-warn", "good": "box-good"}[kind]
        content = []
        content_src = []
        index = start_index + 1
        while index < len(lines):
            line = lines[index]
            if re.match(r"^>\s*end\s*:\s*" + kind + r"\s*$", line):
                index += 1
                break
            content.append(line)
            content_src.append(src[index])
            index += 1
        body = _contentify_legacy("\n".join(content), src=content_src) if content else ""
        title_html = '<div class="box-title">{0}</div>'.format(_inline_md(title)) if title else ""
        out = '<div class="{bc}{fcls}"{fattr}{sa}>{title}{body}</div>'.format(
            bc=box_cls, fcls=fcls, fattr=fattr,
            sa=_src_attr(src[start_index], src[index - 1]), title=title_html, body=body
        )
        return out, index

    def _parse_eq(start_index: int):
        """Parse ``> eq [+[N]]`` … ``> end: eq`` → a framed equation (``.math-box``)."""
        head = re.match(r"^>\s*eq\b(.*)$", lines[start_index]).group(1).split()
        fcls, fattr, _ = _frag_attrs(head)
        content = []
        index = start_index + 1
        while index < len(lines):
            line = lines[index]
            if re.match(r"^>\s*end\s*:\s*eq\s*$", line):
                index += 1
                break
            content.append(line)
            index += 1
        body = "\n".join(content).strip()
        if body and "$$" not in body and "$" not in body:
            body = "$$" + body + "$$"
        out = '<div class="math-box{fcls}"{fattr}{sa}>{body}</div>'.format(
            fcls=fcls, fattr=fattr, sa=_src_attr(src[start_index], src[index - 1]), body=body)
        return out, index

    def _parse_frag(start_index: int):
        """Parse ``> frag [N]`` … ``> end: frag`` → wrap content in a reveal fragment."""
        head = re.match(r"^>\s*frag\b(.*)$", lines[start_index]).group(1).strip()
        attr = ' data-fragment-index="{0}"'.format(head) if re.match(r"^\d+$", head) else ""
        content = []
        content_src = []
        depth = 1
        index = start_index + 1
        while index < len(lines):
            line = lines[index]
            if re.match(r"^>\s*frag\b", line):
                depth += 1
                content.append(line)
                content_src.append(src[index])
                index += 1
                continue
            if re.match(r"^>\s*end\s*:\s*frag\s*$", line):
                depth -= 1
                if depth == 0:
                    index += 1
                    break
                content.append(line)
                content_src.append(src[index])
                index += 1
                continue
            content.append(line)
            content_src.append(src[index])
            index += 1
        body = _contentify_legacy("\n".join(content), src=content_src) if content else ""
        out = '<div class="fragment"{attr}{sa}>{body}</div>'.format(
            attr=attr, sa=_src_attr(src[start_index], src[index - 1]), body=body)
        return out, index

    def _parse_stack(start_index: int):
        """Parse ``> stack [h=NNN]`` … ``> layer [+[N]] [clear]`` … ``> end: stack``.

        Renders a set of overlaid layers (all in one grid cell) that cross-fade
        as fragments — replaces raw ``display:grid; grid-area:1/1`` image stacks.
        A fragment layer is opaque (white) by default so revealing it hides the
        one beneath; ``clear`` keeps it transparent (a see-through overlay such as
        a binning grid). The base (non-fragment) layer is always transparent.
        """
        head = re.match(r"^>\s*stack\b(.*)$", lines[start_index]).group(1).split()
        height = None
        for t in head:
            m = re.match(r"^h=(\d+)(?:px)?$", t)
            if m:
                height = m.group(1) + "px"
        layers = []
        current = None
        index = start_index + 1
        while index < len(lines):
            line = lines[index]
            if re.match(r"^>\s*end\s*:\s*stack\s*$", line):
                index += 1
                break
            lm = re.match(r"^>\s*layer\b(.*)$", line)
            if lm:
                toks = lm.group(1).split()
                cf, ca, toks = _frag_attrs(toks)
                clear = "clear" in {t.lower() for t in toks}
                current = {"fcls": cf, "fattr": ca, "clear": clear, "lines": [],
                           "src": [], "head": src[index]}
                layers.append(current)
                index += 1
                continue
            if current is None:
                if not line.strip():
                    index += 1
                    continue
                current = {"fcls": "", "fattr": "", "clear": False, "lines": [],
                           "src": [], "head": src[index]}
                layers.append(current)
            current["lines"].append(line)
            current["src"].append(src[index])
            index += 1
        inner = ""
        for ly in layers:
            # opaque backdrop only on revealed (fragment) layers that aren't `clear`
            opaque = " rv-opaque" if (ly["fcls"] and not ly["clear"]) else ""
            ly_lns = [ln for ln in ly["src"] if ln is not None]
            inner += '<div class="rv-layer{fc}{op}"{fa}{sa}>'.format(
                fc=ly["fcls"], op=opaque, fa=ly["fattr"],
                sa=_src_attr(ly.get("head"), ly_lns[-1] if ly_lns else None))
            inner += _contentify_legacy("\n".join(ly["lines"]), src=ly["src"]) if ly["lines"] else ""
            inner += "</div>"
        style = "flex:0 0 {0};height:{0};".format(height) if height else "flex:1 1 0;"
        out = '<div class="rv-stack"{sa} style="{st}">{inner}</div>'.format(
            sa=_src_attr(src[start_index], src[index - 1]), st=style, inner=inner)
        return out, index

    _PARSERS = {
        "table": _parse_table, "grid": _parse_grid, "pin": _parse_pin,
        "row": _parse_row, "eq": _parse_eq, "stack": _parse_stack,
        "frag": _parse_frag,
    }

    index = 0
    while index < len(lines):
        line = lines[index]

        # --- Code snippets

        if line.startswith("@@"):
            if codemode:
                html += "</code></pre>"
                codemode = False
            else:
                _close_lists()
                html += '<pre><code class="codeblock"{:s}>'.format(
                    " " + line[2:].strip() if len(line) > 2 else ""
                )
                codemode = True
            index += 1
            continue

        if codemode:
            html += line

        else:

            # --- Text alignment

            align = re.match(r"^>\s*align\s*:\s*(.*?)\s*$", line)
            if align:
                _close_lists()
                if not _open_align(align.group(1)):
                    html += line + "\n"
                index += 1
                continue

            # --- Vertical spacer: `> space` (filling) / `> space: <size>` (fixed)

            sp = re.match(r"^>\s*space\s*(?::\s*(.*?)\s*)?$", line)
            if sp:
                _close_lists()
                val = (sp.group(1) or "").strip()
                if val:
                    style = "flex:0 0 {0};height:{0};".format(
                        _escape_style_value(val))
                else:
                    style = "flex:1 1 0;min-height:0;"
                html += '<div class="rv-space"{sa} style="{st}"></div>\n'.format(
                    sa=_src_attr(src[index]), st=style)
                index += 1
                continue

            # --- Block constructs: registry-driven dispatch (REGISTRY order)

            dispatched = False
            for _name, _pat in _DISPATCH:
                m = _pat.match(line)
                if not m:
                    continue
                _close_lists()
                if _name == "box":
                    out_html, index = _parse_box(index, m.group(1))
                else:
                    out_html, index = _PARSERS[_name](index)
                html += out_html
                dispatched = True
                break
            if dispatched:
                continue

            if re.match(r"^>\s*end\s*:\s*\w+\s*$", line):
                _close_lists()
                index += 1
                continue

            # --- Bullet lists

            # --- Bullet lists (supports arbitrary nesting via leading spaces)

            m = re.match(r"^(\s*)\*\s(.*)", line)
            if m:
                indent, text = m.group(1), m.group(2)
                # Define level: 0 spaces -> level 1; 2 spaces -> level 2; etc.
                level = max(1, (len(indent) // 2) + 1)

                # Inject styles once when first encountering lists
                if not list_style_injected:
                    html += _inject_list_styles()
                    list_style_injected = True

                # Current open level
                cur = len(ul_stack)

                text = _inline_md(text)
                if level > cur:
                    # Open new nested uls
                    for L in range(cur + 1, level + 1):
                        html += '<ul class="rv-list lvl-{0}">'.format(L)
                        ul_stack.append(L)
                        li_open.append(False)
                    # Open li for this item
                    html += "<li>" + text
                    li_open[-1] = True
                elif level == cur and cur > 0:
                    # Close previous li at this level then open new li
                    if li_open[-1]:
                        html += "</li>"
                        li_open[-1] = False
                    html += "<li>" + text
                    li_open[-1] = True
                else:  # level < cur
                    # Close deeper levels
                    while len(ul_stack) > level:
                        if li_open and li_open[-1]:
                            html += "</li>"
                            li_open[-1] = False
                        html += "</ul>"
                        ul_stack.pop()
                        li_open.pop()
                    # Now at desired level: close previous li and open new one
                    if li_open and li_open[-1]:
                        html += "</li>"
                        li_open[-1] = False
                    if li_open:
                        html += "<li>" + text
                        li_open[-1] = True
                    else:
                        # No ul open at all (level == 0), open a top-level ul
                        html += '<ul class="rv-list lvl-1">'
                        ul_stack.append(1)
                        li_open.append(True)
                        html += "<li>" + text
                index += 1
                continue

            # --- Multiple columns

            if line.startswith("||"):
                _close_lists()
                if colmode:
                    _close_align()
                    html += "</div></div>"
                else:
                    width = "" if len(line) == 2 else ' style="flex-basis:{:s};"'.format(line[2:].strip())
                    html += (
                        '<div class="multi-column"><div class="column"'
                        + width
                        + ">"
                    )
                colmode = not colmode
                index += 1
                continue
            elif colmode and line.startswith("|"):
                _close_lists()
                _close_align()
                width = "" if len(line) == 1 else ' style="flex-basis:{:s};"'.format(line[1:].strip())
                html += '</div><div class="column"' + width + ">"
                index += 1
                continue

            _close_lists()

            # --- Media: !! video / ! image  (leading whitespace tolerated)

            lstripped = line.lstrip()
            if lstripped.startswith("!! "):
                html += _media_shortcut("video", lstripped[3:].strip(), lineno=src[index])
                index += 1
                continue
            if lstripped.startswith("! "):
                html += _media_shortcut("img", lstripped[2:].strip(), lineno=src[index])
                index += 1
                continue

            # --- Highlighted block

            if line.startswith("[ ") and line.endswith(" ]"):
                html += '<div class="highlight">' + line[2:-2] + "</div>"
                index += 1
                continue

            # --- Default: add line (with inline markdown)

            html += _inline_md(line)

        if not line.startswith("<pre>"):
            html += "\n"
        index += 1

    # --- Close any block left open at the end of the slide

    if codemode:
        html += "</code></pre>"
    # Close any open list items and uls
    _close_lists()
    _close_align()
    if colmode:
        html += "</div></div>"

    return html


def _parse_animate(spec: str, default_duration: str):
    """Parse an ``> animate:`` value.

    Syntax: ``#sel[,#sel2] attr:val; attr2:val2 [@ duration]``.
    Returns ``(targets, attrs_string, duration)``.
    """

    duration = default_duration
    if "@" in spec:
        spec, dur = spec.rsplit("@", 1)
        duration = dur.strip()

    spec = spec.strip()
    # First token = selector(s), remainder = attribute declarations
    parts = spec.split(None, 1)
    targets = parts[0]
    attrs = parts[1].strip() if len(parts) > 1 else ""
    return targets, attrs, duration


_VIDEO_MIME = {
    "mp4": "video/mp4",
    "webm": "video/webm",
    "ogg": "video/ogg",
    "ogv": "video/ogg",
    "mov": "video/quicktime",
}


def _media_shortcut(kind: str, rest: str, lineno: int | None = None) -> str:
    """Render an ``!`` image or ``!!`` video shortcut.

    Syntax: ``! path [flags] [| caption]`` and ``!! path [flags] [| caption]``.

    Flags: ``fill`` (fill a sized parent — e.g. a grid card), ``cover`` / ``contain``
    (object-fit), ``top`` (object-position), and for video ``loop`` / ``autoplay`` /
    ``controls``. A trailing ``| caption`` adds a caption (styled as a figure caption,
    or as a card label when inside a card).
    """
    sa = _src_attr(lineno)
    caption = None
    if "|" in rest:
        rest, caption = rest.split("|", 1)
        caption = caption.strip()
    tokens = rest.split()
    if not tokens:
        return ""
    path = tokens[0]
    # `h=`/`w=` set a fixed height/width (e.g. a logo strip: `! logo.png h=80px`);
    # `+` / `+N` reveal the media as a (optionally indexed) fragment.
    size_css = ""
    frag_cls = ""
    frag_attr = ""
    flag_tokens = []
    for t in tokens[1:]:
        mm = re.match(r"^([hw])=([0-9.]+(?:px|em|rem|vh|vw|%)?)$", t, re.IGNORECASE)
        if mm:
            if mm.group(1).lower() == "h":
                size_css += "height:{0};width:auto;".format(mm.group(2))
            else:
                size_css += "width:{0};height:auto;".format(mm.group(2))
            continue
        fm = re.match(r"^\+(\d+)?$", t)
        if fm:
            frag_cls = " fragment"
            if fm.group(1):
                frag_attr = ' data-fragment-index="{0}"'.format(fm.group(1))
            continue
        flag_tokens.append(t)
    flags = {t.lower() for t in flag_tokens}
    if "frag" in flags:
        frag_cls = " fragment"

    fill = "fill" in flags
    if "contain" in flags:
        objfit = "contain"
    elif "cover" in flags:
        objfit = "cover"
    else:
        objfit = "cover" if fill else "contain"
    pos = "top" if "top" in flags else "center"

    p = _escape_attr(_figure_src(path) if kind == "img" else path)
    cap_html = '<div class="rv-cap">{0}</div>'.format(_inline_md(caption)) if caption else ""
    fig_cls = "rv-fig" + frag_cls

    if kind == "img":
        if fill:
            style = "object-fit:{0};object-position:{1};{2}".format(objfit, pos, size_css)
            return '<img class="rv-media-fill{0}"{1}{5} style="{2}" src="{3}" alt="">{4}'.format(
                frag_cls, frag_attr, style, p, cap_html, sa
            )
        img = '<img class="rv-media" style="object-fit:{0};{1}" src="{2}" alt="">'.format(objfit, size_css, p)
        return '<figure class="{0}"{1}{4}>{2}{3}</figure>'.format(fig_cls, frag_attr, img, cap_html, sa)

    # video
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else "mp4"
    mime = _VIDEO_MIME.get(ext, "video/mp4")
    attrs = ["muted", "playsinline", 'preload="auto"']
    if "loop" in flags:
        attrs.append("loop")
    if "autoplay" in flags:
        attrs.append("autoplay")
    if "controls" in flags:
        attrs.append("controls")
    attrs_s = " ".join(attrs)
    if fill:
        style = "object-fit:{0};object-position:{1};{2}".format(objfit, pos, size_css)
        vid = '<video class="rv-media-fill{0}"{1}{6} style="{2}" {3}><source src="{4}" type="{5}"></video>'.format(
            frag_cls, frag_attr, style, attrs_s, p, mime, sa
        )
        return vid + cap_html
    vid = '<video class="rv-media" style="object-fit:{0};{1}" {2}><source src="{3}" type="{4}"></video>'.format(
        objfit, size_css, attrs_s, p, mime
    )
    return '<figure class="{0}"{1}{4}>{2}{3}</figure>'.format(fig_cls, frag_attr, vid, cap_html, sa)


def _slide_append(S: dict, line: str, lineno: int | None) -> None:
    """Append a content line to a slide, keeping the source map in lockstep."""
    if not line.endswith("\n"):
        line += "\n"  # EOF-without-newline normalization; output-neutral
    S["html"] += line
    S["srcmap"].append(lineno)


_INCLUDE_RE = re.compile(r"^>\s*include\s*:\s*(\S+)\s*$")

# P8 multi-file provenance: line origins are encoded as
# ``file_idx * _FILE_STRIDE + own_line`` so the whole srcmap machinery keeps
# doing plain integer arithmetic. File 0 is the main .pres (encoding is the
# identity there); included files register in the build's file table and
# their elements emit ``data-rv-src="<own_line>" data-rv-f="<idx>"``.
_FILE_STRIDE = 10_000_000


def _expand_includes(text: str, pdir: str, _stack: tuple = (),
                     _root: str | None = None, _depth: int = 0,
                     _files: list | None = None, _idx: int = 0):
    """Expand ``> include: file.pres`` lines (build-only, recursive).

    Returns ``(entries, includes)`` where each entry is
    ``(origin, include_file, line)``. Origins are stride-encoded
    ``file_idx * _FILE_STRIDE + own_line`` (file 0 = the main .pres, so the
    encoding is the identity there); ``_src_attr`` decodes them into
    ``data-rv-src`` plus ``data-rv-f`` for included files. ``include_file``
    is the display path of the file a line came from (``None`` for the main
    file). The per-file invariant: a ``data-rv-src`` annotation, with its
    file's recorded sha matching, is always a valid source range.
    ``_files`` accumulates the file table (path/sha/lines) used for the
    ``rv-src-files`` meta. ``includes`` lists the absolute paths read, for
    the dev server's watcher and history. Includes must live inside the
    deck folder; circular includes are skipped with a comment.
    """
    root = _root or os.path.realpath(pdir)
    files = _files if _files is not None else [None]  # slot 0 = main file
    entries: list[tuple[int | None, str | None, str]] = []
    includes: list[str] = []

    def enc(n: int) -> int:
        return _idx * _FILE_STRIDE + n

    here = None if _idx == 0 else (files[_idx] or {}).get("path")
    for lineno, line in enumerate(text.splitlines(keepends=True), 1):
        m = _INCLUDE_RE.match(line)
        if not m:
            entries.append((enc(lineno), here, line))
            continue
        fname = m.group(1)
        fpath = os.path.realpath(os.path.join(pdir, fname))
        if not fpath.startswith(root + os.sep):
            print("Warning: `> include:` outside the deck folder ignored: {0}".format(fname))
            entries.append((enc(lineno), here, "\n"))
            continue
        if fpath in _stack:
            print("Warning: circular `> include:` skipped: {0}".format(fname))
            entries.append((enc(lineno), here, "\n"))
            continue
        try:
            sub = Path(fpath).read_text(encoding="utf-8")
        except OSError:
            print("Warning: `> include:` file not found: {0}".format(fname))
            entries.append((enc(lineno), here, "\n"))
            continue
        includes.append(fpath)
        if not sub.endswith("\n"):
            sub += "\n"
        sub_bytes = sub.encode("utf-8")
        try:
            rel = str(Path(fpath).relative_to(root))
        except ValueError:
            rel = fname
        existing = next((i for i, fe in enumerate(files)
                         if fe and fe["path"] == rel), None)
        if existing is None:
            files.append({"path": rel,
                          "sha": hashlib.sha256(sub_bytes).hexdigest(),
                          "lines": sub.count("\n")})
            sub_idx = len(files) - 1
        else:
            sub_idx = existing
        sub_entries, sub_includes = _expand_includes(
            sub, os.path.dirname(fpath), _stack + (fpath,), root, _depth + 1,
            files, sub_idx)
        entries.extend(sub_entries)
        includes.extend(sub_includes)
    return entries, includes


def collect_includes(pfile: str) -> list[str]:
    """Absolute paths of every file `> include:`d by *pfile* (recursive)."""
    try:
        text = Path(pfile).read_text(encoding="utf-8")
    except OSError:
        return []
    _entries, includes = _expand_includes(
        text, os.path.dirname(os.path.abspath(pfile)),
        _stack=(os.path.realpath(pfile),))
    return includes


def _inc_attr(param: dict) -> str:
    """Dev-only marker on sections that came from an include."""
    if not _DEV or not param.get("_inc"):
        return ""
    return ' data-rv-inc="{0}"'.format(_escape_attr(str(param["_inc"])))


def _read_pres(pfile: str) -> tuple[str, str]:
    """Read a ``.pres`` file once; return ``(text, sha256-hex of its bytes)``.

    The hash is computed on the exact bytes the parser consumes, so a source
    map derived from this text is valid exactly as long as the hash matches.
    """
    data = Path(pfile).read_bytes()
    return data.decode("utf-8"), hashlib.sha256(data).hexdigest()


def build(pfile: str, dev: bool = False) -> str:
    """Build the HTML presentation associated with ``pfile``.

    Returns the path of the generated ``.html`` file. With ``dev=True`` the
    output is written to ``<stem>.dev.html`` instead (same folder, so relative
    ``reveal.js/`` and media paths keep working), emitted elements carry
    ``data-rv-src`` source-line annotations, and the ``<head>`` carries
    ``rv-src-file`` / ``rv-src-sha`` meta tags identifying the source the
    build was made from; the exported ``<stem>.html`` is never touched.
    """
    global _DEV
    prev = _DEV
    _DEV = dev
    try:
        return _build(pfile, dev)
    finally:
        _DEV = prev


def _build(pfile: str, dev: bool) -> str:
    pfile = os.path.abspath(pfile)
    pdir = os.path.dirname(pfile) + "/"
    rdir = os.path.join(pdir, "reveal.js") + "/"

    # --- Ensure reveal.js is present -----------------------------------------

    if not os.path.isdir(rdir):
        raise FileNotFoundError(
            "No 'reveal.js' folder found next to {0}.\n"
            "Set it up with:  revealer update \"{1}\"".format(pfile, pdir)
        )

    # Read the presentation's extension set (defaults if no config)
    extensions = assets.read_presentation_extensions(pdir)

    # Refresh the Revealer assets (themes, javascript) and the index template
    assets.inject_revealer_assets(rdir)
    assets.generate_index_html(rdir, extensions)

    # === Parsing =============================================================

    setting = {}
    slide = []
    author_blocks = []
    current_author_block = None
    notes = False
    table_mode = False
    block_depth = 0

    pres_text, pres_sha = _read_pres(pfile)
    global _MARKDOWN, _PDIR
    _MARKDOWN = True
    _PDIR = pdir
    _run_build_hooks(pdir, pres_text)

    _files: list = [{"path": os.path.basename(pfile), "sha": pres_sha,
                     "lines": pres_text.count("\n")
                              + (0 if pres_text.endswith("\n") else 1)}]
    _expanded, _includes = _expand_includes(
        pres_text, pdir, _stack=(os.path.realpath(pfile),), _files=_files)
    if True:  # (indentation-stable replacement of the StringIO loop)
        for lineno, _inc_file, line in _expanded:

            if line.startswith("#"):
                continue

            s = ">>> first: "
            if line.startswith(s):
                slide.append({"type": "first", "title": line[len(s):].strip(), "html": "", "notes": "", "param": ({"_inc": _inc_file} if _inc_file else {}), "src": lineno, "srcmap": []})
                notes = False
                table_mode = False
                block_depth = 0
                continue

            s = r"%%% "
            if line.startswith(s):
                slide.append({"type": "section", "title": line[len(s):].strip(), "html": "", "notes": "", "param": ({"_inc": _inc_file} if _inc_file else {}), "src": lineno, "srcmap": []})
                notes = False
                table_mode = False
                block_depth = 0
                continue

            s = "=== "
            if line.startswith(s):
                slide.append({"type": "slide", "title": line[len(s):].strip(), "html": "", "notes": "", "param": ({"_inc": _inc_file} if _inc_file else {}), "src": lineno, "srcmap": []})
                notes = False
                table_mode = False
                block_depth = 0
                continue

            s = "--- "
            if line.startswith(s):
                match slide[-1]["type"]:
                    case "lastchild":
                        slide[-1]["type"] = "child"
                    case _:
                        slide[-1]["type"] = "parent"
                slide.append({"type": "lastchild", "title": line[len(s):].strip(), "html": "", "notes": "", "param": ({"_inc": _inc_file} if _inc_file else {}), "src": lineno, "srcmap": []})
                notes = False
                table_mode = False
                block_depth = 0
                continue

            s = ">>> biblio"
            if line.startswith(s):
                slide.append({"type": "biblio", "title": "Bibliography", "html": "", "notes": "", "param": ({"_inc": _inc_file} if _inc_file else {}), "src": lineno, "srcmap": []})
                notes = False
                table_mode = False
                block_depth = 0
                continue

            # --- Settings

            if line.startswith(">") or (not len(slide) and re.match(r"^\s+>", line)):

                table_start = re.match(r"^>\s*table\(\s*\d+\s*,\s*\d+\s*\)\s*$", line)
                table_end = re.match(r"^>\s*end\s*:\s*table\s*$", line)
                if len(slide) and not notes and (table_mode or table_start):
                    _slide_append(slide[-1], line, lineno)
                    if table_start:
                        table_mode = True
                    if table_end:
                        table_mode = False
                    continue

                # Layout-DSL block macros (grid / pin / row / info / warn /
                # good / eq / frag / stack) are passed through to the slide
                # HTML so contentify() renders them inline, instead of being
                # captured as slide parameters. A depth counter supports
                # nesting; tables are tracked separately above (a `> row`
                # inside a table is a table row, not a layout row).
                block_open = _MACRO_OPEN_RE.match(line)
                if len(slide) and not notes and (block_depth > 0 or block_open):
                    _slide_append(slide[-1], line, lineno)
                    if block_open:
                        block_depth += 1
                    elif _BLOCK_END_RE.match(line.strip()) and block_depth > 0:
                        block_depth -= 1
                    continue

                if len(slide) and not notes and re.match(r"^>\s*end\s*:\s*\w+\s*$", line):
                    _slide_append(slide[-1], line, lineno)
                    continue

                # `> space` / `> space: <size>`: a vertical spacer kept in the
                # content stream so contentify() renders it (never a param).
                if len(slide) and not notes and re.match(
                        r"^\s*>\s*space\s*(?::.*)?$", line):
                    _slide_append(slide[-1], line, lineno)
                    continue

                if line.startswith("> notes:"):
                    notes = True

                # `> fill [between|center|around|end]`: make this slide's
                # content fill the canvas (a flex column) so layout rows /
                # regions resolve their heights; the optional keyword sets the
                # vertical distribution.
                fillm = re.match(r"^>\s*fill(?:\s+(between|center|around|end))?\s*$", line)
                if len(slide) and fillm:
                    slide[-1]["param"]["fill"] = fillm.group(1) or True
                    continue

                x = re.match(r"^(\s*)>\s*([^:]*):\s*(.*)", line)
                if x:
                    indent, key, value = x.group(1), x.group(2), x.group(3)

                    # `size` / `align` / `paragraph-spacing` inside a slide are
                    # kept in the content stream so their scope can be resolved
                    # from their position (slide / block / paragraph).
                    if len(slide) and not notes and key.strip() in {"align", "size", "paragraph-spacing"}:
                        _slide_append(slide[-1], line, lineno)
                        continue

                    if not len(slide) and key in {"author", "photo"}:
                        if indent:
                            if current_author_block is None:
                                current_author_block = {}
                                author_blocks.append(current_author_block)
                            current_author_block[key] = value
                            if key == "author":
                                _append_setting(setting, key, value)
                            continue
                        if key == "photo":
                            current_author_block = {"photo": value}
                            author_blocks.append(current_author_block)
                            continue

                    if len(slide):
                        target = slide[-1]["param"]
                    else:
                        target = setting

                    _append_setting(target, key, value)

                    if not len(slide) and key == "author":
                        current_author_block = {"author": value}
                        author_blocks.append(current_author_block)

                    # If this is an inline svg directive inside a slide,
                    # insert a placeholder into the slide HTML so that the
                    # SVG can be emitted exactly where the directive appears
                    # in the source .pres file.
                    if key == "svg" and len(slide):
                        placeholder = "__REVEALER_SVG__"
                        _slide_append(slide[-1], placeholder + "\n", None)
                        target["_svg_placeholder"] = placeholder
                        target["_svg_line"] = lineno

            # --- Slide content

            if len(slide) and not line.startswith(">"):
                if notes:
                    slide[-1]["notes"] += line
                else:
                    _slide_append(slide[-1], line, lineno)

    # Slide source spans: a slide ends on the line before the next marker.
    total_lines = pres_text.count("\n") + (0 if pres_text.endswith("\n") else 1)
    for i, S in enumerate(slide):
        if S.get("src") is None:
            S["src_end"] = None
            continue
        f = S["src"] // _FILE_STRIDE
        nxt = [T["src"] for T in slide[i + 1:]
               if T.get("src") is not None
               and T["src"] // _FILE_STRIDE == f and T["src"] > S["src"]]
        if nxt:
            S["src_end"] = min(nxt) - 1
        elif f == 0:
            S["src_end"] = total_lines
        else:
            S["src_end"] = f * _FILE_STRIDE + _files[f]["lines"]

    # === Bibliography ========================================================

    biblio = Bibtex(setting["bibtex"], pdir) if "bibtex" in setting else None

    # === Default settings ====================================================

    setting.setdefault("title", "Revealer")
    setting.setdefault("theme", "revealer")
    setting.setdefault("codeTheme", "zenburn")
    setting.setdefault("notesSize", "1em")
    setting.setdefault("svgDuration", "0.5s")
    if str(setting.get("markdown", "true")).strip().lower() in ("false", "no", "0", "off"):
        _MARKDOWN = False
    setting["maxRefsPerPage"] = int(setting.get("maxRefsPerPage", 5))

    # Presentation-scope content defaults (size / align / paragraph spacing).
    pres_size = _parse_scale(setting["size"]) if "size" in setting else 1.0
    pres_align = _norm_align(setting["align"]) if "align" in setting else None
    pres_spacing = _parse_float(setting.get("paragraph-spacing", 0.5), 0.5)

    # === Output ==============================================================

    with open(os.path.join(rdir, "index.html"), "r", encoding="utf-8") as tfile:
        out = tfile.read()

    # --- Path fixing

    out = re.sub(r'(<link\b[^>]*\bhref=")(?!https?://|/|reveal\.js/)', r'\1reveal.js/', out)
    out = re.sub(r'(<script\b[^>]*\bsrc=")(?!https?://|/|reveal\.js/)', r'\1reveal.js/', out)

    # --- Settings substitution

    rList = [
        ("<title>reveal.js</title>", "<title>" + setting["title"] + "</title>"),
        ("__CODE_THEME__", setting["codeTheme"]),
        ("__THEME__", setting["theme"]),
    ]
    if "slideNumber" in setting:
        rList.append(("slideNumber: false,", "slideNumber: '{:s}',".format(setting["slideNumber"])))
    for old, new in rList:
        out = out.replace(old, new)

    # --- Per-presentation reveal.js options ---------------------------------
    # Collect settings that should be forwarded to Reveal.initialize().
    def _to_js_literal(val, key=None):
        if isinstance(val, bool):
            return "true" if val else "false"
        s = str(val).strip()
        try:
            # numeric?
            if isinstance(val, (int, float)):
                return str(val)
            ls = s.lower()
            if key and key.lower().endswith("transition") and ls == "false":
                return "'none'"
            if ls in ("true", "false", "null"):
                return ls
            # integer
            if re.fullmatch(r"-?\d+", s):
                return s
            # float
            if re.fullmatch(r"-?\d+\.\d+", s):
                return s
        except Exception:
            pass
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"

    skip_keys = {
        "title",
        "theme",
        "codeTheme",
        "notesSize",
        "svgDuration",
        "maxRefsPerPage",
        "bibtex",
        "logo",
        "author",
        "affiliation",
        "event",
        "slideNumber",
        "markdown",
        "build",
        "photo",
        "rounded_photos",
        "size",
        "align",
        "paragraph-spacing",
        "header-height",
        "footer-height",
        "header-margin",
        "column-spacing",
        "column-width",
        "katex",
        "macros",
        "macro",
        "pdfSeparateFragments",
    }

    # Backwards-compatibility aliases for common option names in .pres files
    alias_map = {
        "progressbar": "progress",
    }

    opts = []
    for k, v in setting.items():
        if k in skip_keys:
            continue
        mapped_key = alias_map.get(k.lower(), k)
        if isinstance(v, list):
            js_items = ", ".join(_to_js_literal(x, mapped_key) for x in v)
            jsval = f"[{js_items}]"
        else:
            jsval = _to_js_literal(v, mapped_key)
        opts.append(f"{mapped_key}: {jsval}")

    # KaTeX config is assembled from parts and merged — a user-supplied
    # `> katex:` used to clobber the local-bundle option entirely.
    katex_parts = []
    if (assets.DATA / "katex" / "dist" / "katex.min.js").is_file():
        # locally-bundled KaTeX (copied into reveal.js/katex by
        # assets.inject_revealer_assets): equations render offline instead
        # of depending on the jsdelivr CDN at runtime
        katex_parts.append("local: 'reveal.js/katex'")
    macros: dict[str, str] = {}
    for fname in _as_list(setting.get("macros")):
        fp = Path(pdir) / str(fname).strip()
        if fp.is_file():
            macros.update(_parse_tex_macros(fp.read_text(encoding="utf-8")))
        else:
            print("Warning: `> macros:` file not found: {0}".format(fname))
    for v in _as_list(setting.get("macro")):
        parsed = _parse_inline_macro(str(v))
        if parsed:
            macros[parsed[0]] = parsed[1]
        else:
            print("Warning: `> macro:` needs `\\name definition`, got: {0}".format(v))
    def _js_str(x):
        return _json.dumps(x).replace("</", "<\\/")

    if macros:
        pairs = ", ".join(
            "{0}: {1}".format(_js_str(k), _js_str(v))
            for k, v in macros.items())
        katex_parts.append("macros: { " + pairs + " }")
    user_katex = setting.get("katex")
    if isinstance(user_katex, str) and user_katex.strip():
        raw = user_katex.strip().replace("</", "<\\/")
        if raw.startswith("{") and raw.endswith("}"):
            raw = raw[1:-1].strip()
        if raw:
            katex_parts.append(raw)
    if katex_parts:
        opts.append("katex: { " + ", ".join(katex_parts) + " }")

    extra = "" if not opts else "\n        " + ",\n        ".join(opts) + ",\n        "
    out = out.replace("__REVEAL_OPTIONS__", extra)

    # --- Revealer javascript

    out = out.replace(
        "</body>",
        '<script src="reveal.js/js/jquery.min.js"></script>\n'
        '<script src="reveal.js/js/revealer.js"></script>\n</body>',
    )

    # --- Build content -------------------------------------------------------

    headers = "<header></header><footer></footer>"
    content = ""

    for k, S in enumerate(slide):

        if S["type"] != "biblio":

            if S["type"] == "parent":
                stack_end = S.get("src_end")
                for T in slide[k + 1:]:
                    if T["type"] in ("child", "lastchild"):
                        stack_end = T.get("src_end", stack_end)
                    else:
                        break
                content += '<section data-transition="none"{0}{1}>'.format(
                    _src_attr(S.get("src"), stack_end), _inc_attr(S["param"]))

            opt = 'data-transition="none" data-state="slide_{:d}"'.format(k) + \
                _src_attr(S.get("src"), S.get("src_end")) + _inc_attr(S["param"])

            if S["param"].get("visibility") == "hidden":
                opt += ' data-visibility="hidden"'

            section_classes = []
            if S["param"].get("style") == "dark":
                section_classes.append("dark")
            fillv = S["param"].get("fill")
            if fillv:
                section_classes.append("rv-fill")
                if isinstance(fillv, str):
                    section_classes.append("rv-fill-" + fillv)
            if section_classes:
                opt += ' class="{0}"'.format(" ".join(section_classes))

            if "theme" in S["param"]:
                opt += ' data-rv-theme="{:s}"'.format(_escape_attr(S["param"]["theme"]))

            if S["param"].get("header") == "none":
                opt += ' data-rv-header="none"'

            if "background" in S["param"]:
                if S["param"]["background"].find(".") == -1:
                    opt += ' data-background-color="{:s}"'.format(S["param"]["background"])
                else:
                    opt += ' data-background-image="{:s}"'.format(S["param"]["background"])

            if "background-video" in S["param"]:
                opacity = S["param"].get("background-opacity", "1")
                opt += (
                    " data-background-video='{0}' data-background-video-loop "
                    "data-background-video-muted data-background-opacity={1} "
                    "data-background-transition='none'".format(
                        S["param"]["background-video"], opacity
                    )
                )

            if "attr" in S["param"] and not isinstance(S["param"]["attr"], list):
                opt += " " + S["param"]["attr"]

            # Geometry parameters (slide scope, falling back to presentation).
            def _geom(key, default):
                return S["param"].get(key, setting.get(key, default))

            opt += ' data-rv-header-margin="{}"'.format(_geom("header-margin", "0.05"))
            opt += ' data-rv-column-spacing="{}"'.format(_geom("column-spacing", "0.05"))
            opt += ' data-rv-column-width="{}"'.format(_geom("column-width", "equal"))
            for hk in ("header-height", "footer-height"):
                hv = _geom(hk, None)
                if hv is not None:
                    opt += ' data-rv-{}="{}"'.format(hk, _escape_attr(str(hv)))

            content += "<section {:s}>".format(opt)

            if "color" in S["param"]:
                content += (
                    "<style>.slide_{0} section, .slide_{0} h1, .slide_{0} h2, "
                    ".slide_{0} h3, .slide_{0} p {{ color: {1}; }}</style>".format(
                        k, S["param"]["color"]
                    )
                )

        # --- Slide specialization

        body = ""

        match S["type"]:

            case "first":
                S["param"]["header"] = "none"

                if "logo" in setting:
                    logos = setting["logo"] if isinstance(setting["logo"], list) else [setting["logo"]]
                    headers += '<div id="hlogos">'
                    for logo in logos:
                        headers += '<img src="{:s}">'.format(logo)
                    headers += "</div>"
                    content += '<style>.slide_{:d} #hlogos {{ display: flex; }}</style>'.format(k)

                body += "<h1>" + S["title"] + "</h1>"
                if "subtitle" in S["param"]:
                    body += "<h2>" + S["param"]["subtitle"] + "</h2>"
                body += "<br>"

                if "author" in setting:
                    authors = setting["author"] if isinstance(setting["author"], list) else [setting["author"]]
                    rounded_photos = _is_truthy(setting.get("rounded_photos", "false"))
                    photo_mode = any(block.get("photo") for block in author_blocks)
                    if photo_mode:
                        by_name = {block.get("author"): block for block in author_blocks if block.get("author")}
                        grid_class = "rv-author-grid rv-author-photos-rounded" if rounded_photos else "rv-author-grid"
                        body += '<div class="{:s}">'.format(grid_class)
                        for author in authors:
                            block = by_name.get(author, {"author": author})
                            body += '<div class="rv-author-card">'
                            if block.get("photo"):
                                body += '<img class="rv-author-photo" src="{:s}" alt="{:s}">'.format(
                                    _escape_attr(block["photo"]), _escape_attr(_strip_tags(author))
                                )
                            else:
                                body += '<div class="rv-author-photo rv-author-photo-missing">{:s}</div>'.format(
                                    _initials(author)
                                )
                            body += '<div class="rv-author-name">{:s}</div></div>'.format(author)
                        body += "</div>"
                    else:
                        body += '<div id="author">' + ", ".join(authors) + "</div>"

                if "affiliation" in setting:
                    affils = setting["affiliation"] if isinstance(setting["affiliation"], list) else [setting["affiliation"]]
                    body += '<div id="affiliation">' + "<br>".join(affils) + "</div>"

                if "event" in setting:
                    body += '<div id="event">' + setting["event"] + "</div>"

            case "section":
                S["param"]["header"] = "none"
                if S["param"].get("relief") == "none":
                    body += "<h1>" + S["title"] + "</h1>"
                else:
                    body += '<h1 class="relief">' + S["title"] + "</h1>"

            case "biblio":
                if biblio is not None:
                    npages = ((len(biblio.item_num) - 1) // setting["maxRefsPerPage"]) + 1
                    sindex = 0
                    content += '<section data-transition="none">'
                    for i in range(npages):
                        content += '<section data-transition="none" data-state="slide_{:d}"{:s}>'.format(
                            k + i, _src_attr(S.get("src")))
                        title = S["param"].get("title", S["title"])
                        if npages == 1:
                            content += '<div class="slide_header">{:s}</div>'.format(title)
                        else:
                            content += '<div class="slide_header">{:s} - {:d}/{:d}</div>'.format(title, i + 1, npages)
                        content += '<div class="rv-content"><div class="rv-content-inner">'
                        content += '<div class="multi-column"><div class="column" style="--rv-para-spacing:0.5"><div class="rv-paragraph">'
                        for j in range(sindex, min(sindex + setting["maxRefsPerPage"], len(biblio.item_num))):
                            content += '<div class="biblio-long">' + biblio.long_description(biblio.item_num[j]["ID"]) + "</div>"
                        content += "</div></div></div>"
                        content += "</div></div>"
                        sindex += setting["maxRefsPerPage"]
                        content += "</section>"
                    content += "</section>"
                continue

            case _:
                content += '<div class="slide_header">{:s}</div>'.format(S["title"])

        if S["param"].get("header") == "none":
            content += "<style>.slide_{:d} header {{ display: none; }}</style>".format(k)

        # --- Inline SVG ------------------------------------------------------

        svg_html = _build_svg(S, pdir, setting["svgDuration"])

        # --- Content ---------------------------------------------------------

        # If a placeholder was inserted when parsing `> svg:`, respect its
        # position in the slide HTML. Otherwise keep legacy behaviour and
        # prefix the SVG before the slide content.
        fill_mode = bool(S["param"].get("fill"))
        placeholder = S["param"].get("_svg_placeholder") if "param" in S else None
        if placeholder and placeholder in S["html"]:
            body += contentify(
                S["html"], base_size=pres_size, base_align=pres_align,
                paragraph_spacing=pres_spacing, fill=fill_mode, src=S["srcmap"]
            ).replace(placeholder, svg_html)
        else:
            body += svg_html + contentify(
                S["html"], base_size=pres_size, base_align=pres_align,
                paragraph_spacing=pres_spacing, fill=fill_mode, src=S["srcmap"]
            )

        # --- Speaker notes (kept as a direct child of <section>) -------------

        notes_html = ""
        if len(S["notes"]):
            nS = S["param"].get("notes", setting["notesSize"])
            notes_html = (
                '<aside class="notes"><style>.speaker-controls-notes {font-size: '
                + nS
                + ";} .speaker-controls-notes ul {margin: 0px; padding-left: 10px;}</style>"
            )
            notes_html += _contentify_legacy(S["notes"]) + "</aside>"

        # --- Bibliography citations

        if "cite" in S["param"] and biblio is not None and biblio.error is None:

            cites = S["param"]["cite"] if isinstance(S["param"]["cite"], list) else [S["param"]["cite"]]

            sd = ""
            for tag in cites:
                biblio.add_entry(tag)
                sd += '<div class="biblio-short">' + biblio.short_description(tag) + "</div>"

            for m in reversed(list(re.finditer("<ref:([^>]*)>", body))):
                try:
                    rhtml = "<sup>" + ",".join(
                        str(biblio.item_tag[tag.strip()]["revealer-number"])
                        for tag in m.group(1).split(",")
                    ) + "</sup>"
                    s = m.span()
                    body = body[0:s[0]] + rhtml + body[s[1]:]
                except KeyError:
                    pass

            content += '<div class="slide_footer">{:s}</div>'.format(sd)
            content += "<style>.slide_{:d} footer {{ display: block; }}</style>".format(k)

        # The visible body is wrapped so the runtime can center it inside the
        # area left by the header/footer and rescale it to always fit. Slides
        # whose body is built directly (first, section, ...) are wrapped in a
        # single block so the block layout / per-block font scaling applies.
        if not fill_mode and 'class="multi-column"' not in body:
            body = (
                '<div class="multi-column"><div class="column" '
                'style="--rv-para-spacing:0.5"><div class="rv-paragraph">'
                + body
                + "</div></div></div>"
            )
        content += '<div class="rv-content"><div class="rv-content-inner">' + body + "</div></div>"
        content += notes_html + "\n</section>"

        if S["type"] == "lastchild":
            content += "</section>"

    # --- Inject into html ----------------------------------------------------

    out = out.replace("<body>", "<body>" + headers)

    s = '<div class="slides">\n'
    i = out.find(s) + len(s)
    out = out[0:i] + content + out[i:]

    # --- Export

    stem = os.path.splitext(os.path.basename(pfile))[0]
    if dev:
        # Dev builds are separate artifacts (same folder, so relative paths
        # keep working); the <head> identifies the exact source they were
        # built from, for the dev server's optimistic-concurrency checks.
        meta = (
            '<meta name="rv-src-file" content="{0}">\n'
            '<meta name="rv-src-sha" content="{1}">\n'
            '<meta name="rv-src-files" content="{2}">\n'.format(
                _escape_attr(os.path.basename(pfile)), pres_sha,
                _escape_attr(_json.dumps(
                    [{"path": fe["path"], "sha256": fe["sha"]}
                     for fe in _files])),
            )
        )
        out = out.replace("</head>", meta + "</head>", 1)
        ofile = os.path.join(pdir, stem + ".dev.html")
    else:
        ofile = os.path.join(pdir, stem + ".html")
    with open(ofile, "w", encoding="utf-8") as fid:
        fid.write(out)

    return ofile


_SVG_ATTR_RE = re.compile(r"([\w:.-]+)\s*=\s*(\"[^\"]*\"|'[^']*')")


def _svg_iter_tags(svg: str):
    """Yield (start, end, tag_text) for each opening tag, quote-aware.

    Text surgery by contract (an etree round-trip would rewrite the whole
    file); comments, closing tags and declarations are skipped, and a `>`
    inside a quoted attribute value never terminates the scan.
    """
    i, n = 0, len(svg)
    while True:
        i = svg.find("<", i)
        if i == -1:
            return
        if svg.startswith("<!--", i):
            j = svg.find("-->", i)
            i = j + 3 if j != -1 else n
            continue
        if svg.startswith("</", i) or svg.startswith("<!", i) or svg.startswith("<?", i):
            j = svg.find(">", i)
            i = j + 1 if j != -1 else n
            continue
        j, quote = i + 1, None
        while j < n:
            c = svg[j]
            if quote:
                if c == quote:
                    quote = None
            elif c in "\"'":
                quote = c
            elif c == ">":
                break
            j += 1
        if j >= n:
            return
        yield i, j + 1, svg[i:j + 1]
        i = j + 1


def _svg_tag_attrs(tag: str) -> dict[str, str]:
    return {m.group(1): m.group(2)[1:-1] for m in _SVG_ATTR_RE.finditer(tag)}


def _svg_replace_attr(tag: str, name: str, new_value: str) -> str:
    for m in _SVG_ATTR_RE.finditer(tag):
        if m.group(1) == name:
            q = m.group(2)[0]
            return tag[:m.start(2)] + q + new_value + q + tag[m.end(2):]
    return tag


def _svg_opacity_zero(tag: str, attrs: dict[str, str]) -> str:
    """Force the element invisible, winning against whatever it declares.

    A style attribute outranks a presentation attribute, so opacity is
    rewritten inside style when one exists; otherwise the opacity
    attribute is replaced or appended.
    """
    if "style" in attrs:
        style = attrs["style"]
        if re.search(r"(?:^|;)\s*opacity\s*:", style):
            new_style = re.sub(r"((?:^|;)\s*opacity\s*:\s*)[^;]*",
                               lambda m: m.group(1) + "0", style)
        else:
            new_style = (style.rstrip("; ") + ";" if style.strip() else "") + "opacity:0"
        return _svg_replace_attr(tag, "style", new_style)
    if "opacity" in attrs:
        return _svg_replace_attr(tag, "opacity", "0")
    if tag.endswith("/>"):
        return tag[:-2].rstrip() + ' opacity="0"/>'
    return tag[:-1] + ' opacity="0">'


def _svg_hide_ids(svg: str, ids) -> str:
    """Hide the first element carrying each id (exact `id=` — never data-id)."""
    remaining = set(ids)
    out, last = [], 0
    for start, end, tag in _svg_iter_tags(svg):
        if not remaining:
            break
        el_id = _svg_tag_attrs(tag).get("id")
        if el_id not in remaining:
            continue
        remaining.discard(el_id)
        out.append(svg[last:start])
        out.append(_svg_opacity_zero(tag, _svg_tag_attrs(tag)))
        last = end
    out.append(svg[last:])
    return "".join(out)


def _build_svg(S, pdir, default_duration):
    """Inline an SVG file and emit the animation fragments for a slide."""

    if "svg" not in S["param"]:
        return ""

    svg_path = os.path.join(pdir, _figure_src(S["param"]["svg"]))
    try:
        svg = Path(svg_path).read_text(encoding="utf-8")
    except OSError:
        return '<div class="svg-error">SVG not found: {:s}</div>'.format(S["param"]["svg"])

    # Strip XML/doctype declarations so the SVG embeds cleanly
    svg = re.sub(r"<\?xml.*?\?>", "", svg, flags=re.DOTALL)
    svg = re.sub(r"<!DOCTYPE.*?>", "", svg, flags=re.DOTALL)

    hide = S["param"].get("hide")
    if hide:
        ids = set()
        for spec in (hide if isinstance(hide, list) else [hide]):
            for sel in str(spec).split(","):
                sel = sel.strip().lstrip("#")
                if re.match(r"^[\w.-]+$", sel):
                    ids.add(sel)
        if ids:
            svg = _svg_hide_ids(svg, ids)

    out = '<div class="revealer-svg"{0}>'.format(
        _src_attr(S["param"].get("_svg_line"))) + svg.strip() + "</div>"

    # Animation steps -> invisible reveal.js fragments
    if "animate" in S["param"]:
        steps = S["param"]["animate"]
        if not isinstance(steps, list):
            steps = [steps]
        for step in steps:
            targets, attrs, duration = _parse_animate(step, default_duration)
            out += (
                '<span class="fragment revealer-svg-anim" '
                'data-svg-target="{0}" data-svg-attrs="{1}" '
                'data-svg-duration="{2}"></span>'.format(
                    _escape_attr(targets), _escape_attr(attrs), _escape_attr(duration)
                )
            )

    return out


def _escape_attr(value: str) -> str:
    return value.replace("&", "&amp;").replace('"', "&quot;")


def main(argv=None):
    """Command-line entry point used by the legacy ``revealer.py`` shim."""

    import sys

    argv = argv if argv is not None else sys.argv[1:]
    if not argv:
        print("Usage: revealer build <presentation.pres>", file=sys.stderr)
        return 1
    build(argv[0])
    return 0
