#!/bin/bash
# pipeline.sh TAG SITE: pre/ served on PORT, recorded twice (rec-TAGa, the units between, rec-TAGb), the
# site SITE from rec-TAGb (site.sh), then SITE served on PORT. Run after runtime, dist, apps and bundle.
set -u; . "$(dirname "$0")/../env.sh"; need_gex; B=$WDR/bin; cd "$WD_OUT"
t=${1:?TAG} out=${2:?SITE}
rm -rf pre/assets pre/gex pre/vendor; cp -a page/app.mjs page/assets page/gex page/vendor pre/; cp $WDR/tools/pre-index.html pre/index.html; mkdir -p units; [ -e pre/cgen ] || ln -s ../units pre/cgen
$B/serve.sh pre
TITLE=Desktop timeout 2400 $B/q-record.sh ${t}a $URL 20; grep -a 'wine32-session.json\|rc=' logs/rec-${t}a.txt | cut -c1-250
$B/units.sh rec-${t}a 2>&1 | tail -2
TITLE=Desktop timeout 2400 $B/q-record.sh ${t}b $URL 20; grep -a 'wine32-session.json\|rc=' logs/rec-${t}b.txt | cut -c1-250
grep -aq 'rc=0' logs/rec-${t}b.txt || { echo "pipeline: the second recording failed (logs/rec-${t}b.txt)"; exit 1; }
$B/site.sh rec-${t}b $out > logs/site-$out.out 2>&1 || { tail -3 logs/site-$out.out; echo "pipeline: site.sh failed"; exit 1; }
tail -1 logs/site-$out.out | cut -c1-300
$B/serve.sh $out
