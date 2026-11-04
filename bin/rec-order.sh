#!/bin/bash
# rec-order.sh URL OUT: each Start-menu program launched once in its own run on the bench box
# (q-smoke.sh, tag ro-NAME): the page's opened files (__ntOpened) at 88 s, before the Start click, and at
# 150 s, after the program's launch. OUT: what each launch opened beyond the boot, in launch order,
# the programs most-used first, each path once (eject-site.mjs --rest-order; site.sh REST_ORDER).
. "$(dirname "$0")/../env.sh"; S=$WD_OUT; url=${1:?URL}; out=${2:?OUT}
E=$(printf '%s' '(async () => await __ntOpened())()' | base64 -w0)
# name:y of its row in the Programs menu (136x96 at 108,599)
for a in np:665 fm:627 dillo:646 putty:684 con:608; do
  n=${a%%:*} y=${a##*:}
  bash "$WDR/bin/q-smoke.sh" ro-$n "$url" 150 2 SMOKE_SPKI=$SPKI SMOKE_PRELOAD_FILE=./start-preload.js SMOKE_OUT_W=1300 SMOKE_OUT_H=713 \
    "SMOKE_KEYS=90:click:20:703,93:click:30:612,97:click:170:$y" SMOKE_EVAL_AT=88,150 SMOKE_EVAL_AT_B64=$E
  echo "$n: $(grep -c 'smoke-eval@' "$S/runs/out-ro-$n.txt") evals"
done
python3 - "$S/runs" "$out" <<'P'
import json, re, sys
runs, out = sys.argv[1:]
seen, order = set(), []
for n in ['np', 'fm', 'dillo', 'putty', 'con']:
    ev = {}
    for line in open(f'{runs}/out-ro-{n}.txt', errors='replace'):
        m = re.match(r'\[smoke-eval@(\d+)\] (.*)', line)
        if m:
            try: ev[int(m.group(1))] = json.loads(m.group(2))
            except Exception: pass
    if len(ev) < 2: print(f'{n}: missing an eval ({sorted(ev)})'); continue
    a, b = ev[min(ev)], ev[max(ev)]
    if not isinstance(a, list) or not isinstance(b, list): print(f'{n}: eval not a list'); continue
    boot = set(map(str, a))
    new = [p for p in map(str, b) if p not in boot and p not in seen]
    print(f'{n}: {len(new)} files new')
    for p in new: seen.add(p); order.append(p)
open(out, 'w').write(''.join(p + '\n' for p in order))
print(f'{out}: {len(order)} paths')
P
