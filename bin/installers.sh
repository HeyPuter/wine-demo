#!/bin/bash
# installers.sh: INSTALLERS from tools/launcher.tsv (each installer downloaded once from its url, its SHA-256
# checked), for site.sh to put beside the page. INSTALLERS empty: nothing (the guest downloads each itself).
set -euo pipefail; . "$(dirname "$0")/../env.sh"
[ -n "$INSTALLERS" ] || { echo "installers: off (INSTALLERS is empty)"; exit 0; }
mkdir -p "$INSTALLERS"; n=0
while IFS=$'\t' read -r id name cat bytes url f rest; do
  h=${rest##*$'\t'}
  [ -f "$INSTALLERS/$f" ] && [ "$(sha256sum < "$INSTALLERS/$f" | cut -d' ' -f1)" = "$h" ] && { n=$((n + 1)); continue; }
  curl -sfL --max-time 1800 -o "$INSTALLERS/$f.part" "$url"
  [ "$(sha256sum < "$INSTALLERS/$f.part" | cut -d' ' -f1)" = "$h" ] || { rm -f "$INSTALLERS/$f.part"; echo "installers: $url is not $h"; exit 1; }
  mv "$INSTALLERS/$f.part" "$INSTALLERS/$f"; n=$((n + 1))
done < <(grep -v '^#' "$WDR/tools/launcher.tsv" | awk -F'\t' '$1 != "id"')
echo "installers: $INSTALLERS ($n files)"
