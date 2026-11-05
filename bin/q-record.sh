#!/bin/bash
# q-record.sh TAG URL SETTLE: tools/record.sh (GEX's record-wine32.mjs) on the bench box through bench.sh (check
# class) against URL, the pre page; rec-TAG/ and rec-TAG.txt back into WD_OUT/runs/. TITLE, TMO pass through.
. "$(dirname "$0")/../env.sh"; need_gex; T=$WDR/tools; t=$1 u=$2 s=$3
cd "$SANDBOX"
BENCH_HOST=$BENCH_HOST BENCH_CLASS=check BENCH_TIMEOUT=1500 "$BENCH" -s "$T" -s "$GEX/site" -s "$GEX/test/lib" -- \
  env GEX_EJECT="$(rel "$GEX/site")" BUNDLE="$WD_OUT/pre/bundle.tar" TITLE="${TITLE:-}" TMO="${TMO:-}" \
  bash "$(rel "$T")/record.sh" $t $u $s > $WD_OUT/logs/rec-$t.txt 2>&1
R=$BENCH_ROOT/$(rel "$T"); mkdir -p $WD_OUT/runs
rsync -a $BENCH_SSH:$R/rec-$t $BENCH_SSH:$R/rec-$t.txt $WD_OUT/runs/
ssh $BENCH_SSH "rm -rf $R/rec-$t $R/rec-$t.txt"
echo synced >> $WD_OUT/logs/rec-$t.txt
