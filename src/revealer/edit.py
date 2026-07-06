"""Semantic edit operations on ``.pres`` files.

The browser editor sends *semantic* operations (``set_pin``, ``set_col_size``,
``move_block``, ...) referencing ``.pres`` line numbers taken from the
``data-rv-src`` annotations of a dev build. This module compiles them into
line-level text primitives and applies them surgically — the rest of the file
is never touched, so a GUI editing session diffs like hand edits.

Safety model:
- The whole-file SHA-256 is a precondition (``EditError`` 409 on mismatch).
  Line numbers in a dev build derive from exactly the bytes that were hashed,
  so a SHA match guarantees every ``data-rv-src`` is still valid.
- Every operation additionally validates that its target line matches the
  construct's own syntax (``EditError`` 422) — a provenance bug surfaces as a
  rejected edit, never as silent corruption.
- Batches are all-or-nothing; overlapping edits are rejected; writes are
  atomic (temp file + ``os.replace``) and preserve the file's EOL flavor and
  trailing-newline state.
"""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

# --- construct grammar (kept in sync with the parsers in build.py) -----------

RE_COL_LINE = re.compile(r"^(?P<head>\s*>\s*col\b)(?P<flags>.*)$")
RE_ROW_LINE = re.compile(r"^(?P<head>\s*>\s*row\b)(?P<flags>.*)$")
RE_STACK_LINE = re.compile(r"^(?P<head>\s*>\s*stack\b)(?P<flags>.*)$")
RE_PIN_LINE = re.compile(r"^(?P<head>\s*>\s*pin\s*:)(?P<flags>.*)$")
RE_MEDIA_LINE = re.compile(r"^(?P<head>\s*!{1,2}\s+)(?P<rest>.*)$")
RE_SEP_LINE = re.compile(r"^(?P<head>\s*\|{1,2})(?P<width>[^|]*)$")
RE_FRAG_HEAD = re.compile(r"^(?P<head>\s*>\s*frag\b)(?P<flags>.*)$")
RE_GAP_OPT = re.compile(r"^\s*>\s*gap\s*:")
RE_GRID_OPEN = re.compile(r"^\s*>\s*grid\(\s*\d+\s*,\s*\d+\s*\)")
RE_CARD_LINE = re.compile(r"^(?P<head>\s*>\s*card\b)(?P<flags>[^:]*)(?P<bg>:.*)?$")
RE_LAYER_LINE = re.compile(r"^(?P<head>\s*>\s*layer\b)(?P<flags>.*)$")
RE_BOX_LINE = re.compile(r"^(?P<head>\s*>\s*(?:info|warn|good)\b)(?P<flags>.*)$")
RE_EQ_LINE = re.compile(r"^(?P<head>\s*>\s*eq\b)(?P<flags>.*)$")
RE_END = re.compile(r"^\s*>\s*end\s*:\s*\w+\s*$")

RE_SIZE_TOKEN = re.compile(r"^(?:\d+\s*/\s*\d+|\d+(?:\.\d+)?(?:px|%|em|rem|vh|vw)|\d+)$")
RE_H_TOKEN = re.compile(r"^h=\d+(?:px)?$", re.IGNORECASE)
RE_MEDIA_SIZE_TOKEN = re.compile(r"^([hw])=([0-9.]+(?:px|em|rem|vh|vw|%)?)$", re.IGNORECASE)
RE_FRAG_TOKEN = re.compile(r"^\+(\d+)?$")

# Opener regex per movable/deletable construct.
CONSTRUCT_OPEN = {
    "row": RE_ROW_LINE,
    "stack": RE_STACK_LINE,
    "pin": RE_PIN_LINE,
    "grid": RE_GRID_OPEN,
    "table": re.compile(r"^\s*>\s*table\(\s*\d+\s*,\s*\d+\s*\)"),
    "box": re.compile(r"^\s*>\s*(?:info|warn|good)\b"),
    "eq": RE_EQ_LINE,
    "frag": RE_FRAG_HEAD,
    "media": RE_MEDIA_LINE,
    "paragraph": None,  # any non-empty span
}
# Constructs whose span ends on a `> end:` line.
SPAN_CONSTRUCTS = {"row", "stack", "pin", "grid", "table", "box", "eq", "frag"}
# Container kinds that use the paragraph model (need blank-line padding).
PARAGRAPH_CONTAINERS = {"column", "slide"}


