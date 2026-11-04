#!/bin/bash
# smoke.sh TAG URL SECS [STEP]: on the bench box (bin/q-smoke.sh), headless Chromium runs URL, a screenshot every
# STEP s into out-TAG/ here. SMOKE_* pass through; in SMOKE_DROP, @ is SMOKE_DROPS (default this directory).
T=$(cd "$(dirname "$0")" && pwd); tag=$1 url=$2 secs=$3 step=${4:-15}
D=$(cd "${SMOKE_DROPS:-$T}" 2>/dev/null && pwd || echo "$T")
[ -n "${SMOKE_DROP:-}" ] && export SMOKE_DROP=${SMOKE_DROP//@/$D}
o=$T/out-$tag; rm -rf $o; mkdir -p $o
SMOKE_GPU=1 SMOKE_WORKERS=1 timeout $((secs + 120)) node $T/smoke.mjs "$url" $secs $o $step > $o.txt 2>&1
[ -f $o/chrome.pid ] && cp=$(cat $o/chrome.pid) && kill -0 $cp 2>/dev/null && kill -9 $cp
rm -rf $o/profile
tail -3 $o.txt
