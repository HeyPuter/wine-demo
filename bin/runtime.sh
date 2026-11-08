#!/bin/bash
# runtime.sh: the runtime from GEX: x86 gexc, the kernel, the browser shim (shared and memory64), Mesa, then the
# eject page library into WD_OUT/page (a release page: GEX's build-eject-page.sh strips the shims' names and
# DWARF; KEEP_NAMES=1 keeps them, as GEX_KEEP_NAMES=1).
# Waits while two cargo builds run (any agent's); niced.
set -e; . "$(dirname "$0")/../env.sh"; need_gex; . "$TOOLCHAIN_ENV"
cd "$GEX"; L=$WD_OUT/logs; mkdir -p page/public/gex
[ -e page/node_modules ] || { echo "runtime: $GEX/page/node_modules is missing (npm ci in page/, or link another tree's)"; exit 1; }
slot() { while [ "$(ps -eo args | grep -cE "^$HOME/.rustup/toolchains/[^ ]*/bin/cargo (build|test)|^(/bin/)?sh [^ ]*ports/mesa/build.sh")" -ge 2 ]; do sleep 10; done; }
run() { systemd-run --user --scope -q -p TasksMax=4096 -p MemoryMax=32G nice -n 19 "$@"; }
slot; run cargo build --release -p gexc --features gex-kernel/x86,gex-xlate/x86,gexc/x86,gex-native/x86 --target-dir target/x86 > $L/gexc.log 2>&1
slot; GEX_ARCH=x86 run sh hosts/kernel/build.sh > $L/kernel.log 2>&1
slot; GEX_SHARED=1 GEX_ARCH=x86 run sh hosts/browser/build.sh > $L/browser.log 2>&1
slot; GEX_MEM64=1 GEX_SHARED=1 GEX_ARCH=x86 run sh hosts/browser/build.sh > $L/browser-m64.log 2>&1
# The page's OpenGL, Mesa (gex-wgpu-replay.{js,wasm}): GEX's page/build.sh --gl-only, which keeps a build
# whose inputs are unchanged (its cache, GEX's target/web-build, is per checkout). Without it
# build-eject-page.sh makes a page with no GL, and every Direct3D and OpenGL program fails on the site.
[ -e third_party/mesa/meson.build ] || git submodule update --init third_party/mesa > $L/mesa.log 2>&1
slot; run sh page/build.sh --mp --gl-only >> $L/mesa.log 2>&1 ||
  { tail -5 $L/mesa.log; echo "runtime: Mesa failed (GEX's page/build.sh --mp --gl-only): $L/mesa.log"; exit 1; }
[ -z "${KEEP_NAMES:-}" ] || export GEX_KEEP_NAMES=1
rm -rf "$WD_OUT/page"; run sh site/build-eject-page.sh "$WD_OUT/page" > $L/page.log 2>&1
echo "runtime: $WD_OUT/page from $(git -C "$GEX" log --oneline -1 | cut -c1-80)"
