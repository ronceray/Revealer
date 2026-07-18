#!/usr/bin/env bash
# snap.sh — screenshot one slide of a built Revealer deck.
#
#   snap.sh <deck.html> <slide> <out.png> [--fragments]
#
#   <slide>      reveal.js index: N, or N/M for a vertical slide
#   --fragments  force every fragment visible (the same trick revealer pdf
#                uses), so hidden fragment content shows in the shot
#
# Exit codes: 0 ok, 1 bad input or capture failure, 2 usage, 3 no Chrome/Chromium found.
set -euo pipefail

[ $# -ge 3 ] || { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
html=$1; slide=$2; out=$3; frag=${4:-}

[ -f "$html" ] || { echo "snap.sh: no such file: $html" >&2; exit 1; }

chrome=$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || command -v chrome || true)
[ -n "$chrome" ] || { echo "snap.sh: no google-chrome/chromium on PATH — cannot verify visually" >&2; exit 3; }

src=$html
if [ "$frag" = "--fragments" ]; then
    # The copy must stay NEXT TO the original: the built HTML references
    # reveal.js/ and Media/ relative to its own directory.
    src=$(mktemp -p "$(dirname "$html")" --suffix=.html .snap-XXXXXX)
    trap 'rm -f "$src"' EXIT
    sed 's|</head>|<style>.fragment{opacity:1 !important; visibility:visible !important}</style></head>|' \
        "$html" > "$src"
fi

abs=$(readlink -f "$src")
if ! "$chrome" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --window-size=1920,1080 --virtual-time-budget=9000 \
    --run-all-compositor-stages-before-draw --screenshot="$out" \
    "file://$abs#/$slide" >/dev/null 2>&1; then
    echo "snap.sh: Chrome failed while capturing $html slide $slide" >&2
    exit 1
fi

[ -s "$out" ] || { echo "snap.sh: Chrome exited 0 but wrote no screenshot: $out" >&2; exit 1; }

echo "$out"
