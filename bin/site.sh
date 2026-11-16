#!/bin/bash
# site.sh REC OUT [KEY=VALUE...]: the site from recording runs/REC: gexc eject into proj-OUT, user/eject.json's
# settings: strip+skip, the site's default (KEY=VALUE overrides, e.g. helpers=keep wineboot=run), ./build.sh, eject-site.mjs into OUT.
# nt.json keeps `identities` (a compact process takes only its own flavour's); DROP_IDS=1 drops them.
# REST_ORDER=FILE (default tools/rest-order-all.txt): guest paths read together, first in the rest bundle (eject-site --rest-order).
# Units of images not in tools/boot-units.txt go in the background fill (BOOT_UNITS= : all at boot).
# LAUNCHER=FILE: the launcher's list from FILE instead of tools/launcher.tsv (a local site's own tiles); credits.html
# still lists only tools/launcher.tsv's.
# Outputs: WD_OUT/proj-OUT, WD_OUT/OUT.
set -euo pipefail
. "$(dirname "$0")/../env.sh"; need_gex; S=$WD_OUT; W=$GEX; cd $S
[ -z "${KEEP_NAMES:-}" ] || export GEX_KEEP_NAMES=1
export PATH=$NODE_BIN:$PATH; REST_ORDER=${REST_ORDER-$WDR/tools/rest-order-all.txt}
rec=$1 out=$2; shift 2; P=proj-$out; LAUNCHER=$(realpath "${LAUNCHER:-$WDR/tools/launcher.tsv}")
rm -rf $P $out
# The recording as the site uses it: a copy (runs/.site-OUT) whose session also has
#  - the launcher apps' pinned images' units (tools/dll-bases' /pfx lines, bin/appimg.sh, bin/units.sh): no
#    recording runs those apps, so they are added (the compact flavour units.sh built);
#  - their coverage, from WD_OUT/coverage/apps.json (bin/appcov.sh: an instrumented site's runs of them), so a
#    split ("cold": a clustering, the default chunk:256) ships what their starts ran up front and the rest on demand;
#  - with a split, every other unit's every slot: a unit the coverage does not name stays whole (the eject would
#    make it all cold).
cold=chunk:256; for kv in "$@"; do case $kv in cold=*) cold=${kv#cold=};; esac; done
rm -rf runs/.site-$out; mkdir -p runs/.site-$out; cp -a runs/$rec/. runs/.site-$out/; rec=.site-$out
python3 -I - runs/$rec/wine32-session.json $WDR/tools/dll-bases "$cold" <<'PY'
import glob, json, os, re, sys
p, bases, cold = sys.argv[1:4]; s = json.load(open(p)); have = {u['key'] for u in s['units']}; n = 0; app = set()
for l in open(bases):
    if l.startswith('#') or not l.strip(): continue
    a, path = l.split(None, 1); path = path.strip()
    if not path.startswith('/pfx/drive_c/'): continue
    base = hex(int(a, 16)); log = f"logs/units/{os.path.basename(path)}-{base}-compact.log"
    m = os.path.exists(log) and re.search(r' at ' + base + r': .*/([0-9a-f]{64})/c\.wasm', open(log).read())
    if not m: print(f"site: no unit for {path} at {base} ({log})", file=sys.stderr); continue
    app.add(m.group(1))
    if m.group(1) in have: continue
    s['units'].append({'key': m.group(1), 'path': '/pfx/dosdevices/c:/' + path[len('/pfx/drive_c/'):], 'at': 0, 'base': base}); n += 1
if n: print(f"site: {n} launcher app units added")
cov = s.setdefault('coverage', {}) or {}
if os.path.exists('coverage/apps.json'):
    for k, r in json.load(open('coverage/apps.json')).items():
        if k in app: cov[k] = r
if cold not in ('none', 'instrument'):
    split = sum(k in cov for k in app); whole = 0
    for u in s['units']:
        if u['key'] in cov: continue
        e = f"units/{u['key']}/c.entries"
        if os.path.exists(e): cov[u['key']] = f"0-{os.path.getsize(e) // 8 - 1}"; whole += 1
    print(f"site: cold {cold}: {split} launcher app units split by their coverage, {whole} other units whole")
s['coverage'] = cov
json.dump(s, open(p, 'w'), indent=2)
PY
nice -n 10 $GEXC eject runs/$rec --out $P --web-src $W/page --unit-cache units > logs/eject-$out.log 2>&1
python3 -I - $P/user/eject.json "$@" <<'PY'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
# GL kept (Wine's Direct3D is wined3d on GL): Mesa is started by the first process that opens opengl32
# (nt.json gl_lazy), never on the way to the desktop.
d['features'].update(gl=True, translation=True)
d.update(bundle='split', cold='chunk:256', resources='trim', helpers='strip', wineboot='skip', desktop='explorer')
for kv in sys.argv[2:]:
    k, v = kv.split('=', 1)
    if k.startswith('features.'): d['features'][k[9:]] = v == 'true'  # features.gl=false
    else: d[k] = v
json.dump(d, open(p, 'w'), indent=2)
PY
# The desktop behind the windows: the scheme's Background colour (user.reg's Control Panel\Colors).
python3 -I - runs/$rec/wine32-session.json $WDR/tools/index.html $P/user/index.html $LAUNCHER <<'PY'
import json, re, sys, tarfile
bundle = json.load(open(sys.argv[1])).get('bundle')
reg = ''
if bundle:
    with tarfile.open(bundle) as t:
        try: reg = t.extractfile('pfx/user.reg').read().decode('utf-8', 'replace')
        except KeyError: pass
def key(name):
    m = re.search(r'^\[' + re.escape(name) + r'\][^\n]*\n(.*?)(?=^\[|\Z)', reg, re.M | re.S)
    return m.group(1) if m else ''
colour = 'null'
m = re.search(r'^"Background"="(\d+) (\d+) (\d+)"', key(r'Control Panel\\Colors'), re.M)
if m: colour = "'#%02x%02x%02x'" % tuple(int(v) for v in m.groups())
page = open(sys.argv[2]).read()
assert 'const DESKTOP_COLOUR = null;' in page
# The launcher's installers (tools/launcher.tsv), as the page's APPS.
apps = []
for l in open(sys.argv[4], encoding='utf-8'):
    if l.startswith('#') or not l.strip(): continue
    f = l.rstrip('\n').split('\t')
    if f[0] == 'id': keys = f; continue
    a = dict(zip(keys, f)); a['bytes'] = int(a['bytes'] or 0)
    # the silent install line is the sweep's; a tile runs the installer as a visitor would (agent/agent.c)
    for k in ('install', 'okrc', 'sha256', 'icon'): a.pop(k, None)
    apps.append(a)
assert 'const APPS = null;' in page
page = page.replace('const DESKTOP_COLOUR = null;', f'const DESKTOP_COLOUR = {colour};', 1)
page = page.replace('const APPS = null;', 'const APPS = ' + json.dumps(apps, ensure_ascii=False).replace('</', '<\\/') + ';', 1)
open(sys.argv[3], 'w').write(page)
PY
(cd $P && nice -n 10 ./build.sh) > logs/build-$out.log 2>&1
nice -n 10 node $W/site/eject-site.mjs $P $out --title "Wine desktop" --strip --prune --dedupe --pieces ${REST_ORDER:+--rest-order $REST_ORDER} ${BOOT_UNITS---boot-units $WDR/tools/boot-units.txt} > logs/site-$out.log 2>&1
# The tiles' icons (tools/icons.py, at icons/ID.png): the desktop's, each launcher app's from its installer
# (or the program inside it the launcher.tsv row names), and the drop picker's generic program icon; the
# page's ICONS lists the ones made.
d=w64/dist/lib/wine/x86_64-windows
specs=(desktop=$d/shell32.dll#16 exe=$d/shell32.dll#3)
if [ -n "${INSTALLERS:-}" ]; then
  while IFS=$'\t' read -r id f m; do specs+=("$id=$INSTALLERS/$f${m:+::$m}"); done < <(grep -v '^#' $LAUNCHER |
    awk -F'\t' '$1 == "id" { for (i = 1; i <= NF; i++) c[$i] = i; next } $c["file"] != "" { print $1 "\t" $c["file"] "\t" $c["icon"] }')
fi
python3 -I $WDR/tools/icons.py $out/icons "${specs[@]}" > logs/icons-$out.txt 2> logs/icons-$out.err
ids=$(paste -sd, logs/icons-$out.txt); sed -i "s|const ICONS = null;|const ICONS = '$ids'.split(',');|" $out/index.html
# The credits page: each launcher installer's licence and source (tools/credits.py).
python3 -I $WDR/tools/credits.py $WDR/tools/launcher.tsv $out/credits.html
# INSTALLERS=DIR: the launcher's installers (tools/launcher.tsv's files, from DIR) beside the page, at
# installers/FILE, which the page fetches itself; a missing one the guest's agent downloads from its site.
if [ -n "${INSTALLERS:-}" ]; then
  mkdir -p $out/installers
  awk -F'\t' '!/^#/ && $1 != "id" && NF > 5 && $6 != "" { print $6 }' $LAUNCHER | while read -r f; do
    [ -f "$INSTALLERS/$f" ] || { echo "site: no $INSTALLERS/$f (make installers)"; exit 1; }
    ln -f "$INSTALLERS/$f" $out/installers/ 2>/dev/null || cp "$INSTALLERS/$f" $out/installers/
  done
fi
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
