#!/bin/bash
# sweep.sh TAG SECS KEYS [ENV...]: one sweep run against URL (env.sh; q-smoke.sh, tag sw-TAG), the guest's
# opened files at the end. Programs menu rows: env.sh MENU_ROWS (row NAME).
. "$(dirname "$0")/../env.sh"; S=$WD_OUT; t=${1:?TAG} secs=${2:?SECS} k=${3:?KEYS}; shift 3
E=$(printf '%s' '(async () => await __ntOpened())()' | base64 -w0)
bash "$WDR/bin/q-smoke.sh" sw-$t $URL $secs 2 SMOKE_SPKI=$SPKI SMOKE_PRELOAD_FILE=./start-preload.js SMOKE_OUT_W=1300 SMOKE_OUT_H=713 \
  "SMOKE_KEYS=$k" SMOKE_EVAL_AT=$((secs - 3)) SMOKE_EVAL_AT_B64=$E "$@" > /dev/null 2>&1
o=$S/runs/out-sw-$t
echo "== $t: $(grep -ac threw $o/console.txt) traps; $(grep -a '\[wins\]' $o/console.txt | tail -n1 | tr '|' '\n' | grep -o '"[^"]*"' | grep -v '""' | sort -u | tr '\n' ' ')"
grep -a 'smoke-eval@' $S/runs/out-sw-$t.txt | cut -c1-600
grep -a 'threw\|gex-console-error' $o/console.txt | grep -v 'native wasm32 module for' | cut -c1-200 | sort | uniq -c | sort -rn | head -8
