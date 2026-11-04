#!/bin/bash
# q-smoke.sh TAG URL SECS STEP [ENV...]: tools/smoke.sh on the bench box through bench.sh (check class), DROPS
# synced beside it (SMOKE_DROP's @); out-TAG/ and out-TAG.txt back into WD_OUT/runs/.
. "$(dirname "$0")/../env.sh"; T=$WDR/tools; t=$1 u=$2 s=$3 st=$4; shift 4
sync=(-s "$T"); [ ! -d "$DROPS" ] || sync+=(-s "$DROPS")
cd "$SANDBOX"
BENCH_HOST=$BENCH_HOST BENCH_CLASS=check BENCH_TIMEOUT=$((s + 600)) "$BENCH" "${sync[@]}" -- \
  env SMOKE_DROPS="$(rel "$DROPS")" "$@" bash "$(rel "$T")/smoke.sh" $t $u $s $st > $WD_OUT/logs/smoke-$t.txt 2>&1
R=$BENCH_ROOT/$(rel "$T"); mkdir -p $WD_OUT/runs
rsync -a $BENCH_SSH:$R/out-$t $BENCH_SSH:$R/out-$t.txt $WD_OUT/runs/
ssh $BENCH_SSH "rm -rf $R/out-$t $R/out-$t.txt"
echo synced >> $WD_OUT/logs/smoke-$t.txt