class EditError(Exception):
    """A rejected edit: ``status`` is the HTTP-ish code, ``payload`` the JSON."""

    def __init__(self, status: int, payload: dict):
        super().__init__(payload.get("error", "edit error"))
        self.status = status
        self.payload = payload


# --- primitives ---------------------------------------------------------------


@dataclass
class Replace:
    line: int  # 1-based, original coordinates
    new: str


@dataclass
class Insert:
    before: int  # insert before this original line; len(lines)+1 = append
    text: list[str]
    pad: bool = False  # blank-line padding (paragraph containers)


@dataclass
class Delete:
    start: int
    end: int
    seam: bool = True  # collapse a blank-blank join left at the cut


def _err(status: int, error: str, **kw) -> EditError:
    return EditError(status, {"error": error, **kw})


def _line(lines: list[str], n: int) -> str:
    if not (1 <= n <= len(lines)):
        raise _err(422, "line_out_of_range", line=n)
    return lines[n - 1]


def _split_caption(rest: str) -> tuple[str, str]:
    """Split a media line's flag region from its ``| caption`` part."""
    if "|" in rest:
        flags, caption = rest.split("|", 1)
        return flags, "|" + caption
    return rest, ""


# --- parametric ops -----------------------------------------------------------


def _rewrite_tokens(flags: str, match, replace_with, insert_if_missing=None):
    """Rewrite the first token matching *match* in a whitespace-token region.

    ``replace_with`` of ``None`` removes the token. Returns the new region or
    ``None`` when nothing matched and nothing was inserted.
    """
    tokens = flags.split()
    for i, t in enumerate(tokens):
        if match(t):
            if replace_with is None:
                tokens.pop(i)
            else:
                tokens[i] = replace_with
            break
    else:
        if insert_if_missing is None:
            return None
        tokens.append(insert_if_missing)
    return (" " + " ".join(tokens)) if tokens else ""


def _op_set_col_size(lines, op):
    line = _line(lines, op["line"])
    m = RE_COL_LINE.match(line)
    if not m:
        raise _err(422, "anchor_mismatch", line=op["line"], want="col", got=line.strip())
    flags = m.group("flags")
    new = op.get("new")

    def is_size(t):
        return RE_SIZE_TOKEN.match(t) and not RE_FRAG_TOKEN.match(t) \
            and t.lower() not in ("center", "relative", "clip")

    if op.get("old") is not None:
        current = next((t for t in flags.split() if is_size(t)), None)
        if current != op["old"]:
            raise _err(422, "token_mismatch", line=op["line"],
                       want=op["old"], got=current)
    if new is not None and not RE_SIZE_TOKEN.match(str(new)):
        raise _err(422, "bad_value", value=new)
    # The size token conventionally comes first after `> col`.
    tokens = [t for t in flags.split()]
    for i, t in enumerate(tokens):
        if is_size(t):
            if new is None:
                tokens.pop(i)
            else:
                tokens[i] = str(new)
            break
    else:
        if new is not None:
            tokens.insert(0, str(new))
    region = (" " + " ".join(tokens)) if tokens else ""
    return [Replace(op["line"], m.group("head") + region)]


def _op_set_block_width(lines, op):
    line = _line(lines, op["line"])
    m = RE_SEP_LINE.match(line)
    if not m:
        raise _err(422, "anchor_mismatch", line=op["line"], want="||", got=line.strip())
    new = op.get("new")
    sep = m.group("head")
    return [Replace(op["line"], sep + (" " + str(new) if new else ""))]


def _height_op(regex, want):
    def apply(lines, op):
        line = _line(lines, op["line"])
        m = regex.match(line)
        if not m:
            raise _err(422, "anchor_mismatch", line=op["line"], want=want, got=line.strip())
        value = op.get("value")
        token = "h={0}".format(int(value)) if value is not None else None
        region = _rewrite_tokens(
            m.group("flags"), lambda t: RE_H_TOKEN.match(t),
            token, insert_if_missing=token)
        if region is None:  # removal requested but no token present
            region = m.group("flags")
        return [Replace(op["line"], m.group("head") + region)]
    return apply


_op_set_row_height = _height_op(RE_ROW_LINE, "row")
_op_set_stack_height = _height_op(RE_STACK_LINE, "stack")


