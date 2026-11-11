# env.sh: every machine path, host and default the windemo scripts use, in one place. bin/* source it;
# env.local beside it (not in git; see env.local.example) sets any of them first and wins.
WDR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
[ -f "$WDR/env.local" ] && . "$WDR/env.local"
# The sandbox every input and output lives under. The bench host holds a copy of it (BENCH_ROOT) and
# sees a path under it at the same place relative to its root, so GEX, WD_OUT and this repo must be in it.
: "${SANDBOX:=$HOME/gex-sandbox}"
# Outputs (sites sW*, proj-*, page*, pre/, stage/, units/, runs/, logs/, work/, w64/) and the private or
# third-party inputs (APPS, TEST_APPS, DROPS): never in this repo.
: "${WD_OUT:=$SANDBOX/scratch/sites/windemo}"
# Scratch space on tmpfs (the audit's stripped copies). gexc cannot see /dev/shm: nothing a guest runs goes here.
: "${WD_HOT:=$SANDBOX/hot/wd}"
# A gex checkout (make GEX=...), and its x86 gexc once bin/runtime.sh has built it.
: "${GEX:=}"
: "${GEXC:=${GEX:+$GEX/target/x86/release/gexc}}"
# The gate's Wine builds: dists, wasm64 trees, native dirs, sysroots, prefixes (make DIST=... names one dist here).
: "${GATE_W64:=$SANDBOX/scratch/gate/w64}"
# WN's gexcc-built 7-Zip, Notepad++ and Dillo (a package.sh drop-in), and the recipe that builds it (make apps).
: "${APPS:=$WD_OUT/apps/wn3}"
: "${APPS_RECIPE:=$SANDBOX/apps}"
# The upstream downloads (test-apps.txt: make test-apps), and the files the smoke runs drop into the page.
: "${TEST_APPS:=$WD_OUT/test-apps}"
: "${DROPS:=$WD_OUT/drops}"
# The launcher's installers (tools/launcher.tsv: make installers), served beside the page. INSTALLERS= (empty)
# leaves them off the site, and the guest's agent downloads each from its own site.
: "${INSTALLERS=$WD_OUT/installers}"
# Toolchains: the userland env (cargo, sccache, node), node itself, mingw for tools/prt.
: "${TOOLCHAIN_ENV:=$SANDBOX/scratch/env.sh}"
: "${NODE_BIN:=$HOME/toolchains/node/bin}"
: "${MINGW_CC:=x86_64-w64-mingw32-gcc}"
# innoextract, for the icons of programs inside Inno Setup installers (tools/icons.py); empty: on PATH, or those
# tiles keep their installer's icon.
: "${INNOEXTRACT:=}"
# The bench box the recordings and smoke runs go to (bench.sh), its ssh login and where its copy of
# SANDBOX is, from that login's home.
: "${BENCH:=$SANDBOX/scratch/bench/bench.sh}"
: "${BENCH_HOST:=worldmachine}"
: "${BENCH_SSH:=velzie@worldmachine}"
: "${BENCH_ROOT:=src/noita-wasm}"
# Where a site is served (bin/serve.sh: a user unit windemo-PORT running SERVE_DIR's tools/serve-h2.mjs over
# TLS), as the bench box reaches it, and the server key's SPKI hash the smoke runs trust.
: "${SITE_HOST:=100.64.0.3}"
: "${PORT:=4387}"
: "${SERVE_DIR:=$SANDBOX/scratch/HL}"
: "${SPKI:=kdN8wUUfVJkOdtI4Fx/Vq9S/uSMrieV3Ulu1UoEAA54=}"
# Wine's FreeType headers for tools' sfnt2fon (bin/mkfon.sh); empty: the gate's first deps64 tree.
: "${FREETYPE_INC:=}"
# The Start menu's Programs rows the checks click (x 170), NAME:Y, as the Wine in the dist lays them out
# (its menu sits on the taskbar's top edge; a Wine before the shell's work-area fix had them at
# con:608 fm:627 dillo:646 np:665 putty:684).
: "${MENU_ROWS:=con:539 fm:557 dillo:575 np:593 putty:611}"
export WDR SANDBOX WD_OUT WD_HOT GEX GEXC GATE_W64 APPS APPS_RECIPE TEST_APPS DROPS INSTALLERS TOOLCHAIN_ENV NODE_BIN MINGW_CC INNOEXTRACT \
  BENCH BENCH_HOST BENCH_SSH BENCH_ROOT SITE_HOST PORT SERVE_DIR SPKI FREETYPE_INC MENU_ROWS
URL=https://$SITE_HOST:$PORT/
# rel PATH: PATH (under SANDBOX) as the bench host's commands name it, from its copy's root.
rel() { realpath -m --relative-to="$SANDBOX" "$1"; }
# row NAME: the y of NAME's row in the Programs menu (MENU_ROWS)
row() { local a; for a in $MENU_ROWS; do [ "${a%%:*}" = "$1" ] && { echo "${a#*:}"; return; }; done; echo "no menu row for $1" >&2; exit 2; }
need_gex() { [ -n "$GEX" ] && [ -d "$GEX/hosts" ] || { echo "${0##*/}: set GEX to a gex checkout" >&2; exit 2; }; }
mkdir -p "$WD_OUT/logs"
