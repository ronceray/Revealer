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

import os
import re
from pathlib import Path

from . import assets


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

        try:
            import bibtexparser
        except ImportError:
            self.error = (
                "The 'bibtexparser' package is required for bibliography "
                "support. Install Revealer with its dependencies (pipx)."
            )
            return

        with open(bfile) as bibtex_file:
            self.base = bibtexparser.load(bibtex_file)

    def add_entry(self, tag):
        if self.error is not None:
            return
        if tag in self.item_tag:
            return

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
                p = a.split(" ")
                for j in range(len(p) - 1):
                    sd += p[j][0] + ". "
                sd += p[-1]

                if len(al) > 2:
                    sd += " <i>et. al</i>"
                    break
                elif i < len(al) - 1:
                    sd += ", "
            entry["authors-short"] = sd

            # Journal short description
            journal = entry.get("journal")
            if journal is not None:
                entry["journal-short"] = self.JOURNAL_SHORT.get(journal, journal)
            break

    def short_description(self, tag):
        if self.error is not None:
            return ""
        I = self.item_tag[tag]
        if "journal-short" in I:
            return "{:d}. {:s}, <i>{:s}</i> ({:s})".format(
                I["revealer-number"], I["authors-short"], I["journal-short"], I.get("year", "")
            )
        return "{:d}. {:s} ({:s})".format(
            I["revealer-number"], I["authors-short"], I.get("year", "")
        )

    def long_description(self, tag):
        if self.error is not None:
            return ""
        I = self.item_tag[tag]
        return "{:d}. {:s}: {:s} {:s} {:s} {:s}".format(
            I["revealer-number"],
            I["authors-short"],
            "<i>" + I["title"] + "</i>," if "title" in I else "",
            I.get("journal", ""),
            "(" + I["year"] + ")" if "year" in I else "",
            ' - <a class="doi" href="https://doi.org/{0}">{0}</a>'.format(I["doi"]) if "doi" in I else "",
        )


