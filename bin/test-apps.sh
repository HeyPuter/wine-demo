#!/bin/bash
# test-apps.sh: TEST_APPS from test-apps.txt (each file downloaded once, its SHA-256 checked), and its SHA256SUMS.
set -euo pipefail; . "$(dirname "$0")/../env.sh"; mkdir -p "$TEST_APPS"
grep -v '^#' "$WDR/test-apps.txt" | while read -r f h u; do
  [ -n "$f" ] || continue
  [ -f "$TEST_APPS/$f" ] && [ "$(sha256sum < "$TEST_APPS/$f" | cut -d' ' -f1)" = "$h" ] && continue
  curl -sfL --max-time 300 -o "$TEST_APPS/$f.part" "$u"
  [ "$(sha256sum < "$TEST_APPS/$f.part" | cut -d' ' -f1)" = "$h" ] || { rm -f "$TEST_APPS/$f.part"; echo "test-apps: $u is not $h"; exit 1; }
  mv "$TEST_APPS/$f.part" "$TEST_APPS/$f"
done
grep -v '^#' "$WDR/test-apps.txt" | awk 'NF {print $2 "  " $1}' > "$TEST_APPS/SHA256SUMS"
(cd "$TEST_APPS" && sha256sum -c --quiet SHA256SUMS) && echo "test-apps: $TEST_APPS ($(grep -c . "$TEST_APPS/SHA256SUMS") files)"
