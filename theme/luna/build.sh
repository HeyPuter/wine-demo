#!/bin/bash
# build.sh WINE_SRC TOOLS OUT: OUT/luna.msstyles. WINE_SRC's dlls/aero.msstyles is the skeleton (its rc and
# the bitmaps this theme doesn't draw); TOOLS is the dist's tools build (wrc, winegcc, winebuild).
set -euo pipefail
W=$(realpath "$1"); T=$(realpath "$2"); O=$(realpath -m "$3"); D=$(dirname "$(realpath "$0")")
A=$W/dlls/aero.msstyles
mkdir -p "$O"; rm -rf "${O:?}/b"; mkdir "$O/b"
python3 -I "$D/luna.py" "$A" "$O"
python3 -I "$D/raster.py" "$O"
cp "$A"/*.bmp "$O/b/"; cp "$O"/bmp/*.bmp "$O/b/"; cp "$O/luna.rc" "$O/b/"
"$T/tools/wrc/wrc" -u --nostdinc --nls-dir="$W/nls" -I"$W/include" -I"$T/include" -I"$O/b" -I"$A" -o "$O/luna.res" "$O/b/luna.rc"
"$T/tools/winegcc/winegcc" -b x86_64-w64-mingw32 --winebuild "$T/tools/winebuild/winebuild" -shared -nostdlib \
  -Wb,--data-only "$O/luna.res" -o "$O/luna.msstyles"
echo "luna: $O/luna.msstyles ($(stat -c %s "$O/luna.msstyles") bytes)"
