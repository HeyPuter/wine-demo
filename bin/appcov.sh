#!/bin/bash
# appcov.sh REC [PORT]: the launcher apps' coverage, for a split site (bin/site.sh): an instrumented site from
# recording runs/REC (its bundle's pfx/dll-bases must have tools/dll-bases' pins; site.sh cov-REC "cold=instrument"), served on PORT (default 4382), and the sweep's run of each
# tools/app-images.tsv row's sweep row on it (tools/sweep/sweep.py, WD_SWEEP: its installs, starts and steps, such
# as IDLE's editor window and settings). Every function the run entered ([gex-cov] lines) is added to
# WD_OUT/coverage/apps.json, the functions earlier runs recorded kept. A site built after takes the launcher apps'
# units' coverage from it.
set -euo pipefail
. "$(dirname "$0")/../env.sh"; need_gex; S=$WD_OUT; cd $S
rec=${1:?REC} port=${2:-4382}; out=cov-$rec
: "${WD_SWEEP:?the sweep directory, for tools/sweep/sweep.py}"
SKIP_AUDIT=1 bash $WDR/bin/site.sh $rec $out cold=instrument
bash $WDR/bin/serve.sh $out $port
rows=$(grep -v '^#' $WDR/tools/app-images.tsv | awk -F'\t' 'NR > 1 && $5 != "" {print $5}' | sort -u)
pass=$out-$(date +%m%d%H%M)
# shellcheck disable=SC2086
(cd $WD_SWEEP && APPSWEEP_JOBS=1 PATH=$NODE_BIN:$PATH nice -n 5 python3 $WDR/tools/sweep/sweep.py "https://$SITE_HOST:$port/?desktop=1" $pass $rows)
mkdir -p coverage
python3 -I - coverage/apps.json $WD_SWEEP/runs/$pass $rows <<'PY'
import json, os, re, sys
out, d, rows = sys.argv[1], sys.argv[2], sys.argv[3:]
cov = {}
def add(k, r):
    s = cov.setdefault(k, set())
    for x in filter(None, r.split(',')):
        a, _, b = x.partition('-'); s.update(range(int(a), int(b or a) + 1))
if os.path.exists(out):
    for k, r in json.load(open(out)).items(): add(k, r)
n = 0
for row in rows:
    p = f'{d}/{row}/console.txt'
    if not os.path.exists(p): print(f'appcov: no {p}', file=sys.stderr); continue
    for l in open(p, errors='replace'):
        m = re.search(r'\[gex-cov\] ([0-9a-f]{64}) (\S+)', l)
        if m: add(m[1], m[2]); n += 1
def runs(v):
    o, v, i = [], sorted(v), 0
    while i < len(v):
        j = i
        while j + 1 < len(v) and v[j + 1] == v[j] + 1: j += 1
        o.append(str(v[i]) if i == j else f'{v[i]}-{v[j]}'); i = j + 1
    return ','.join(o)
json.dump({k: runs(v) for k, v in sorted(cov.items())}, open(out, 'w'), indent=1)
print(f'appcov: {n} [gex-cov] lines; {out}: {len(cov)} units, {sum(map(len, cov.values()))} functions')
PY
