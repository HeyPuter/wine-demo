#!/bin/bash
# apps.sh: APPS rebuilt by WN's recipe (APPS_RECIPE, the sandbox's apps/: build-all.sh fetches and builds
# 7-Zip, Dillo and Notepad++ with gexcc's Windows target, package.sh lays out the drop-in). Needs GEXCC_WIN
# (a gexcc-win install: GEX's tools/gexcc/windows/install.sh, and build-cxx-win.sh for C++) and LLVM_SRC (the
# LLVM tree its libc++ came from, for the licenses); see APPS_RECIPE/common.sh. Long: run it when the apps change.
set -euo pipefail; . "$(dirname "$0")/../env.sh"
: "${GEXCC_WIN:?set GEXCC_WIN to a gexcc-win install}" "${LLVM_SRC:?set LLVM_SRC (APPS_RECIPE/package.sh)}"
export GEXCC_WIN LLVM_SRC
nice -n 10 "$APPS_RECIPE/build-all.sh"
"$APPS_RECIPE/package.sh" "$APPS.new"
rm -rf "${APPS:?}"; mv "$APPS.new" "$APPS"
(cd "$APPS" && sha256sum -c --quiet SHA256SUMS) && echo "apps: $APPS"
