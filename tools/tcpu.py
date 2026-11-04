#!/usr/bin/env python3
"""tcpu.py OUT T1 T2 [HZ]: from a smoke run's tcpu.txt (SMOKE_TCPU), each Chromium thread's CPU seconds between
T1 and T2 (console.txt's clock), busiest first, the total, and the busiest threads per second."""
import sys
o, t1, t2 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]); hz = float(sys.argv[4]) if len(sys.argv) > 4 else 100
first, lastv, comm, series = {}, {}, {}, {}
for l in open(f'{o}/tcpu.txt'):
    s, p, t, c, v = l.split(); s = float(s); v = int(v); k = (p, t); comm[k] = c
    series.setdefault(k, []).append((s, v))
def at(k, x):  # ticks at time x: the last sample at or before x
    v = None
    for s, n in series[k]:
        if s <= x: v = n
        else: break
    return v
rows = []
for k in series:
    a, b = at(k, t1), at(k, t2)
    if b is None: continue
    d = (b - (a if a is not None else 0)) / hz
    if a is None and series[k][0][0] < t1: continue
    if d > 0.05: rows.append((d, k))
rows.sort(reverse=True)
print(f'{o}: {t1:.1f}-{t2:.1f} s ({t2 - t1:.1f} s wall)')
for d, (p, t) in rows[:15]: print(f'  {d:6.2f} s  {100 * d / (t2 - t1):5.1f}%  pid {p} tid {t} {comm[(p, t)]}')
print(f'  total {sum(d for d, _ in rows):.2f} s CPU')
top = [k for _, k in rows[:6]]
print('  per second (s CPU): ' + ' | '.join(f'{comm[k][:14]}/{k[1]}' for k in top))
x = t1
while x < t2:
    print(f'  {x:6.1f} ' + ' '.join(f'{((at(k, x + 1) or 0) - (at(k, x) or 0)) / hz:5.2f}' for k in top))
    x += 1
