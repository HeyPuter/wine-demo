#!/usr/bin/env python3
"""start-smoke.py LOG: start-smoke.sh's verdict on the Start menu, from gexc's log: the compositor's window
list ([wl-place], printed when it changes) as it stood at each scripted input. Start is clicked at 40 s and
56 s, the taskbar clicked at 50 s and 64 s; the menu is a window the list before 40 s does not have."""
import re
import sys

cur, at = [], {}
for line in open(sys.argv[1], errors='replace'):
    if line.startswith('[wl-place]'):
        cur = re.findall(r' (\d+:\d+) id=(0x[0-9a-f]+) (\d+)x(\d+)\+(-?\d+)\+(-?\d+)', line)
    m = re.match(r'\[gex\] input at ([0-9.]+) s', line)
    if m:
        at.setdefault(float(m.group(1)), list(cur))
final = cur
T = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0


def wins(t):
    """The list just before the first input at or after t."""
    ks = [k for k in sorted(at) if k >= t]
    return at[ks[0]] if ks else final


ok = True
base = wins(40.0 + T)
# Windows that map late on a loaded machine (the file manager) and are still there at the end are no menu.
known = {b[1] for b in base} | {f[1] for f in final}
for what, t, more in (('menu opened', 50.0, True), ('menu closed', 56.0, False),
                      ('menu opened again', 64.0, True), ('menu closed again', 68.0, False)):
    w = wins(t + T)
    new = [x for x in w if x[1] not in known]
    good = bool(new) if more else not new
    ok &= good
    extra = f' (new: {" ".join(f"{x[1]} {x[2]}x{x[3]}+{x[4]}+{x[5]}" for x in new)})' if new else ''
    print(f'start-smoke: {"ok" if good else "FAIL"} {what}: {len(base)} windows before Start, {len(w)} at {t:g} s{extra}')
sys.exit(0 if ok else 1)
