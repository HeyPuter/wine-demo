#!/bin/bash
# site.sh REC OUT [KEY=VALUE...]: the site from recording runs/REC: gexc eject into proj-OUT, user/eject.json's
# settings: strip+skip, the site's default (KEY=VALUE overrides, e.g. helpers=keep wineboot=run), ./build.sh, eject-site.mjs into OUT.
# nt.json keeps `identities` (a compact process takes only its own flavour's); DROP_IDS=1 drops them.
# REST_ORDER=FILE (default tools/rest-order-all.txt): guest paths read together, first in the rest bundle (eject-site --rest-order).
# Units of images not in tools/boot-units.txt go in the background fill (BOOT_UNITS= : all at boot).
# Outputs: WD_OUT/proj-OUT, WD_OUT/OUT.
set -euo pipefail
. "$(dirname "$0")/../env.sh"; need_gex; S=$WD_OUT; W=$GEX; cd $S
export PATH=$NODE_BIN:$PATH; REST_ORDER=${REST_ORDER-$WDR/tools/rest-order-all.txt}
rec=$1 out=$2; shift 2; P=proj-$out
rm -rf $P $out
nice -n 10 $GEXC eject runs/$rec --out $P --web-src $W/web --unit-cache units > logs/eject-$out.log 2>&1
python3 -I - $P/user/eject.json "$@" <<'PY'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
d['features'].update(gl=False, translation=True)
d.update(bundle='split', cold='none', resources='trim', helpers='strip', wineboot='skip', desktop='explorer')
for kv in sys.argv[2:]:
    k, v = kv.split('=', 1); d[k] = v
json.dump(d, open(p, 'w'), indent=2)
PY
cp $WDR/tools/index.html $P/user/index.html
(cd $P && nice -n 10 ./build.sh) > logs/build-$out.log 2>&1
nice -n 10 node $W/web/eject-site.mjs $P $out --title "Wine desktop" --strip --prune --dedupe --pieces ${REST_ORDER:+--rest-order $REST_ORDER} ${BOOT_UNITS---boot-units $WDR/tools/boot-units.txt} > logs/site-$out.log 2>&1
python3 -I - $out/project/build/web/nt.json <<'PY'
import json, os, sys
p = sys.argv[1]; d = json.load(open(p))
if os.environ.get('DROP_IDS') == '1': d.get('params', {}).pop('identities', None)
d['env'] = [e for e in d.get('env', []) if not e.startswith('WINEGEX_RECORD_HARDWARE=')]
os.unlink(p); json.dump(d, open(p, 'w'))
PY
# SKIP_AUDIT=1: a test site only (its stage is not the one audited), never one to serve
if [ -z "${SKIP_AUDIT:-}" ]; then
python3 -I $WDR/tools/audit.py > logs/audit-$out.log || { tail -20 logs/audit-$out.log; echo 'site: the audit failed'; exit 1; }
tail -1 logs/audit-$out.log
fi
tail -1 logs/site-$out.log
