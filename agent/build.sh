#!/bin/bash
# build.sh OUT: agent.exe from agent.c, reproducibly (no link timestamp), so the audit can rebuild it and
# compare: mkapps.sh puts it in the prefix, tools/audit.py checks the prefix's copy against a fresh build.
# GEXCC_WIN=DIR (a gexcc-win install): built with gexcc's Windows target, OUT plus its native module OUT.wasm
# (no x86 code to translate; GEX's stripnames.py strips its names, as the dist's modules'); unset, MinGW's
# x86-64 build (MINGW_CC), which the page runs on the JIT.
set -euo pipefail
cc=${MINGW_CC:-x86_64-w64-mingw32-gcc}
[ -z "${GEXCC_WIN:-}" ] || cc=$GEXCC_WIN/bin/x86_64-w64-mingw32-gcc
rm -f "$1.wasm"
$cc -municode -mwindows -O2 -Wl,--no-insert-timestamp -o "$1" "$(dirname "$0")/agent.c" -lwininet
rm -f "$1.wasm.undefined" "$1.wasm.stubs"
s=${GEX:+$GEX/toolchain/gexcc/windows/stripnames.py}
if [ -e "$1.wasm" ] && [ -n "$s" ]; then python3 -I "$s" "$1.wasm" "$1.wasm.s" && mv "$1.wasm.s" "$1.wasm"; fi
