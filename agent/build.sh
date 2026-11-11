#!/bin/bash
# build.sh OUT: agent.exe from agent.c, reproducibly (no link timestamp), so the audit can rebuild it and
# compare: mkapps.sh puts it in the prefix, tools/audit.py checks the prefix's copy against a fresh build.
set -euo pipefail
exec ${MINGW_CC:-x86_64-w64-mingw32-gcc} -municode -mwindows -O2 -Wl,--no-insert-timestamp -o "$1" "$(dirname "$0")/agent.c" -lwininet
