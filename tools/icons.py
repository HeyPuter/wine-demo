#!/usr/bin/env python3
"""icons.py OUT SPEC...: each SPEC is ID=PATH, a PE (.exe, .dll) or an .msi; OUT/ID.png is the largest image of
its first icon group (RT_GROUP_ICON; an .msi's from its Icon table), scaled to 96x96 at most.
  ID=PATH#N        the PE's icon group N instead
  ID=PATH::MEMBER  the icon of MEMBER, a program inside the installer PATH (an NSIS installer or a zip
                   through 7-Zip's 7zz, an Inno Setup one through innoextract: $INNOEXTRACT, default on PATH)
A file with no icon is skipped and named on stderr. Prints ID for each icon written."""
import io, os, shutil, struct, subprocess, sys, tempfile
import olefile, pefile
from PIL import Image

RT_ICON, RT_GROUP_ICON = 3, 14

def pe_icon(data, gid=None):
    """the .ico bytes of a PE's first icon group (or group GID), or None"""
    pe = pefile.PE(data=data, fast_load=True)
    pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_RESOURCE']])
    if not hasattr(pe, 'DIRECTORY_ENTRY_RESOURCE'):
        return None
    icons, group = {}, None
    for t in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        for e in t.directory.entries:
            for l in e.directory.entries:
                d = pe.get_data(l.data.struct.OffsetToData, l.data.struct.Size)
                if t.id == RT_ICON:
                    icons[e.id] = d
                elif t.id == RT_GROUP_ICON and group is None and gid in (None, e.id):
                    group = d
    if not group:
        return None
    _, _, n = struct.unpack_from('<HHH', group)
    ents = []
    for i in range(n):
        w, h, c, r, planes, bits, size, ident = struct.unpack_from('<BBBBHHIH', group, 6 + 14 * i)
        if ident in icons:
            ents.append((w, h, c, r, planes, bits, icons[ident]))
    if not ents:
        return None
    out = struct.pack('<HHH', 0, 1, len(ents))
    off = 6 + 16 * len(ents)
    body = b''
    for w, h, c, r, planes, bits, d in ents:
        out += struct.pack('<BBBBHHII', w, h, c, r, planes, bits, len(d), off + len(body))
        body += d
    return out + body

def msi_name(enc):
    """an MSI stream name, decoded (its base-64 packing of two characters in one)"""
    abc = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._'
    out = ''
    for ch in enc:
        c = ord(ch)
        if 0x3800 <= c < 0x4800:
            c -= 0x3800; out += abc[c & 0x3f] + abc[(c >> 6) & 0x3f]
        elif 0x4800 <= c < 0x4840:
            out += abc[c - 0x4800]
        elif c == 0x4840:
            out += '!'
        else:
            out += ch
    return out

def msi_icon(path):
    ole = olefile.OleFileIO(path)
    best = None
    for s in ole.listdir():
        n = msi_name(s[-1])
        if n.startswith('!Icon') or n.startswith('Icon.'):
            d = ole.openstream(s).read()
            ico = pe_icon(d) if d[:2] == b'MZ' else d if d[:4] == b'\0\0\1\0' else None
            if ico and (best is None or len(ico) > len(best)):
                best = ico
    return best

def member(path, m):
    """the bytes of MEMBER inside the installer PATH, or None"""
    with tempfile.TemporaryDirectory() as td:
        r = subprocess.run(['7zz', 'e', '-y', f'-o{td}', path, m], capture_output=True)
        f = os.path.join(td, os.path.basename(m))
        if r.returncode or not os.path.isfile(f):
            ie = os.environ.get('INNOEXTRACT') or shutil.which('innoextract')
            if not ie:
                return None
            subprocess.run([ie, '-q', '-e', '-d', td, '-I', m, path], capture_output=True)
            f = os.path.join(td, m)
        return open(f, 'rb').read() if os.path.isfile(f) else None

def largest(ico):
    im = Image.open(io.BytesIO(ico))
    sizes = sorted(im.info.get('sizes', {im.size}), key=lambda s: s[0] * s[1])
    im.size = sizes[-1]
    im = im.convert('RGBA')
    if im.width > 96:
        im = im.resize((96, 96), Image.LANCZOS)
    return im

def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for spec in sys.argv[2:]:
        ident, path = spec.split('=', 1)
        gid, m = None, None
        if '::' in path:
            path, m = path.split('::', 1)
        elif '#' in path:
            path, gid = path.rsplit('#', 1); gid = int(gid)
        try:
            if m:
                d = member(path, m)
                ico = pe_icon(d) if d else None
            elif path.lower().endswith('.msi'):
                ico = msi_icon(path)
            else:
                ico = pe_icon(open(path, 'rb').read(), gid)
        except Exception as e:
            ico = None
            print(f'icons: {ident}: {e}', file=sys.stderr)
        if not ico:
            print(f'icons: no icon in {path} ({ident})', file=sys.stderr)
            continue
        largest(ico).save(os.path.join(out, f'{ident}.png'), optimize=True)
        print(ident)

main()
