#!/usr/bin/env bash
# Retakes the UI screenshots of the docs (site/images/ui/*-light.png and *-dark.png) from the demo data of the pages.
# Needs Google Chrome (set CHROME to its path if it is not at the macOS default). Take them online: the pages load Google Fonts.
# Usage: scripts/ui-screenshots.sh
#
# Each shot is: name | page | hash | route | view | width x height
#   route  the screen of the site (sessionStorage zf-route): flows, new, templates
#   view   the steps view (localStorage zf-view): lanes or runbook
# The live page shows demo data when its hash starts with "preview" (skills/live-flow/page.html, fakeDb).

set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT=site/images/ui
TMP="$(mktemp -d)"
mkdir -p "$OUT"
LIVE=skills/live-flow/page.html

shot() { # name page hash route view size theme
  local name=$1 page=$2 hash=$3 route=$4 view=$5 size=$6 theme=$7 file="$PWD/$2"
  if [ -n "$route$view" ]; then # run a line before the page code to set the screen and the view
    file="$TMP/$name.html"
    python3 - "$PWD/$page" "$file" "$route" "$view" <<'PY'
import sys
src, dst, route, view = sys.argv[1:5]
pre = "<script>try{" + (f"sessionStorage.setItem('zf-route','{route}');" if route else "") + (f"localStorage.setItem('zf-view','{view}');" if view else "") + "}catch(e){}</script>"
s = open(src).read()
open(dst, "w").write(s.replace("<body", pre + "<body", 1) if "<body" in s else pre + s)
PY
  fi
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size="${size/x/,}" --virtual-time-budget=6000 \
    --blink-settings=preferredColorScheme=$([ "$theme" = dark ] && echo 0 || echo 1) \
    --screenshot="$OUT/$name-$theme.png" "file://$file$hash" >/dev/null 2>&1
  echo "$OUT/$name-$theme.png"
}

for theme in light dark; do
  shot flows-waiting $LIVE '#preview' flows lanes 1280x900 $theme
  shot flows-runbook $LIVE '#preview' flows runbook 1280x1100 $theme
  shot new-flow $LIVE '#preview' new '' 1280x900 $theme
  shot templates $LIVE '#preview' templates '' 1280x900 $theme
  shot session-closed $LIVE '#previewclosed' flows lanes 1280x700 $theme
  shot session-none $LIVE '#previewnone' flows lanes 1280x700 $theme
  shot plan-create-template skills/create-template/page.html '' '' '' 1280x1000 $theme
  shot plan-create-marketplace skills/create-marketplace/page.html '' '' '' 1280x1000 $theme
done
rm -rf "$TMP"
