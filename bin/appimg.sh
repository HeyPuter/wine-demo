#!/bin/bash
# appimg.sh: the images tools/dll-bases pins inside a launcher app's own install, which no bundle holds (the
# visitor's tile installs the app), for bin/units.sh: each tools/app-images.tsv row's installer (INSTALLERS) run
# once natively by GEX's wine/run.sh on the dist dist.sh made, into a scratch prefix, and its pinned files copied to
# WD_OUT/appimg/drive_c/FOLDER. A row whose files are there already is kept.
set -euo pipefail
. "$(dirname "$0")/../env.sh"; need_gex; S=$WD_OUT; cd $S
. <(sed 's/^/export /' logs/dist.out)
grep -v '^#' $WDR/tools/app-images.tsv | while IFS=$'\t' read -r folder inst args files; do
  [ "$folder" = folder ] && continue
  out=appimg/drive_c/$folder; have=1
  for f in $files; do [ -f "$out/$f" ] || have=; done
  [ -n "$have" ] && { echo "appimg: $folder kept"; continue; }
  k=$S/work/appimg-pfx; rm -rf "$k"; mkdir -p "$k"
  # shellcheck disable=SC2086
  systemd-run --user --scope -q -p TasksMax=2048 nice -n 10 timeout 1800 $GEX/wine/run.sh --dist $WINE64_DIST \
    --prefix $WINE64_PREFIX --native $WINE64_NATIVE --keep "$k" --null --timeout 1700 "$INSTALLERS/$inst" $args \
    > logs/appimg-$inst.log 2>&1 || { echo "appimg: $inst failed (logs/appimg-$inst.log)"; exit 1; }
  for f in $files; do mkdir -p "$out/$(dirname "$f")"; cp "$k/drive_c/appimg/$f" "$out/$f"; done
  rm -rf "$k"; echo "appimg: $folder from $inst"
done
