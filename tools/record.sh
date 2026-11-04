#!/bin/bash
# record.sh TAG URL SETTLE: on the bench box (bin/q-record.sh), GEX_EJECT's record-wine32.mjs against URL (the pre
# page); out in rec-TAG/ here. BUNDLE: the pre bundle's path on the build machine, where the eject reads it.
T=$(cd "$(dirname "$0")" && pwd); tag=$1 url=$2 settle=$3
o=$T/rec-$tag; rm -rf $o; mkdir -p $o
node ${GEX_EJECT:?}/record-wine32.mjs "$url" $o --chrome $T/chrome-tls.sh --title "${TITLE:-Wine File Manager}" --settle $settle --timeout ${TMO:-600} \
  --bundle "${BUNDLE:?}" --boot-units-out $o/boot-units.txt --boot-after $settle --console $o/console.txt > $o.txt 2>&1
echo "rc=$?" >> $o.txt; tail -4 $o.txt
