#!/usr/bin/env python3
"""builtins.py PREFIX DIST: every copy of a Wine builtin in PREFIX's drive_c (a PE with winebuild's
"Wine builtin DLL" / "Wine placeholder DLL" stub, anywhere: system32, syswow64, winsxs, drivers, wbem,
C:\\windows, Program Files, ...) becomes DIST's file of that name and arch (lib/wine/x86_64-windows for a
PE32+, i386-windows for a PE32): the native x86-64 module's skeleton, or the i386 image. A builtin DIST
leaves out (icu, Win16 and VxD) is deleted; one DIST has under no such name becomes a Wine placeholder DLL.
No Wine machine code but the dist's own then ships in the prefix. Prints what it did per kind."""
import collections, os, shutil, struct, sys

pfx, dist = sys.argv[1], sys.argv[2]
STUBS = (b'Wine builtin DLL', b'Wine placeholder DLL')
DROP = {'icu.dll', 'icuin.dll', 'icuuc.dll', 'winevdm.exe', 'wow32.dll', 'w32skrnl.dll', 'ddhelp.exe', 'dosx.exe'}
DROP_EXT = ('.dll16', '.drv16', '.exe16', '.mod16', '.vxd')
SIG = b'Wine placeholder DLL\0'
# The side-by-side copies that are another module of the dist under the name the manifest gives them:
# winsxs's common-controls comctl32.dll is the dist's comctl32_v6.dll (Wine installs it there so).
# Its v5 skeleton there binds the v5 module: no v6 class (Button, ...) registers, explorer's taskbar has
# no buttons and redraws every window without end.
SXS = {'comctl32.dll': 'comctl32_v6.dll'}


def machine(b):
    if len(b) < 0x40 or b[:2] != b'MZ' or not any(s in b[:1024] for s in STUBS):
        return None
    pe = struct.unpack_from('<I', b, 0x3c)[0]
    if pe + 6 > len(b) or b[pe:pe + 4] != b'PE\0\0':
        return None
    return {0x14c: 'i386', 0x8664: 'x86_64'}.get(struct.unpack_from('<H', b, pe + 4)[0])


def placeholder(wide, is_exe):  # setupapi fakedll.c's layout, no sections
    lfanew = (64 + len(SIG) + 15) & ~15
    dos = struct.pack('<2sHHHHHHHHHHHHH8sHH20sI', b'MZ', 64, 1, 0, lfanew // 16, 0, 0xffff, 0, 0xb8, 0, 0, 0,
                      lfanew, 0, b'\0' * 8, 0, 0, b'\0' * 20, lfanew)
    buf = bytearray(dos) + SIG
    buf += b'\0' * (lfanew - len(buf))
    opt_size = 240 if wide else 224
    chars = (0 if is_exe else 0x2000) | (0 if wide else 0x0100) | 0x0002
    buf += struct.pack('<4sHHIIIHH', b'PE\0\0', 0x8664 if wide else 0x14c, 0, 0, 0, 0, opt_size, chars)
    hdr = lfanew + 4 + 20 + opt_size
    mem, fil = (hdr + 4095) & ~4095, (hdr + 511) & ~511
    if wide:
        opt = struct.pack('<HBBIIIIIQIIHHHHHHIIIIHHQQQQII', 0x20b, 1, 0, 0, 0, 0, mem, mem, 0x10000000, 4096, 512,
                          1, 0, 1, 0, 4, 0, 0, mem, fil, 0, 2, 0, 0, 0, 0, 0, 0, 16)
    else:
        opt = struct.pack('<HBBIIIIIIIIIHHHHHHIIIIHHIIIIII', 0x10b, 1, 0, 0, 0, 0, mem, mem, 0, 0x10000000, 4096,
                          512, 1, 0, 1, 0, 4, 0, 0, mem, fil, 0, 2, 0, 0, 0, 0, 0, 0, 16)
    buf += opt + b'\0' * (opt_size - len(opt))
    return bytes(buf + b'\0' * (fil - len(buf)))


names = {a: {n.lower(): os.path.join(dist, 'lib/wine', f'{a}-windows', n)
             for n in os.listdir(os.path.join(dist, 'lib/wine', f'{a}-windows'))} for a in ('x86_64', 'i386')}
done = collections.Counter()
for dp, _, fn in os.walk(os.path.join(pfx, 'drive_c')):
    for n in fn:
        p = os.path.join(dp, n)
        if os.path.islink(p) or not os.path.isfile(p):
            continue
        # A program built with gexcc carries winebuild's builtin stub too, its code in NAME.wasm beside it:
        # it is the program's own, not Wine's (WN's apps: 7-Zip, Notepad++, Dillo).
        if os.path.exists(p + '.wasm'):
            done['gexcc app'] += 1
            continue
        # A visual style (Wine's aero) is winegcc's resource-only DLL with the builtin stub:
        # no Wine module of that name, and the placeholder that stood for one left the theme 512 bytes.
        if n.lower().endswith('.msstyles'):
            done['visual style'] += 1
            continue
        with open(p, 'rb') as f:
            a = machine(f.read(4096))
        if not a:
            continue
        low = n.lower()
        sxs = 'winsxs' in os.path.relpath(dp, pfx).lower().split(os.sep)
        src = names[a].get(SXS.get(low, low) if sxs else low)
        if src:
            if open(src, 'rb').read() != open(p, 'rb').read():
                shutil.copyfile(src, p)
            done[f'{a} dist'] += 1
        elif low in DROP or low.endswith(DROP_EXT):
            os.unlink(p)
            done[f'{a} dropped'] += 1
            print(f'builtins: dropped {os.path.relpath(p, pfx)}', file=sys.stderr)
        else:
            with open(p, 'wb') as f:
                f.write(placeholder(a == 'x86_64', low.endswith('.exe')))
            done[f'{a} placeholder'] += 1
            print(f'builtins: placeholder {os.path.relpath(p, pfx)}', file=sys.stderr)
print('builtins: ' + ', '.join(f'{v} {k}' for k, v in sorted(done.items())))