def _op_set_pin(lines, op):
    line = _line(lines, op["line"])
    m = RE_PIN_LINE.match(line)
    if not m:
        raise _err(422, "anchor_mismatch", line=op["line"], want="pin", got=line.strip())
    had_frag = "+" in m.group("flags")
    parts = [str(op["x"]), str(op["y"])]
    if op.get("w"):
        parts.append(str(op["w"]))
    for p in parts:
        if not re.match(r"^\d+(?:\.\d+)?%$", p):
            raise _err(422, "bad_value", value=p)
    if had_frag:
        parts.append("+")
    return [Replace(op["line"], m.group("head") + " " + " ".join(parts))]


def _op_set_media_size(lines, op):
    line = _line(lines, op["line"])
    m = RE_MEDIA_LINE.match(line)
    if not m:
        raise _err(422, "anchor_mismatch", line=op["line"], want="media", got=line.strip())
    dim = op.get("dim", "h").lower()
    if dim not in ("h", "w"):
        raise _err(422, "bad_value", value=dim)
    value = op.get("value")
    if value is not None and not re.match(r"^[0-9.]+(?:px|em|rem|vh|vw|%)?$", str(value)):
        raise _err(422, "bad_value", value=value)
    flags, caption = _split_caption(m.group("rest"))
    token = "{0}={1}".format(dim, value) if value is not None else None
    region = _rewrite_tokens(
        flags.rstrip(),
        lambda t: (mm := RE_MEDIA_SIZE_TOKEN.match(t)) and mm.group(1).lower() == dim,
        token, insert_if_missing=token)
    if region is None:
        region = " " + flags.strip() if flags.strip() else ""
    new_line = m.group("head").rstrip() + region.rstrip() + \
        ((" " + caption) if caption else "")
    # `head` keeps its trailing space convention via the region's leading space.
    return [Replace(op["line"], new_line)]


def _op_set_row_gap(lines, op):
    line = _line(lines, op["line"])
    m = RE_ROW_LINE.match(line)
    if not m:
        raise _err(422, "anchor_mismatch", line=op["line"], want="row", got=line.strip())
    value = op.get("value")

    def is_gap(t):
        return not RE_H_TOKEN.match(t) and not RE_FRAG_TOKEN.match(t)

    region = _rewrite_tokens(m.group("flags"), is_gap,
                             str(value) if value else None,
                             insert_if_missing=str(value) if value else None)
    if region is None:
        region = m.group("flags")
    return [Replace(op["line"], m.group("head") + region)]


def _op_set_grid_gap(lines, op):
    start, end = int(op["line"]), int(op.get("end", op["line"]))
    opener = _line(lines, start)
    if not RE_GRID_OPEN.match(opener):
        raise _err(422, "anchor_mismatch", line=start, want="grid", got=opener.strip())
    value = str(op["value"])
    for n in range(start + 1, min(end, len(lines)) + 1):
        if RE_GAP_OPT.match(lines[n - 1]):
            return [Replace(n, "> gap: {0}".format(value))]
    return [Insert(start + 1, ["> gap: {0}".format(value)])]


_FRAG_LINE_RES = {
    "media": RE_MEDIA_LINE, "col": RE_COL_LINE, "row": RE_ROW_LINE,
    "card": RE_CARD_LINE, "layer": RE_LAYER_LINE, "box": RE_BOX_LINE,
    "eq": RE_EQ_LINE, "pin": RE_PIN_LINE, "frag": RE_FRAG_HEAD,
}


def _op_set_fragment_index(lines, op):
    construct = op.get("construct", "media")
    regex = _FRAG_LINE_RES.get(construct)
    if regex is None:
        raise _err(422, "unsupported_target", detail="construct " + str(construct))
    line = _line(lines, op["line"])
    m = regex.match(line)
    if not m:
        raise _err(422, "anchor_mismatch", line=op["line"], want=construct, got=line.strip())
    index = op.get("index")

    if construct == "frag":
        head = m.group("head")
        rest = m.group("flags").strip()
        rest = re.sub(r"^\d+\s*", "", rest)
        new = head + ((" " + str(int(index))) if index is not None else "") + \
            ((" " + rest) if rest else "")
        return [Replace(op["line"], new)]

    token = "+" if index is None else "+{0}".format(int(index))
    if construct == "media":
        flags, caption = _split_caption(m.group("rest"))
        region = _rewrite_tokens(flags.rstrip(), lambda t: RE_FRAG_TOKEN.match(t),
                                 token, insert_if_missing=token) or ""
        new_line = m.group("head").rstrip() + region.rstrip() + \
            ((" " + caption) if caption else "")
        return [Replace(op["line"], new_line)]
    if construct == "card":
        flags = m.group("flags")
        bg = m.group("bg") or ""
        region = _rewrite_tokens(flags.rstrip(), lambda t: RE_FRAG_TOKEN.match(t),
                                 token, insert_if_missing=token)
        return [Replace(op["line"], m.group("head") + (region or "") + bg)]
    flags = m.group("flags")
    region = _rewrite_tokens(flags, lambda t: RE_FRAG_TOKEN.match(t),
                             token, insert_if_missing=token)
    return [Replace(op["line"], m.group("head") + (region or ""))]


