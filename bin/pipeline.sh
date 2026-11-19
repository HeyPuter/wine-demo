#!/bin/bash
# pipeline.sh TAG SITE: pre/ served on PORT, recorded twice (rec-TAGa, the units between, rec-TAGb), the
# site SITE from rec-TAGb (site.sh), then SITE served on PORT and loaded once through its own index.html (it must
# reach the desktop). Run after runtime, dist, apps and bundle. No timeout around q-record.sh: its bench.sh waits
# for the bench box's lock, and BENCH_TIMEOUT bounds the run itself.
set -u; . "$(dirname "$0")/../env.sh"; need_gex; B=$WDR/bin; cd "$WD_OUT"
t=${1:?TAG} out=${2:?SITE}
# pre/: the plain bundle (bundle.tar) on the site's loader and the runtime package (bin/runtime.sh's rt/), the
# zstd decoder (bin/runtime.sh's vendor/) beside them, and tools/pre-index.html, which record.mjs reads.
[ -f rt/index.mjs ] || { echo "pipeline: no runtime package at $WD_OUT/rt (bin/runtime.sh)"; exit 1; }
rm -rf pre/app.mjs pre/assets pre/gex pre/vendor pre/rt pre/site pre/cgen; cp -a vendor pre/; cp -al rt pre/rt 2>/dev/null || cp -a rt pre/rt
mkdir -p pre/site; cp $WDR/site/windemo.mjs $WDR/site/lazy-source.mjs pre/site/; cp $WDR/tools/pre-index.html pre/index.html
$B/serve.sh pre
TITLE=^Desktop$ $B/q-record.sh ${t}a $URL 20; grep -a 'wine32-session.json\|rc=' logs/rec-${t}a.txt | cut -c1-250
$B/units.sh rec-${t}a 2>&1 | tail -2
TITLE=^Desktop$ $B/q-record.sh ${t}b $URL 20; grep -a 'wine32-session.json\|rc=' logs/rec-${t}b.txt | cut -c1-250
grep -aq 'rc=0' logs/rec-${t}b.txt || { echo "pipeline: the second recording failed (logs/rec-${t}b.txt)"; exit 1; }
$B/site.sh rec-${t}b $out > logs/site-$out.out 2>&1 || { tail -3 logs/site-$out.out; echo "pipeline: site.sh failed"; exit 1; }
tail -1 logs/site-$out.out | cut -c1-300
# site.sh asks for GL; a GEX page without Mesa's replay (ports/mesa/build.sh) builds without it, and then
# every Direct3D and OpenGL program fails on the site
case $(tail -1 logs/site-$out.out) in *"features off: "*gl[,\;]*) echo "pipeline: $out has no GL: GEX's page has no Mesa (make runtime, or GEX's page/build.sh --mp --gl-only; logs/build-$out.log)"; exit 1;; esac
$B/serve.sh $out
# The site as a visitor loads it (its own index.html, whose start() options pre/'s page never passes): the
# desktop (its taskbar, behind the launcher) must come up, or the pipeline fails (a page that reports Failed never
# gets there).
bash $B/q-smoke.sh site-$t $URL 150 30 SMOKE_PRELOAD_FILE=./ttd-preload.js > /dev/null 2>&1
r=$(python3 -I $WDR/tools/ttd.py runs/out-site-$t 2>&1); echo "site check: $r" | cut -c1-300
case $r in *"taskbar "[0-9]*) ;; *)
  grep -aho 'start([^)]*)[^"]*' runs/out-site-$t/console.txt 2>/dev/null | head -2
  echo "pipeline: the site at $URL did not reach its desktop (runs/out-site-$t)"; exit 1;; esac
