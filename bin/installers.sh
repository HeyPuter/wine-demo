#!/bin/bash
# installers.sh: INSTALLERS from tools/launcher.tsv (each installer downloaded once from its url, its SHA-256
# checked), for site.sh to put beside the page. INSTALLERS empty: nothing (the guest downloads each itself). A row
# with no file is a tile whose installer the visitor brings: nothing to fetch.
set -euo pipefail; . "$(dirname "$0")/../env.sh"
[ -n "$INSTALLERS" ] || { echo "installers: off (INSTALLERS is empty)"; exit 0; }
mkdir -p "$INSTALLERS"; n=0
while IFS=$'\t' read -r f url h; do
  [ -f "$INSTALLERS/$f" ] && [ "$(sha256sum < "$INSTALLERS/$f" | cut -d' ' -f1)" = "$h" ] && { n=$((n + 1)); continue; }
  # no url (an installer with no download site yet): put in INSTALLERS by hand
  [ -n "$url" ] || { echo "installers: no $INSTALLERS/$f with sha256 $h, and no url to fetch it from"; exit 1; }
  curl -sfL --max-time 1800 -o "$INSTALLERS/$f.part" "$url"
  [ "$(sha256sum < "$INSTALLERS/$f.part" | cut -d' ' -f1)" = "$h" ] || { rm -f "$INSTALLERS/$f.part"; echo "installers: $url is not $h"; exit 1; }
  mv "$INSTALLERS/$f.part" "$INSTALLERS/$f"; n=$((n + 1))
done < <(grep -v '^#' "$WDR/tools/launcher.tsv" | awk -F'\t' '$1 == "id" { for (i = 1; i <= NF; i++) c[$i] = i; next } $c["file"] != "" { print $c["file"] "\t" $c["url"] "\t" $c["sha256"] }')
echo "installers: $INSTALLERS ($n files)"