# --- structural ops -----------------------------------------------------------


def _validate_span(lines, span, construct):
    s, e = int(span[0]), int(span[1])
    if not (1 <= s <= e <= len(lines)):
        raise _err(422, "line_out_of_range", line=s if s < 1 else e)
    regex = CONSTRUCT_OPEN.get(construct)
    if construct not in CONSTRUCT_OPEN:
        raise _err(422, "unsupported_target", detail="construct " + str(construct))
    if regex is not None and not regex.match(lines[s - 1]):
        raise _err(422, "anchor_mismatch", line=s, want=construct,
                   got=lines[s - 1].strip())
    if construct in SPAN_CONSTRUCTS and s != e and not RE_END.match(lines[e - 1]):
        raise _err(422, "anchor_mismatch", line=e, want="end:" + construct,
                   got=lines[e - 1].strip())
    return s, e


def _dest_insert_line(lines, dest):
    before = int(dest["insert_before"])
    if not (1 <= before <= len(lines) + 1):
        raise _err(422, "line_out_of_range", line=before)
    return before


def _op_move_block(lines, op):
    s, e = _validate_span(lines, op["src"], op.get("construct", "paragraph"))
    dest = op["dest"]
    before = _dest_insert_line(lines, dest)
    if s <= before <= e + 1:
        raise _err(422, "unsupported_target", detail="move onto itself")
    text = lines[s - 1:e]
    pad = dest.get("container_kind") in PARAGRAPH_CONTAINERS
    return [Delete(s, e), Insert(before, list(text), pad=pad)]


def _op_delete_block(lines, op):
    s, e = _validate_span(lines, op["src"], op.get("construct", "paragraph"))
    return [Delete(s, e)]


def _op_insert_media(lines, op):
    at = op["at"]
    before = _dest_insert_line(lines, at)
    kind = op.get("kind", "img")
    marker = "!!" if kind == "video" else "!"
    path = str(op["path"]).strip()
    if not path or "\n" in path:
        raise _err(422, "bad_value", value=path)
    parts = [marker, path] + [str(f) for f in op.get("flags", [])]
    text = " ".join(parts)
    if op.get("caption"):
        text += " | " + str(op["caption"])
    pad = at.get("container_kind") in PARAGRAPH_CONTAINERS
    return [Insert(before, [text], pad=pad)]


def _op_replace_lines(lines, op):
    """Replace a line span verbatim — the panel's source-box editor.

    No construct validation: the user is editing raw DSL text. The SHA
    precondition and the server's build-failure rollback are the safety net.
    """
    s, e = int(op["start"]), int(op["end"])
    if not (1 <= s <= e <= len(lines)):
        raise _err(422, "line_out_of_range", line=s if s < 1 else e)
    text = op.get("text")
    if not isinstance(text, list) or any(not isinstance(t, str) or "\n" in t for t in text):
        raise _err(422, "bad_value", value="text must be a list of lines")
    return [Delete(s, e, seam=False), Insert(s, list(text))]


def _op_reorder_fragments(lines, op):
    prims = []
    for i, item in enumerate(op["order"], 1):
        prims.extend(_op_set_fragment_index(
            lines, {"line": item["line"], "construct": item.get("construct", "media"),
                    "index": i}))
    return prims


