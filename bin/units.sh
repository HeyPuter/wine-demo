#!/bin/bash
# units.sh [REC...]: function-tier units into units/ for every pinned DLL (WDR/tools/dll-bases) and every image the
# recordings missed (unit_misses), at the base it loaded at, and the 64-bit NT trampolines. Both flavours: Wine's
# compact-space processes (explorer, cmd, ... in the browser) ask for --wine64-compact units, the others for plain ones.
# Three images at a time, 8 jobs each, niced.
. "$(dirname "$0")/../env.sh"; need_gex; S=$WD_OUT; cd $S; G=$GEXC
export GEX_CGEN_CACHE=$S/units
run() { systemd-run --user --scope -q -p TasksMax=2048 -p MemoryMax=24G nice -n 15 "$@"; }
for f in "" --wine64-compact; do run $G cgen-image --nt-trampolines64 $f --jobs 8 >> logs/units-tramp.log 2>&1 || echo "FAIL trampolines $f"; done
python3 -I - "$@" <<'PY' | sort -u > logs/units-todo.txt
import json, os, sys
# The pinned DLLs at their pins (WDR/tools/dll-bases), and what the recordings missed besides.
for l in open(os.environ['WDR'] + '/tools/dll-bases'):
    if l.startswith('#') or not l.strip(): continue
    a, p = l.split(None, 1); p = p.strip()
    if p.startswith('/pfx/'):
        # a launcher app's own image (bin/appimg.sh's copy)
        h = f"appimg/{p[5:]}"
        if not os.path.exists(h): print(f"units: no {h} (bin/appimg.sh)", file=sys.stderr); continue
        print(f"{h}\t{hex(int(a, 16))}"); continue
    h = f"w64/dist-s/{p[5:]}"
    # a builtin that is a native module (NAME.wasm beside its skeleton) has no x86 code to translate
    if not os.path.exists(h + '.wasm'): print(f"{h}\t{hex(int(a, 16))}")
for r in sys.argv[1:]:
    for m in json.load(open(f'runs/{r}/wine32-session.json'))['unit_misses']:
        p = m['path']
        if p.startswith('/w64/'): h = 'w64/dist-s/' + p[5:]
        elif p.startswith('/pfx/'): h = 'stage/pfx/' + p[5:]
        else: continue
        print(f"{h}\t{m['base']}")
PY
sed -i 's/$/\t/;p;s/\t$/\t--wine64-compact/' logs/units-todo.txt
one() { IFS=$'\t' read -r h b f <<< "$1"; n=$(basename "$h")-$b${f:+-compact}
  run $G cgen-image "$h" --pe-base $b $f --jobs 8 > logs/units/$n.log 2>&1 < /dev/null || echo "FAIL $h $b $f"; }
export -f one run; export G S; mkdir -p logs/units
xargs -d '\n' -P 3 -I{} bash -c 'one "$1"' _ {} < logs/units-todo.txt
echo "units done: $(wc -l < logs/units-todo.txt) images, $(ls units | wc -l) units"
