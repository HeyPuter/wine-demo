#!/bin/bash
# dist.sh DIST: WD_OUT/w64/dist from the gate's native-i386 WoW64 dist DIST (GATE_W64/dist64-K-...-wow64-...-nN64-N32-sS),
# its x86-64 core restaged with PELINK_EXPORT_ALL=1 (gexcc-win apps import kernel32/ucrtbase names the gate's
# core leaves out) by GEX's stage-native64.sh, and w64/dist.env (what the audit and mkapps read). The dist
# that was there becomes w64/dist-prev. Also finds the WoW64 prefix wine/dist.sh made for DIST (w64/prefix:
# GEX's wine/prefix-key.sh, from the keys dist.sh stamps it with); DIST_PREFIX names it instead. WINE_SRC names
# the Wine source the core is restaged from (default: the build tree's srcdir).
set -euo pipefail; . "$(dirname "$0")/../env.sh"; need_gex
DIST=$(realpath "${1:?DIST}"); G=$GATE_W64; cd "$WD_OUT"
K=$(basename "$DIST" | sed -n 's/^dist64-\([0-9a-f]\{12\}\)-.*-wow64-.*-n[0-9a-f]*-[0-9a-f]*-s[0-9a-f]*\(-twin[0-9a-f]*\)\{0,1\}$/\1/p')
[ -n "$K" ] || { echo "dist: $DIST is not a native-i386 WoW64 dist (dist64-K-...-wow64-...-nN64-N32-sS)"; exit 1; }
one() { [ $# = 1 ] && [ -e "$1" ] || { echo "dist: want one $what, got: $*" >&2; exit 1; }; echo "$1"; }
# DIST_B64: a copy of that tree whose PE objects were remade from WINE_SRC (the core is restaged from the
# tree's objects, not from WINE_SRC itself)
what="wasm64 wow64 tree"; B64=${DIST_B64:-$(one $(ls -d $G/b64-$K-*-wow64 2>/dev/null))}
nk=$(basename $DIST | sed 's/.*-n\([0-9a-f]*\)-\([0-9a-f]*\)-s[0-9a-f]*\(-twin[0-9a-f]*\)\{0,1\}$/\1 \2/')
what="x86-64 native dir"; P64=$(one $(ls -d $G/pen64-$K-${nk% *} 2>/dev/null))
what="i386 native dir"; P32=$(one $(ls -d $G/pen32-$K-${nk#* } 2>/dev/null))
what="sysroot"; SR=$(one $(grep -o "/[^ ]*/sr64-[0-9a-f-]*" $P64.log | sort -u))/sysroot
PFX=${DIST_PREFIX:-}
if [ -z "$PFX" ]; then
  [ -x $GEX/wine/prefix-key.sh ] || { echo "dist: $GEX has no wine/prefix-key.sh: name the prefix with DIST_PREFIX" >&2; exit 1; }
  what="WoW64 prefix made for $DIST"; PFX=$(one $($GEX/wine/prefix-key.sh $DIST $G/pfs64-*-wow64-*/pfx))
fi
# WINE_SRC: the Wine source at DIST's commit when the gate's checkout (B64's srcdir) has moved on to its next round
# (the source the restaged objects were made from)
WSRC=${WINE_SRC:-$(sed -n 's/^srcdir = //p' $B64/Makefile)}
printf 'dist %s\nb64 %s\npen64 %s\npen32 %s\nsysroot %s\nprefix %s\nwine src %s (%s)\n' $DIST $B64 $P64 $P32 $SR $PFX $WSRC "$(git -C $WSRC log --oneline -1 | cut -c1-70)"
CORE="ntdll.dll kernelbase.dll kernel32.dll msvcrt.dll ucrtbase.dll winewayland.drv wow64.dll wow64win.dll wow64cpu.dll wineboot.exe services.exe explorer.exe"
# What of WSRC the site would miss. Everything in DIST is built at its commit K, and only CORE's PE code is
# restaged, from B64's objects: those are at K too unless B64 is a DIST_B64 copy whose PE objects were remade
# and which says from what (B64/wine-commit, the full commit). Any other change between K and WSRC's HEAD
# (a Unix side, a module outside CORE, the server) is not in the site: dist fails on one, listing them, unless
# DIST_UNSTAGED_OK=1 (the caller puts those in itself). Uncommitted changes in WSRC always fail.
HEAD=$(git -C $WSRC rev-parse HEAD); BK=$(git -C $WSRC rev-parse $K)
[ -z "$(git -C $WSRC status --porcelain --untracked-files=no)" ] || { echo "dist: $WSRC has uncommitted changes"; git -C $WSRC status --short --untracked-files=no | head; exit 1; }
[ ! -f $B64/wine-commit ] || BK=$(git -C $WSRC rev-parse "$(cat $B64/wine-commit)")
coredirs=$(for m in $CORE; do b=${m%.*}; case $m in *.exe) echo programs/$b;; *.dll) echo dlls/$b;; *) echo dlls/$m;; esac; done)
miss=; stale=
for f in $(git -C $WSRC diff --name-only $K $HEAD); do
  # PE code: a core module's file that is not Unix-side (#pragma makedep unix); a header in a module with a
  # Unix side is both
  d=${f%/*}; pe= unix=1
  case " $(echo $coredirs) " in *" $d "*)
    case $f in
      *.c) grep -q '^#pragma makedep unix' <<< "$(git -C $WSRC show $HEAD:$f 2>/dev/null)" || { pe=1; unix=; };;
      *.h) pe=1; git -C $WSRC grep -q '^#pragma makedep unix' $HEAD -- "$d/*.c" || unix=;;
      *.rc|*.spec|*.idl|*.svg|*.ico|*.bmp|Makefile.in) pe=1; unix=;;
    esac;;
  esac
  [ -z "$pe" ] || [ -z "$(git -C $WSRC diff --name-only $BK $HEAD -- $f)" ] || stale="$stale $f"
  [ -z "$unix" ] || miss="$miss $f"
done
[ -z "$stale" ] || { echo "dist: $B64's PE objects are at $(git -C $WSRC rev-parse --short=12 $BK), not $WSRC's HEAD $(git -C $WSRC rev-parse --short=12 $HEAD): the restaged core would miss$(printf '\n  %s' $stale)"; echo "  (rebuild a copy of the tree from $WSRC, write the commit to its wine-commit and name it with DIST_B64)"; exit 1; }
if [ -n "$miss" ]; then
  echo "dist: changes since $DIST's commit $(printf %.12s $K) that the restaging does not reach (a Unix side, a module outside the core):$(printf '\n  %s' $miss)"
  [ "${DIST_UNSTAGED_OK:-}" = 1 ] || { echo "  (DIST_UNSTAGED_OK=1 when the caller puts them in itself)"; exit 1; }
fi
[ -z "${DIST_CHECK_ONLY:-}" ] || { echo "dist: check only, ok"; exit 0; }
mkdir -p w64; rm -rf w64/dist-prev w64/dist-s
if [ -d w64/dist ]; then mv w64/dist w64/dist-prev; [ ! -f w64/dist.env ] || mv w64/dist.env w64/dist-prev.env; fi
cp -a $DIST w64/dist; chmod -R u+w w64/dist
E=$WD_OUT/w64/pen-ea; rm -rf $E; mkdir -p $E/native work/tmp-dist
(cd $E && env GEX_WASM64_SYSROOT=$SR PELINK_EXPORT_ALL=1 TMPDIR=$WD_OUT/work/tmp-dist WINE64_SPLIT_DLLS="$(echo $(cat $P64/split.txt))" \
  systemd-run --user --scope -q -p MemoryMax=16G -p TasksMax=2048 nice -n 10 $GEX/wine/stage-native.sh $B64 $WSRC $E/native $CORE > stage.log 2> stage.err) \
  || { tail -5 $E/stage.err; exit 1; }
rm -rf work/tmp-dist
# skeletons and the file set must be the gate's; only the modules change
(cd $E/native && for f in *; do [ -e $P64/native/$f ] || { echo "dist: $f not in $P64"; exit 1; }; case $f in *.wasm) ;; *) cmp -s $f $P64/native/$f || { echo "dist: skeleton $f differs"; exit 1; };; esac; done)
ex() { wasm-objdump -x -j Export $1 | grep -o '"[^"]*"' | sort; }
lost=$(comm -23 <(ex $P64/native/winepe.wasm) <(ex $E/native/winepe.wasm) | wc -l)
[ $lost = 0 ] || { echo "dist: the restaged core lost $lost exports"; exit 1; }
echo "core exports: $(ex $P64/native/winepe.wasm | wc -l) -> $(ex $E/native/winepe.wasm | wc -l)"
cp -p $E/native/*.wasm w64/dist/lib/wine/x86_64-windows/
# a twin (dist64-...-twinM, M its memory64 core's key) carries its memory64 modules (NAME.wasm.m64, which a
# process with a 64-bit memory loads in NAME.wasm's place) in the install; its native dir (pen64-...-twinM)
# is what the audit reads them from
T64=
case $DIST in *-twin*)
  [ -n "$(ls w64/dist/lib/wine/x86_64-windows/*.wasm.m64 2>/dev/null)" ] || { echo "dist: $DIST is a twin without its memory64 modules (a wine/dist.sh before they went into the install)"; exit 1; }
  what="twin native dir"; T64=$(one $(ls -d $G/pen64-$K-${nk% *}-${DIST##*-} 2>/dev/null))
  echo "twin: $(ls w64/dist/lib/wine/x86_64-windows/*.wasm.m64 | wc -l) memory64 modules, native dir $(basename $T64)";;
esac
(cd w64/dist/lib/wine/x86_64-windows && { ls $E/native/*.wasm | sed 's#.*/##'; ls *.wasm.m64 2>/dev/null || true; } | nice -n 10 xargs -r -P8 -n 16 sh -c 'for f; do python3 "$0" "$f" "$f.s" && mv "$f.s" "$f" || exit 1; done' $GEX/toolchain/gexcc/windows/stripnames.py)
printf 'SOURCE=%s\nWINE_SRC=%s\nWINMD_DIR=%s/include\nNATIVE_DIR=%s/native:%s/native%s\nSTRIPNAMES=%s/toolchain/gexcc/windows/stripnames.py\nPREFIX=%s\n# x86-64 core restaged with PELINK_EXPORT_ALL=1 (%s)\n' \
  $DIST $WSRC $B64 $E $P32 "${T64:+:$T64}" $GEX $PFX $E > w64/dist.env
# Wine's raster fonts as the dist built them (fon-F, F the dist name's -fF): what the audit checks the
# dist's .fon files against
F=$(basename $DIST | sed -n 's/.*-wow64-f\([0-9a-f]*\)-.*/\1/p'); what="raster fonts fon-$F"
ln -sfn $(one $G/fon-$F/fon) w64/fon
echo "dist: w64/dist from $(basename $DIST)"