def contentify(html: str) -> str:
    """Translate Revealer content shortcuts into HTML."""

    lines = html.strip().split("\n")
    html = ""
    codemode = False
    colmode = False

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

    def _escape_style_value(value: str) -> str:
        return value.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")

    def _is_truthy(value: str) -> bool:
        return value.strip().lower() in {"true", "yes", "1", "on"}

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
            index += 1

        table_classes = "rv-table bordered" if border else "rv-table"
        out = (
            "<style>"
            ".rv-content-inner:has(> .rv-table-wrap){{height:100%;}}"
            ".rv-table-wrap{{box-sizing:border-box;width:100%;height:100%;min-height:60vh;}}"
            ".rv-table{{display:grid;width:100%;height:100%;box-sizing:border-box;}}"
            ".rv-table-cell{{display:flex;align-items:center;justify-content:center;text-align:center;"
            "box-sizing:border-box;padding:.25em;overflow:hidden;}}"
            ".rv-table.bordered .rv-table-cell{{border:1px solid #444;}}"
            "</style>"
            '<div class="rv-table-wrap" style="padding:{margin};">'
            '<div class="{table_classes}" style="grid-template-columns:repeat({cols},minmax(0,1fr));'
            'grid-template-rows:repeat({rows},minmax(0,1fr));">'
        ).format(
            margin=_escape_style_value(margin),
            table_classes=table_classes,
            cols=column_count,
            rows=row_count,
        )
        for cell in cells:
            style = (
                "grid-row:{row};grid-column:{column};background:{background};"
            ).format(
                row=cell["row"],
                column=cell["column"],
                background=_escape_style_value(cell["background"]),
            )
            out += '<div class="rv-table-cell" style="{style}"><div>'.format(style=style)
            out += contentify("\n".join(cell["content"])) if cell["content"] else ""
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
                bg = None
                if ":" in spec:
                    spec, bg = spec.split(":", 1)
                    bg = bg.strip() or None
                parts = spec.split()
                cf, ca, parts = _frag_attrs(parts)  # + / +N fragment flag
                plain = "plain" in parts
                extra = [p for p in parts if p != "plain"]  # any other tokens = extra classes
                current = {"frag": bool(cf), "fattr": ca, "plain": plain, "bg": bg, "classes": extra, "content": []}
                cards.append(current)
                index += 1
                continue

            if current is None and not line.strip():
                index += 1
                continue
            if current is None:
                current = {"frag": False, "plain": False, "bg": None, "content": []}
                cards.append(current)
            current["content"].append(line)
            index += 1

        wrap_cls = "sfi-grid-wrap compact" if compact else "sfi-grid-wrap"
        row_tmpl = "auto" if compact else "minmax(0,1fr)"
        out = (
            "<style>"
            ".rv-content-inner:has(> .sfi-grid-wrap){{height:100%;}}"
            "</style>"
            '<div class="{wrap_cls}" style="padding:{margin};">'
            '<div class="sfi-grid" style="grid-template-columns:repeat({cols},minmax(0,1fr));'
            'grid-template-rows:repeat({rows},{row_tmpl});gap:{gap};">'
        ).format(
            wrap_cls=wrap_cls,
            margin=_escape_style_value(margin),
            cols=column_count,
            rows=row_count,
            row_tmpl=row_tmpl,
            gap=_escape_style_value(gap),
        )
        for c in cards:
            cls = "sfi-cell" if c.get("plain") else "sfi-card"
            if c.get("classes"):
                cls += " " + " ".join(c["classes"])
            if c["frag"]:
                cls += " fragment"
            style = "background:{0};".format(_escape_style_value(c["bg"])) if c["bg"] else ""
            out += '<div class="{cls}" style="{style}"{fa}>'.format(cls=cls, style=style, fa=c.get("fattr", ""))
            out += contentify("\n".join(c["content"])) if c["content"] else ""
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
        index = start_index + 1
        while index < len(lines):
            line = lines[index]
            if re.match(r"^>\s*end\s*:\s*pin\s*$", line):
                index += 1
                break
            content.append(line)
            index += 1

        style = "left:{x};top:{y};".format(x=_escape_style_value(x), y=_escape_style_value(y))
        if w:
            style += "width:{w};".format(w=_escape_style_value(w))
        cls = "sfi-pin fragment" if frag else "sfi-pin"
        out = '<div class="{cls}" style="{style}">'.format(cls=cls, style=style)
        out += contentify("\n".join(content)) if content else ""
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
                current = {"flex": "1 1 0", "fcls": "", "fattr": "", "lines": []}
                cells.append(current)

        while index < len(lines):
            line = lines[index]
            if re.match(r"^>\s*row\b", line):
                depth += 1
                _ensure_cell()
                current["lines"].append(line)
                index += 1
                continue
            if re.match(r"^>\s*end\s*:\s*row\s*$", line):
                depth -= 1
                if depth == 0:
                    index += 1
                    break
                current["lines"].append(line)
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
                    "justify": "center" if center else "flex-start", "extra": extra, "lines": [],
                }
                cells.append(current)
                index += 1
                continue
            _ensure_cell()
            current["lines"].append(line)
            index += 1

        inner = ""
        for c in cells:
            inner += '<div class="region{cf}" style="flex:{flex};gap:var(--gap-row);justify-content:{just};{extra}"{ca}>'.format(
                cf=c["fcls"], flex=c["flex"], just=c.get("justify", "flex-start"), extra=c.get("extra", ""), ca=c["fattr"]
            )
            inner += contentify("\n".join(c["lines"])) if c["lines"] else ""
            inner += "</div>"
        row_flex = "flex:0 0 {0};height:{0};".format(height) if height else "flex:1 1 auto;"
        out = (
            '<div class="row{fcls}" style="{row_flex}min-height:0;align-items:stretch;'
            'gap:{gap};"{fattr}>{inner}</div>'
        ).format(fcls=fcls, row_flex=row_flex, gap=_escape_style_value(gap), fattr=fattr, inner=inner)
        return out, index

    def _parse_box(start_index: int, kind: str):
        """Parse ``> info|warn|good [+[N]] [Title]`` … ``> end: info|warn|good`` → a callout box."""
        head = re.match(r"^>\s*(?:info|warn|good)\b(.*)$", lines[start_index]).group(1).split()
        fcls, fattr, head = _frag_attrs(head)
        title = " ".join(head).strip()
        box_cls = {"info": "box-info", "warn": "box-warn", "good": "box-good"}[kind]
        content = []
        index = start_index + 1
        while index < len(lines):
            line = lines[index]
            if re.match(r"^>\s*end\s*:\s*" + kind + r"\s*$", line):
                index += 1
                break
            content.append(line)
            index += 1
        body = contentify("\n".join(content)) if content else ""
        title_html = '<div class="box-title">{0}</div>'.format(title) if title else ""
        out = '<div class="{bc}{fcls}"{fattr}>{title}{body}</div>'.format(
            bc=box_cls, fcls=fcls, fattr=fattr, title=title_html, body=body
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
        out = '<div class="math-box{fcls}"{fattr}>{body}</div>'.format(fcls=fcls, fattr=fattr, body=body)
        return out, index

    def _parse_frag(start_index: int):
        """Parse ``> frag [N]`` … ``> end: frag`` → wrap content in a reveal fragment."""
        head = re.match(r"^>\s*frag\b(.*)$", lines[start_index]).group(1).strip()
        attr = ' data-fragment-index="{0}"'.format(head) if re.match(r"^\d+$", head) else ""
        content = []
        depth = 1
        index = start_index + 1
        while index < len(lines):
            line = lines[index]
            if re.match(r"^>\s*frag\b", line):
                depth += 1
                content.append(line)
                index += 1
                continue
            if re.match(r"^>\s*end\s*:\s*frag\s*$", line):
                depth -= 1
                if depth == 0:
                    index += 1
                    break
                content.append(line)
                index += 1
                continue
            content.append(line)
            index += 1
        body = contentify("\n".join(content)) if content else ""
        out = '<div class="fragment"{attr}>{body}</div>'.format(attr=attr, body=body)
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
                current = {"fcls": cf, "fattr": ca, "clear": clear, "lines": []}
                layers.append(current)
                index += 1
                continue
            if current is None:
                if not line.strip():
                    index += 1
                    continue
                current = {"fcls": "", "fattr": "", "clear": False, "lines": []}
                layers.append(current)
            current["lines"].append(line)
            index += 1
        inner = ""
        for ly in layers:
            # opaque backdrop only on revealed (fragment) layers that aren't `clear`
            opaque = " rv-opaque" if (ly["fcls"] and not ly["clear"]) else ""
            inner += '<div class="rv-layer{fc}{op}"{fa}>'.format(fc=ly["fcls"], op=opaque, fa=ly["fattr"])
            inner += contentify("\n".join(ly["lines"])) if ly["lines"] else ""
            inner += "</div>"
        style = "flex:0 0 {0};height:{0};".format(height) if height else "flex:1 1 0;"
        out = '<div class="rv-stack" style="{st}">{inner}</div>'.format(st=style, inner=inner)
        return out, index

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

            # --- Table blocks

            if re.match(r"^>\s*table\(\s*\d+\s*,\s*\d+\s*\)\s*$", line):
                _close_lists()
                table_html, index = _parse_table(index)
                html += table_html
                continue

            # --- Grid blocks (declarative card grid; like a table but with
            #     card styling and optional per-card fragment reveal `+`)

            if re.match(r"^>\s*grid\(\s*\d+\s*,\s*\d+\s*\)\s*(?:compact)?\s*$", line):
                _close_lists()
                grid_html, index = _parse_grid(index)
                html += grid_html
                continue

            # --- Pin overlay block (absolute % overlay, optional `+` fragment)

            if re.match(r"^>\s*pin\s*:", line):
                _close_lists()
                pin_html, index = _parse_pin(index)
                html += pin_html
                continue

            # --- Layout row/col, callout boxes, framed equation, fragment wrapper

            if re.match(r"^>\s*row\b", line):
                _close_lists()
                row_html, index = _parse_row(index)
                html += row_html
                continue

            box = re.match(r"^>\s*(info|warn|good)\b", line)
            if box:
                _close_lists()
                box_html, index = _parse_box(index, box.group(1))
                html += box_html
                continue

            if re.match(r"^>\s*eq\b", line):
                _close_lists()
                eq_html, index = _parse_eq(index)
                html += eq_html
                continue

            if re.match(r"^>\s*stack\b", line):
                _close_lists()
                stack_html, index = _parse_stack(index)
                html += stack_html
                continue

            if re.match(r"^>\s*frag\b", line):
                _close_lists()
                frag_html, index = _parse_frag(index)
                html += frag_html
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
                    html += "</div></div>"
                else:
                    html += (
                        "<style>.multi-column{ display: flex; } .column{ flex: 1; }</style>"
                        '<div class="multi-column"><div class="column" style="flex: 0 0 '
                        + ("47%" if len(line) == 2 else line[2:].strip())
                        + ';">'
                    )
                colmode = not colmode
                index += 1
                continue
            elif colmode and line.startswith("|"):
                _close_lists()
                html += '</div><div class="column" style="flex: 0 0 ' + (
                    "47%" if len(line) == 1 else line[1:].strip()
                ) + ';">'
                index += 1
                continue

            _close_lists()

            # --- Media: !! video / ! image  (leading whitespace tolerated)

            lstripped = line.lstrip()
            if lstripped.startswith("!! "):
                html += _media_shortcut("video", lstripped[3:].strip())
                index += 1
                continue
            if lstripped.startswith("! "):
                html += _media_shortcut("img", lstripped[2:].strip())
                index += 1
                continue

            # --- Highlighted block

            if line.startswith("[ ") and line.endswith(" ]"):
                html += '<div class="highlight">' + line[2:-2] + "</div>"
                index += 1
                continue

            # --- Default: add line

            html += line

        if not line.startswith("<pre>"):
            html += "\n"
        index += 1

    # --- Close any block left open at the end of the slide

    if codemode:
        html += "</code></pre>"
    # Close any open list items and uls
    _close_lists()
    if len(ul_stack) == 0 and list_style_injected:
        # preserve previous behaviour: add a break after lists
        html += "<br>"
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


def _media_shortcut(kind: str, rest: str) -> str:
    """Render an ``!`` image or ``!!`` video shortcut.

    Syntax: ``! path [flags] [| caption]`` and ``!! path [flags] [| caption]``.

    Flags: ``fill`` (fill a sized parent — e.g. a grid card), ``cover`` / ``contain``
    (object-fit), ``top`` (object-position), and for video ``loop`` / ``autoplay`` /
    ``controls``. A trailing ``| caption`` adds a caption (styled as a figure caption,
    or as a card label when inside a card).
    """
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

    p = _escape_attr(path)
    cap_html = '<div class="rv-cap">{0}</div>'.format(caption) if caption else ""
    fig_cls = "rv-fig" + frag_cls

    if kind == "img":
        if fill:
            style = "object-fit:{0};object-position:{1};{2}".format(objfit, pos, size_css)
            return '<img class="rv-media-fill{0}"{1} style="{2}" src="{3}" alt="">{4}'.format(
                frag_cls, frag_attr, style, p, cap_html
            )
        img = '<img class="rv-media" style="object-fit:{0};{1}" src="{2}" alt="">'.format(objfit, size_css, p)
        return '<figure class="{0}"{1}>{2}{3}</figure>'.format(fig_cls, frag_attr, img, cap_html)

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
        vid = '<video class="rv-media-fill{0}"{1} style="{2}" {3}><source src="{4}" type="{5}"></video>'.format(
            frag_cls, frag_attr, style, attrs_s, p, mime
        )
        return vid + cap_html
    vid = '<video class="rv-media" style="object-fit:{0};{1}" {2}><source src="{3}" type="{4}"></video>'.format(
        objfit, size_css, attrs_s, p, mime
    )
    return '<figure class="{0}"{1}>{2}{3}</figure>'.format(fig_cls, frag_attr, vid, cap_html)


def build(pfile: str) -> str:
    """Build the HTML presentation associated with ``pfile``.

    Returns the path of the generated ``.html`` file.
    """

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
    notes = False
    block_depth = 0  # nesting depth of content blocks (table/grid/pin/row/info/warn/eq/frag)

    with open(pfile, "r") as fid:
        for line in fid:

            if line.startswith("#"):
                continue

            s = ">>> first: "
            if line.startswith(s):
                slide.append({"type": "first", "title": line[len(s):].strip(), "html": "", "notes": "", "param": {}})
                notes = False
                block_depth = 0
                continue

            s = r"%%% "
            if line.startswith(s):
                slide.append({"type": "section", "title": line[len(s):].strip(), "html": "", "notes": "", "param": {}})
                notes = False
                block_depth = 0
                continue

            s = "=== "
            if line.startswith(s):
                slide.append({"type": "slide", "title": line[len(s):].strip(), "html": "", "notes": "", "param": {}})
                notes = False
                block_depth = 0
                continue

            s = "--- "
            if line.startswith(s):
                match slide[-1]["type"]:
                    case "lastchild":
                        slide[-1]["type"] = "child"
                    case _:
                        slide[-1]["type"] = "parent"
                slide.append({"type": "lastchild", "title": line[len(s):].strip(), "html": "", "notes": "", "param": {}})
                notes = False
                block_depth = 0
                continue

            s = ">>> biblio"
            if line.startswith(s):
                slide.append({"type": "biblio", "title": "Bibliography", "html": "", "notes": "", "param": {}})
                notes = False
                block_depth = 0
                continue

            # --- Settings

            if line.startswith(">"):

                # Content-level block directives (table / grid / pin / row /
                # info / warn / eq / frag) are passed through to the slide HTML
                # so contentify() renders them inline, instead of being captured
                # as slide parameters. A depth counter supports nesting (e.g. a
                # row inside a col); every opener bumps it, every `> end:` drops it.
                block_open = (
                    re.match(r"^>\s*(?:table|grid)\(\s*\d+\s*,\s*\d+\s*\)\s*(?:compact)?\s*$", line)
                    or re.match(r"^>\s*pin\s*:", line)
                    or re.match(r"^>\s*(?:row|info|warn|good|eq|frag|stack)\b", line)
                )
                block_close = re.match(r"^>\s*end\s*:\s*\w+\s*$", line)
                if len(slide) and not notes and (block_depth > 0 or block_open):
                    slide[-1]["html"] += line
                    if block_open:
                        block_depth += 1
                    elif block_close and block_depth > 0:
                        block_depth -= 1
                    continue

                if len(slide) and not notes and block_close:
                    slide[-1]["html"] += line
                    continue

                if line.startswith("> notes:"):
                    notes = True

                # `> fill [between|center|around]`: make this slide's content fill
                # the canvas (a flex column) so layout rows/regions resolve their
                # heights; the optional keyword sets vertical distribution.
                fillm = re.match(r"^>\s*fill(?:\s+(between|center|around|end))?\s*$", line)
                if len(slide) and fillm:
                    slide[-1]["param"]["fill"] = fillm.group(1) or True
                    continue

                x = re.search("^> ([^:]*): (.*)", line)
                if x:
                    if len(slide):
                        target = slide[-1]["param"]
                    else:
                        target = setting

                    key, value = x.group(1), x.group(2)
                    if key in target:
                        if not isinstance(target[key], list):
                            target[key] = [target[key]]
                        target[key].append(value)
                    else:
                        target[key] = value
                    # If this is an inline svg directive inside a slide,
                    # insert a placeholder into the slide HTML so that the
                    # SVG can be emitted exactly where the directive appears
                    # in the source .pres file.
                    if key == "svg" and len(slide):
                        placeholder = "__REVEALER_SVG__"
                        slide[-1]["html"] += placeholder + "\n"
                        target["_svg_placeholder"] = placeholder

            # --- Slide content

            if len(slide) and not line.startswith(">"):
                if notes:
                    slide[-1]["notes"] += line
                else:
                    slide[-1]["html"] += line

    # === Bibliography ========================================================

    biblio = Bibtex(setting["bibtex"], pdir) if "bibtex" in setting else None

    # === Default settings ====================================================

    setting.setdefault("title", "Revealer")
    setting.setdefault("theme", "revealer")
    setting.setdefault("codeTheme", "zenburn")
    setting.setdefault("notesSize", "1em")
    setting.setdefault("svgDuration", "0.5s")
    setting["maxRefsPerPage"] = int(setting.get("maxRefsPerPage", 5))

    # === Output ==============================================================

    with open(os.path.join(rdir, "index.html"), "r") as tfile:
        out = tfile.read()

    # --- Path fixing

    for old, new in [
        ('<link rel="stylesheet" href="', '<link rel="stylesheet" href="reveal.js/'),
        ('<script src="', '<script src="reveal.js/'),
    ]:
        out = out.replace(old, new)

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
    def _to_js_literal(val):
        if isinstance(val, bool):
            return "true" if val else "false"
        try:
            # numeric?
            if isinstance(val, (int, float)):
                return str(val)
            s = str(val).strip()
            ls = s.lower()
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
            js_items = ", ".join(_to_js_literal(x) for x in v)
            jsval = f"[{js_items}]"
        else:
            jsval = _to_js_literal(v)
        opts.append(f"{mapped_key}: {jsval}")

    # Point the math plugin at the locally-bundled KaTeX (copied into
    # reveal.js/katex by assets.inject_revealer_assets) so equations render
    # offline instead of depending on the jsdelivr CDN at runtime.
    if "katex" not in setting and (assets.DATA / "katex" / "dist" / "katex.min.js").is_file():
        opts.append("katex: { local: 'reveal.js/katex' }")

    extra = "" if not opts else "\n        " + ",\n        ".join(opts) + "\n        "
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
                content += '<section data-transition="none">'

            opt = 'data-transition="none" data-state="slide_{:d}"'.format(k)

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
                        content += '<section data-transition="none" data-state="slide_{:d}">'.format(k + i)
                        title = S["param"].get("title", S["title"])
                        if npages == 1:
                            content += '<div class="slide_header">{:s}</div>'.format(title)
                        else:
                            content += '<div class="slide_header">{:s} - {:d}/{:d}</div>'.format(title, i + 1, npages)
                        content += '<div class="rv-content"><div class="rv-content-inner">'
                        for j in range(sindex, min(sindex + setting["maxRefsPerPage"], len(biblio.item_num))):
                            content += '<div class="biblio-long">' + biblio.long_description(biblio.item_num[j]["ID"]) + "</div>"
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
        placeholder = S["param"].get("_svg_placeholder") if "param" in S else None
        if placeholder and placeholder in S["html"]:
            body += contentify(S["html"]).replace(placeholder, svg_html)
        else:
            body += svg_html + contentify(S["html"])

        # --- Speaker notes (kept as a direct child of <section>) -------------

        notes_html = ""
        if len(S["notes"]):
            nS = S["param"].get("notes", setting["notesSize"])
            notes_html = (
                '<aside class="notes"><style>.speaker-controls-notes {font-size: '
                + nS
                + ";} .speaker-controls-notes ul {margin: 0px; padding-left: 10px;}</style>"
            )
            notes_html += contentify(S["notes"]) + "</aside>"

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
        # area left by the header/footer and rescale it to always fit.
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

    ofile = os.path.join(pdir, os.path.splitext(os.path.basename(pfile))[0] + ".html")
    with open(ofile, "w") as fid:
        fid.write(out)

    return ofile


def _build_svg(S, pdir, default_duration):
    """Inline an SVG file and emit the animation fragments for a slide."""

    if "svg" not in S["param"]:
        return ""

    svg_path = os.path.join(pdir, S["param"]["svg"])
    try:
        svg = Path(svg_path).read_text()
    except OSError:
        return '<div class="svg-error">SVG not found: {:s}</div>'.format(S["param"]["svg"])

    # Strip XML/doctype declarations so the SVG embeds cleanly
    svg = re.sub(r"<\?xml.*?\?>", "", svg, flags=re.DOTALL)
    svg = re.sub(r"<!DOCTYPE.*?>", "", svg, flags=re.DOTALL)

    out = '<div class="revealer-svg">' + svg.strip() + "</div>"

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
