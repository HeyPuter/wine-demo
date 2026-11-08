#!/usr/bin/env python3
"""ttd.py OUT...: from smoke runs' console.txt ([ttd] lines, tools/ttd-preload.js), seconds from navigation to
pid 1 (start()'s "Started" of the first program, on its own clock: add its offset), the desktop's taskbar,
cmd's window and the "Desktop" folder window; the download to desktop, every file the page fetched by then
(Resource Timing), split into the loader's bytes (its progress) and the page's own (HTML, scripts, manifests);
and the programs started, in order."""
import json, re, sys
for o in sys.argv[1:]:
    w, prog, progs, page = {}, None, [], None
    for l in open(f'{o}/console.txt', errors='replace'):
        m = re.search(r'\[ttd\] window (\d+) (".*?") ', l)
        if m: w.setdefault(json.loads(m.group(2)), int(m.group(1)) / 1000)
        m = re.search(r'\[ttd\] page (\{.*)', l)
        if m and page is None:
            try: page = json.loads(m.group(1))
            except ValueError: page = {}
        m = re.search(r'\[ttd\] progress (\{.*)', l)
        if m and prog is None:
            try: prog = json.loads(m.group(1))
            except ValueError: prog = {}
    first = None
    if prog:
        progs = [e['text'].removeprefix('Started ') for e in prog.get('programs', [])]
        first = next((e['t'] / 1000 for e in prog.get('programs', [])), None)
    f = lambda k: f"{w[k]:.1f}" if k in w else '-'
    cmd, p1 = 'C:\\windows\\system32\\cmd.exe', '-' if first is None else f'{first:.1f}'
    ld = prog.get('download', {}).get('total') if prog else None
    # page: every file's bytes (Resource Timing), the loader's among them
    tot = page.get('bytes') if page else None
    dl = f"{tot} B (loader {ld} + page {tot - ld} B)" if ld is not None and tot is not None and tot >= ld else f"{ld if ld is not None else '-'} B (loader only)"
    print(f"{o}: pid1 {p1} (start clock), taskbar {f('(untitled)')}, cmd {f(cmd)}, Desktop {f('Desktop')} s; download to desktop {dl}; programs: {' '.join(progs)}")
