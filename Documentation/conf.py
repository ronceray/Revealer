# Configuration file for the Sphinx documentation builder.
# https://www.sphinx-doc.org/en/master/usage/configuration.html

import sys
from pathlib import Path

# --- Generated reference pages ----------------------------------------------
# reference/constructs.md and reference/directives.md are projected from the
# grammar registry (src/revealer/grammar.py) at every build, so the reference
# can never drift from the code. Files are only rewritten when their content
# changed, keeping incremental builds (and -W) clean.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import gen_reference  # noqa: E402

gen_reference.generate()

project = "Revealer"
copyright = "Candelier Lab"
author = "Candelier Lab"

extensions = [
    "myst_parser",
]

myst_enable_extensions = [
    "colon_fence",
    "deflist",
]

# Auto-generate #anchors for headings so pages can deep-link into each other.
myst_heading_anchors = 3

source_suffix = {
    ".md": "markdown",
}

templates_path = []
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

# -- HTML output -------------------------------------------------------------

html_theme = "furo"
html_title = "Revealer"
html_static_path = ["_static"]
html_extra_path = ["../Demo"]
html_css_files = ["revealer-docs.css"]
html_js_files = ["revealer-docs.js"]
