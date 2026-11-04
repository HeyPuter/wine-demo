#!/bin/bash
# runtime.sh: the runtime from GEX: x86 gexc, the kernel, the browser shim (shared and memory64), then the
# eject page library into WD_OUT/page. Waits while two cargo builds run (any agent's); niced.
set -e; . "$(dirname "$0")/../env.sh"; need_gex; . "$TOOLCHAIN_ENV"
cd "$GEX"; L=$WD_OUT/logs; mkdir -p web/public/gex
[ -e web/node_modules ] || { echo "runtime: $GEX/web/node_modules is missing (npm ci in web/, or link another tree's)"; exit 1; }
slot() { while [ "$(ps -eo args | grep -cE "^$HOME/.rustup/toolchains/[^ ]*/bin/cargo (build|test)")" -ge 2 ]; do sleep 10; done; }
run() { systemd-run --user --scope -q -p TasksMax=4096 -p MemoryMax=32G nice -n 19 "$@"; }
slot; run cargo build --release -p gexc --features gex-kernel/x86,gex-xlate/x86,gexc/x86,gex-native/x86 --target-dir target/x86 > $L/gexc.log 2>&1
slot; GEX_ARCH=x86 run sh shims/kernel/build.sh > $L/kernel.log 2>&1
slot; GEX_SHARED=1 GEX_ARCH=x86 run sh shims/browser/build.sh > $L/browser.log 2>&1
slot; GEX_MEM64=1 GEX_SHARED=1 GEX_ARCH=x86 run sh shims/browser/build.sh > $L/browser-m64.log 2>&1
rm -rf "$WD_OUT/page"; run sh web/build-eject-page.sh "$WD_OUT/page" > $L/page.log 2>&1
cp web/public/gex/gex_browser.x86.m64.shared.wasm web/public/gex/seed.x86.m64.shared.wasm "$WD_OUT/page/gex/"
echo "runtime: $WD_OUT/page from $(git -C "$GEX" log --oneline -1 | cut -c1-80)"
