#!/usr/bin/env python3
"""np-net.py OUTDIR: the Notepad++ launch of an out-TAG run (smoke.mjs with SMOKE_TRACE, start-preload.js):
rest-bundle range requests (frames, re-fetches, bytes), bridge-script requests (network or cache),
and click -> window map -> first burst of paints."""
import json, re, sys, collections
o = sys.argv[1]
con = open(f'{o}/console.txt').read().splitlines()
click = next(float(l.split()[0]) for l in con if 'click:170:' in l)
mapped = next((float(l.split()[0]) for l in con if '[wins]' in l and 'Notepad++' in l), None)
ser = [(float(l.split()[0]), int(m.group(1))) for l in con if '[wins]' in l
       for m in [re.search(r'\|\d+:1:\d+ role=1 \S+ serial=(\d+) [^|]*Notepad\+\+', '|' + l.split('] ', 1)[1].split(' ', 1)[1])] if m]
usable = next((t for t, s in ser if s >= 10), None)
print(f"click {click:.1f}  map +{mapped - click:.1f} s  usable (serial>=10) +{(usable or 0) - click:.1f} s")
d = json.load(open(f'{o}/trace.json')); ev = d['traceEvents'] if isinstance(d, dict) else d
start = next((float(l.split('s ')[0]) for l in open(f'{o}.txt') if l.endswith('s tracing\n')), None)
ts0 = min(e['ts'] for e in ev if e.get('ts') and e.get('ph') == 'X')
T = lambda e: start + (e['ts'] - ts0) / 1e6
req = {}
for e in ev:
    a = e.get('args', {}).get('data', {})
    if e.get('name') == 'ResourceSendRequest': req[a['requestId']] = {'url': a.get('url', ''), 't': T(e)}
    elif e.get('name') == 'ResourceReceiveResponse' and a.get('requestId') in req:
        req[a['requestId']].update(cache=bool(a.get('fromCache') or a.get('fromServiceWorker')), status=a.get('statusCode'))
    elif e.get('name') == 'ResourceFinish' and a.get('requestId') in req:
        req[a['requestId']]['bytes'] = a.get('encodedDataLength', 0)
w0, w1 = float(sys.argv[2]) if len(sys.argv) > 2 else click, (usable or click + 40) + 2
print(f"requests from {w0:.1f} s to {w1:.1f} s:")
g = collections.defaultdict(lambda: [0, 0, 0])
for r in req.values():
    if not (w0 <= r['t'] <= w1): continue
    k = re.sub(r'-[^-/]*\.js$', '.js', r['url'].split('?')[0].split('/')[-1])
    g[k][0] += 1; g[k][1] += r.get('bytes', 0); g[k][2] += r.get('cache', False)
for k, (n, b, c) in sorted(g.items(), key=lambda x: -x[1][1]):
    print(f"  {k:28s} {n:4d} requests  {b / 1e6:7.2f} MB  {c} from cache")
