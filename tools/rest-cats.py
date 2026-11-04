#!/usr/bin/env python3
"""rest-cats.py SITE: SITE's rest bundle (project/build/web/rest.bin, lazy.json) by category, raw and compressed
bytes. A frame's compressed bytes go to the files in it by their share of its raw bytes; a content the tar
holds once (several paths, one hash) counts for the first category in CATS order that one of its paths has.
The test files in the user's Downloads are listed on their own."""
import collections
import json
import os
import re
import sys

web = os.path.join(sys.argv[1], 'project/build/web')
lazy = json.load(open(os.path.join(web, 'lazy.json')))['files']
rb = json.load(open(os.path.join(web, 'rest.bin.json')))
frame, frames = rb['frame'], rb['frames']

CATS = [
    ('Downloads test files', r'^/pfx/drive_c/users/[^/]+/Downloads/'),
    ('32-bit translated Wine (i386 PE)', r'^/w64/lib/wine/i386-windows/'),
    ('x86_64 native Wine: wasm modules', r'^/w64/lib/wine/x86_64-windows/.*\.wasm$'),
    ('x86_64 native Wine: PE skeletons', r'^/w64/lib/wine/x86_64-windows/'),
    ('ICU data', r'(?i)icu|\.dat$'),
    ('Wine core: loader, server', r'^/w64/lib/wine/x86_64-unix/'),
    ('Wine core: nls, winmd, fonts, other share', r'^/w64/share/'),
    ('apps/users', r'^/pfx/drive_c/(Program Files|Files|users)/(7-Zip|Notepad\+\+|Dillo|PuTTY|[^/]+$|gex/)'),
    ('prefix copies (system32, syswow64, winsxs, Program Files stubs)', r'^/pfx/'),
    ('XKB data', r'^/usr/share/X11/'),
    ('other', r''),
]


def cat(p):
    return next(i for i, (_, rx) in enumerate(CATS) if re.search(rx, p))


by_off = {}
for p, size, where, _ in lazy:
    off = int(where.split('#')[1])
    c = cat(p)
    o = by_off.get(off)
    by_off[off] = (size, min(c, o[1]) if o else c, (o[2] if o else []) + [p])

raw, z, n = collections.Counter(), collections.Counter(), collections.Counter()
dl = []
for off, (size, c, paths) in by_off.items():
    raw[c] += size
    n[c] += 1
    zs = 0.0
    a, b = off, off + size
    while a < b:
        k = a // frame
        e = min(b, (k + 1) * frame)
        fz = frames[k][1]
        flen = min(frame, rb['size'] - k * frame)
        zs += fz * (e - a) / flen
        a = e
    z[c] += zs
    if c == 0:
        dl.append((paths[0], size, zs))
total_z = sum(f[1] for f in frames)
print(f'{sys.argv[1]}: rest.bin {total_z / 1e6:.2f} MB compressed, tar {rb["size"] / 1e6:.2f} MB, {len(lazy)} paths, {len(by_off)} contents')
for i, (name, _) in enumerate(CATS):
    if n[i]:
        print(f'  {name}: {z[i] / 1e6:.2f} MB compressed, {raw[i] / 1e6:.2f} MB raw, {n[i]} files')
print(f'  (tar headers and padding: {(total_z - sum(z.values())) / 1e6:.2f} MB compressed)')
for p, s, zs in sorted(dl):
    print(f'    {p}: {zs / 1e6:.2f} MB compressed, {s / 1e6:.2f} MB raw')
