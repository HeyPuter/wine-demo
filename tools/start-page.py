#!/usr/bin/env python3
"""start-page.py CONSOLE: the page Start menu check's verdict from smoke.mjs's console.txt (start-preload.js's
[wins] lines and the [smoke] input lines). Clicks: Start, Programs 3 s later, the taskbar, Start, Programs, the
taskbar (q-smoke.sh with SMOKE_KEYS from start-page.sh); the menu is a window more after each
Start click and gone after each taskbar click, Programs a window more again (its submenu, right of the menu)
with the shortcuts; then the double-click on Read me must bring Notepad's window. Also says how long the first
menu took to map (it loaded every Control Panel applet before explorer skipped that check).
Then the keyboard (start-page.py CONSOLE OUT): the line typed into Notepad and the Down in the file manager each
change their part of the screen (the page screenshots r-*-Ns.png beside CONSOLE, the last one before the input
against one 3 s after it), and cmd's "copy nul typed.txt" makes the guest open typed.txt (OUT's eval line), and after its taskbar
button minimized and restored it, "copy nul typed2.txt" typed2.txt."""
import glob
import os
import re
import sys

lists, events = [], []
for line in open(sys.argv[1], errors='replace'):
    m = re.match(r'\s*([0-9.]+) \[wins\] (\d+) ?(.*)$', line)
    if m:
        # by window (its first word), not its serial or size; no cursors (role=4)
        lists.append((float(m.group(1)), [x for x in m.group(3).split('|') if x and ' role=4 ' not in x]))
        continue
    m = re.match(r'\s*([0-9.]+) \[smoke\] (dbl)?click:(\d+):(\d+)', line)
    if m:
        events.append((float(m.group(1)), (m.group(2) or '') + f'click {m.group(3)},{m.group(4)}'))


def state(t):
    """The window list a second before t (a click's line is written once it is done)."""
    w = [l for at, l in lists if at <= t - 1.0]
    return w[-1] if w else []


final = lists[-1][1] if lists else []
if len(events) < 7:
    print(f'start-page: FAIL only {len(events)} clicks in the log'); sys.exit(1)
after = [state(e[0]) for e in events[1:]]
base = state(events[0][0])
keys = {x.split(' ')[0] for x in base}
ok = True
for i, (what, more) in enumerate((('menu opened', 1), ('Programs submenu opened 3 s after the first Start', 2), ('menus closed', 0), ('menu opened again', 1), ('Programs submenu opened', 2), ('menus closed again', 0))):
    w = after[i]
    new = [x for x in w if x.split(' ')[0] not in keys]
    good = len(new) == more
    if more == 2:
        good &= any(re.search(r' \d+x\d+@1\d\d,', x) for x in new)
    ok &= good
    print(f'start-page: {"ok" if good else "FAIL"} {what}: {len(base)} windows before Start, {len(w)} after {events[i][1]} at {events[i][0]:.0f} s' + (f' (new: {new})' if new else ''))
t0 = events[0][0]
first = next((at for at, l in lists if at >= t0 and any(x.split(' ')[0] not in keys for x in l)), None)
print(f'start-page: the first menu mapped {first - t0:.1f} s after the Start click' if first else 'start-page: the first menu never mapped')
np = any('Notepad"' in x for x in final) and not any('Notepad"' in x for x in base)
ok &= np
print(f'start-page: {"ok" if np else "FAIL"} Notepad after the double-click on Read me: {[x for x in final if "otepad" in x]}')


def shots():
    out = []
    for f in glob.glob(os.path.join(os.path.dirname(sys.argv[1]), 'r-*-*s.png')):
        m = re.search(r'-(\d+)s\.png$', f)
        out.append((int(m.group(1)), f))
    return sorted(out)


def changed(start, end, box):
    """Pixels of box (x0, y0, x1, y1) that differ between the last shot before start and the first 3 s after end."""
    from PIL import Image, ImageChops
    s = shots()
    a = [f for at, f in s if at < start]
    b = [f for at, f in s if at >= end + 3]
    if not a or not b:
        return None
    d = ImageChops.difference(Image.open(a[-1]).convert('RGB').crop(box), Image.open(b[0]).convert('RGB').crop(box))
    return sum(1 for p in d.getdata() if max(p) > 40)


inputs = []
for line in open(sys.argv[1], errors='replace'):
    m = re.match(r'\s*([0-9.]+) \[smoke\] (type:\S+|key "ArrowDown"|key "Enter")', line)
    if m:
        inputs.append((float(m.group(1)), m.group(2)))
typed = [at for at, k in inputs if k == 'type:typed+in+notepad']
down = [at for at, k in inputs if k == 'key "ArrowDown"']
# (a type: line is written once its last key is in, about 2 s after its first: the shot before is one from
# before the click into Notepad)
for what, at, lead, box in (('a line typed into Notepad', typed, 5, (20, 178, 260, 200)),
                            ('Down in the file manager selects its first row', down, 0.5, (157, 108, 630, 126))):
    n = changed(at[0] - lead, at[0], box) if at else None
    good = bool(n and n > 30)
    ok &= good
    print(f'start-page: {"ok" if good else "FAIL"} {what}: {n if n is not None else "no input or no screenshots"} pixels changed')
ev = ''
if len(sys.argv) > 2 and os.path.exists(sys.argv[2]):
    ev = ' '.join(l.split('"typed"', 1)[1] for l in open(sys.argv[2], errors='replace') if 'smoke-eval' in l and '"typed"' in l)
for f, what in (('typed.txt', 'cmd took "copy nul typed.txt"'),
                ('typed2.txt', 'cmd, minimized and restored by its taskbar button, took "copy nul typed2.txt"')):
    good = f'/{f}' in ev
    ok &= good
    print(f'start-page: {"ok" if good else "FAIL"} {what} (the guest opened {f})')
sys.exit(0 if ok else 1)