_OPS = {
    "set_col_size": _op_set_col_size,
    "set_block_width": _op_set_block_width,
    "set_row_height": _op_set_row_height,
    "set_stack_height": _op_set_stack_height,
    "set_pin": _op_set_pin,
    "set_media_size": _op_set_media_size,
    "set_row_gap": _op_set_row_gap,
    "set_grid_gap": _op_set_grid_gap,
    "set_fragment_index": _op_set_fragment_index,
    "move_block": _op_move_block,
    "delete_block": _op_delete_block,
    "replace_lines": _op_replace_lines,
    "insert_media": _op_insert_media,
    "reorder_fragments": _op_reorder_fragments,
}


# --- application --------------------------------------------------------------


def _compile(lines: list[str], edits: list[dict]) -> list:
    prims = []
    for op in edits:
        name = str(op.get("op"))
        fn = _OPS.get(name)
        if fn is None:
            raise _err(422, "unknown_op", op=name)
        prims.extend(fn(lines, op))
    return prims


def _check_overlaps(prims):
    touched: set[int] = set()
    for p in prims:
        if isinstance(p, Replace):
            span = {p.line}
        elif isinstance(p, Delete):
            span = set(range(p.start, p.end + 1))
        else:
            continue
        if span & touched:
            raise _err(422, "overlap", lines=sorted(span & touched))
        touched |= span
    for p in prims:
        if isinstance(p, Insert) and \
                any(isinstance(d, Delete) and d.start < p.before <= d.end for d in prims):
            # Inserting strictly inside a deleted range is ambiguous
            # (inserting AT the start expresses a span replacement).
            raise _err(422, "overlap", lines=[p.before])


def _reconstruct(lines: list[str], prims: list) -> list[str]:
    replaces = {p.line: p.new for p in prims if isinstance(p, Replace)}
    inserts: dict[int, list[Insert]] = {}
    for p in prims:
        if isinstance(p, Insert):
            inserts.setdefault(p.before, []).append(p)
    deleted: dict[int, bool] = {}  # line -> seam-collapse allowed
    for p in prims:
        if isinstance(p, Delete):
            for n in range(p.start, p.end + 1):
                deleted[n] = p.seam

    def emit_insert(out: list[str], ins: Insert):
        if ins.pad and out and out[-1].strip() != "":
            out.append("")
        out.extend(ins.text)
        if ins.pad:
            out.append("__RV_PAD__")  # collapsed against the next line below

    out: list[str] = []
    pending_pad = False
    for n in range(1, len(lines) + 2):
        for ins in inserts.get(n, []):
            if pending_pad:
                out.append("")
                pending_pad = False
            emit_insert(out, ins)
        if out and out[-1] == "__RV_PAD__":
            out.pop()
            pending_pad = True
        if n > len(lines):
            break
        if n in deleted:
            # seam: collapse a blank-blank join produced by the deletion
            nxt = n + 1
            while nxt in deleted:
                nxt += 1
            if (n - 1) not in deleted and deleted[n]:  # first line of a seam-collapsing range
                prev_blank = bool(out) and out[-1].strip() == ""
                next_blank = nxt <= len(lines) and lines[nxt - 1].strip() == ""
                if prev_blank and next_blank:
                    out.pop()
            continue
        line = replaces.get(n, lines[n - 1])
        if pending_pad:
            if line.strip() != "":
                out.append("")
            pending_pad = False
        out.append(line)
    if pending_pad:
        pass  # padding at EOF is unnecessary
    return out


def apply_edits(path: Path, sha256: str, edits: list[dict]) -> dict:
    """Verify, compile and atomically apply *edits* to *path*.

    Returns ``{"sha256": <new hash>}``. Raises :class:`EditError` on any
    rejection; the file is untouched unless every operation succeeded.
    """
    path = Path(path)
    data = path.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if actual != sha256:
        raise _err(409, "sha_mismatch", expected=sha256, actual=actual)

    text = data.decode("utf-8")
    crlf = "\r\n" in text
    if crlf:
        text = text.replace("\r\n", "\n")
    trailing_nl = text.endswith("\n")
    lines = text.split("\n")
    if trailing_nl:
        lines.pop()

    prims = _compile(lines, edits)
    _check_overlaps(prims)
    new_lines = _reconstruct(lines, prims)

    new_text = "\n".join(new_lines) + ("\n" if trailing_nl else "")
    if crlf:
        new_text = new_text.replace("\n", "\r\n")
    new_data = new_text.encode("utf-8")

    fd, tmp = tempfile.mkstemp(prefix=".rvedit-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(new_data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return {"sha256": hashlib.sha256(new_data).hexdigest()}
