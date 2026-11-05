#!/bin/bash
# dist.sh DIST: WD_OUT/w64/dist from the gate's native-i386 WoW64 dist DIST (GATE_W64/dist64-K-...-wow64-...-nN64-N32-sS),
# its x86-64 core restaged with PELINK_EXPORT_ALL=1 (gexcc-win apps import kernel32/ucrtbase names the gate's
# core leaves out) by GEX's stage-native64.sh, and w64/dist.env (what the audit and mkapps read). The dist
# that was there becomes w64/dist-prev. Also finds the WoW64 prefix stamped for DIST's wine.inf (w64/prefix).
set -euo pipefail; . "$(dirname "$0")/../env.sh"; need_gex
DIST=$(realpath "${1:?DIST}"); G=$GATE_W64; cd "$WD_OUT"
K=$(basename "$DIST" | sed -n 's/^dist64-\([0-9a-f]\{12\}\)-.*-wow64-.*-n[0-9a-f]*-[0-9a-f]*-s[0-9a-f]*$/\1/p')
[ -n "$K" ] || { echo "dist: $DIST is not a native-i386 WoW64 dist (dist64-K-...-wow64-...-nN64-N32-sS)"; exit 1; }
one() { [ $# = 1 ] && [ -e "$1" ] || { echo "dist: want one $what, got: $*" >&2; exit 1; }; echo "$1"; }
what="wasm64 wow64 tree"; B64=$(one $(ls -d $G/b64-$K-*-wow64 2>/dev/null))
nk=$(basename $DIST | sed 's/.*-n\([0-9a-f]*\)-\([0-9a-f]*\)-s[0-9a-f]*$/\1 \2/')
what="x86-64 native dir"; P64=$(one $(ls -d $G/pen64-$K-${nk% *} 2>/dev/null))
what="i386 native dir"; P32=$(one $(ls -d $G/pen32-$K-${nk#* } 2>/dev/null))
what="sysroot"; SR=$(one $(grep -o "/[^ ]*/sr64-[0-9a-f-]*" $P64.log | sort -u))/sysroot
stamp=$(stat -c %Y $DIST/share/wine/wine.inf)
what="WoW64 prefix stamped $stamp"; PFX=$(one $(for p in $G/pfs64-*-wow64-*/pfx; do [ "$(tr -d "\r\n" < $p/.update-timestamp 2>/dev/null)" = "$stamp" ] && echo $p; done))
WSRC=$(sed -n 's/^srcdir = //p' $B64/Makefile)
printf 'dist %s\nb64 %s\npen64 %s\npen32 %s\nsysroot %s\nprefix %s\nwine src %s (%s)\n' $DIST $B64 $P64 $P32 $SR $PFX $WSRC "$(git -C $WSRC log --oneline -1 | cut -c1-70)"
CORE="ntdll.dll kernelbase.dll kernel32.dll msvcrt.dll ucrtbase.dll winewayland.drv wow64.dll wow64win.dll wow64cpu.dll wineboot.exe services.exe explorer.exe"
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
(cd w64/dist/lib/wine/x86_64-windows && ls $E/native/*.wasm | sed 's#.*/##' | nice -n 10 xargs -r -P8 -n 16 sh -c 'for f; do python3 "$0" "$f" "$f.s" && mv "$f.s" "$f" || exit 1; done' $GEX/toolchain/gexcc/windows/stripnames.py)
printf 'SOURCE=%s\nWINE_SRC=%s\nWINMD_DIR=%s/include\nNATIVE_DIR=%s/native:%s/native\nSTRIPNAMES=%s/toolchain/gexcc/windows/stripnames.py\nPREFIX=%s\n# x86-64 core restaged with PELINK_EXPORT_ALL=1 (%s)\n' \
  $DIST $WSRC $B64 $E $P32 $GEX $PFX $E > w64/dist.env
echo "dist: w64/dist from $(basename $DIST)"
