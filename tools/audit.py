#!/usr/bin/env python3
"""audit.py TREE...: nothing in the windemo trees comes from real Windows.

Every regular file is accounted for by content (SHA-256), in this order:
  wine source   byte-identical to a file in the Wine tree's nls/ or fonts/, its sRGB
                profile or winspool's generic PPD (the printer's, mkapps.sh) ($WINE_SRC)
  wine icu      ICU's data cut to the dist's locales (share/wine/nls/icudtl.dat): GEX's wine/icudat.py over
                the Wine tree's nls/icudtl.dat, WINE_ICU_LOCALES (default en en_US, as wine/dist.sh), redone here
  wine build    widl's .winmd in the W64 build dir (w64/b64/include), or, outside
                w64/dist, byte-identical to a w64/dist file (a prefix's copies of the builtins)
  wine native   byte-identical to wine64-dist.sh's native PE side (NATIVE_DIR: its pen64-K-N/native, the
                x86-64 builtins as wasm modules, built from the Wine tree), or to its release copy
                (STRIPNAMES: the dist's stripnames.py over it)
  wine fon      Wine's raster fonts as tools/mkfon.sh makes them from the Wine tree (w64/fon)
  winebuild PE  an MZ file with winebuild's "Wine builtin DLL" / "Wine placeholder DLL" stub
  windemo       built here from this repo's source: the launcher's agent (agent/build.sh, rebuilt and compared)
  gexcc app     a file of WN's drop-in (APPS, default apps/wn2: its SHA256SUMS), the programs built from
                source with gexcc's Windows target, and their licenses
  free app      a member of an upstream archive in test-apps/ (SHA256SUMS checked first):
                the 7-Zip msi's cabinet (libarchive), the Notepad++ zips, the Liberation fonts' tarball,
                the files themselves
  free font     a file of tools/fonts (its README.txt: the symbol fallback cut from Debian's DejaVu Sans,
                and its license)
  xkb data      under usr/share/X11/xkb, byte-identical to this machine's /usr/share/X11/xkb (xkb-data)
  allowed       a path in ALLOWED below: files Wine, wineboot, msiexec or our build write
Anything else is listed and the exit status is 1. -v prints the counts per class.

And no Wine machine code runs translated but round A's i386 set: a Wine builtin PE (winebuild's stub)
with code sections anywhere in the trees fails the audit (CODE), unless it is an i386 image byte-identical
to w64/dist-s's lib/wine/i386-windows (WoW64's i386 side, translated until its native modules land).
"""
import collections, ctypes, hashlib, os, re, struct, subprocess, sys, tarfile, tempfile, zipfile

# WD_OUT: the output tree the audit runs in (env.sh), whose w64/dist.env names the dist's sources.
S = os.environ.get('WD_OUT', os.getcwd())
# w64/dist.env (KEY=VALUE lines, written when a dist is put in w64/dist): WINE_SRC, WINMD_DIR and NATIVE_DIR
# of the build it came from; the environment overrides them.
_env = os.path.join(S, 'w64/dist.env')
if os.path.exists(_env):
    for _l in open(_env):
        if '=' in _l and not _l.startswith('#'):
            _k, _v = _l.strip().split('=', 1)
            os.environ.setdefault(_k, _v)
WINE_SRC = os.environ['WINE_SRC']
# widl's .winmd files: the wasm64 build tree's include/ (wine64-dist.sh's b64-K-S)
WINMD_DIR = os.environ.get('WINMD_DIR', 'w64/b64/include')
APPS = os.environ['APPS']
# the upstream downloads (test-apps.txt), with their SHA256SUMS
TEST_APPS = os.environ.get('TEST_APPS', 'test-apps')
NATIVE_DIR = os.environ.get('NATIVE_DIR', '')
# gexcc-win's stripnames.py, for a dist whose wasm modules are stripped for release (its name ends -sX)
STRIPNAMES = os.environ.get('STRIPNAMES', '')
# Text and data that Wine, wineboot, msiexec or our own build write; by path, relative to a tree.
ALLOWED = [r'(.*/)?(system|user|userdef)\.reg', r'\.update-timestamp', r'dll-bases',
           r'drive_c/windows/(win|system)\.ini', r'drive_c/windows/winsxs/manifests/[^/]*_deadbeef\.manifest',
           r'drive_c/windows/(system32/driverstore/filerepository/[^/]+/)?(inf/)?(mouhid|winebus|winehid|winebth|winexinput|input)\.inf',
           r'drive_c/windows/system32/winevulkan\.json', r'drive_c/windows/system32/drivers/etc/(services|hosts|networks|protocol)',
           r'drive_c/users/[^/]+/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/7-Zip/[^/]+\.lnk',
           r'drive_c/users/gex/Desktop/(Read me\.txt|[^/]+\.lnk)', r'drive_c/ProgramData/Microsoft/Windows/Start Menu/Programs/(.+/)?[^/]+\.lnk',
           # the memory64 twin's loader too (wine/dist.sh WINE64_TWIN=1: wine.m64)
           r'lib/wine/x86_64-unix/(wine|wineserver)(\.64|\.m64)?(\.wasm)?', 
           # the loader's lazy Unix side of winegstreamer (link-wine64.sh WINE64_MEDIA=lazy) and the list that keeps it
           # out of a site's boot bundle (wine64-dist.sh)
           # and the SDL2 side module winebus dlopens (link-wine64.sh, SDL2 built from source by wine64-deps.sh)
           r'lib/wine/x86_64-unix/(winegstreamer\.so|gex-rest-only|libSDL2-2\.0\.so\.0)', r'lib/wine/x86_64-windows/winepe(\.[0-9a-f]+\.cwasm|\.wasm)',
           r'lib/wine/(x86_64|i386)-windows/[^/]+\.a', r'lib/wine/x86_64-windows/[^/]+\.[0-9a-f]+\.cwasm',
           r'drive_c/windows/syswow64/winevulkan\.json', r'share/wine/wine\.inf', r'etc/ssl/certs/ca-certificates\.crt']
# this repo's tools/fonts
FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts')
# this repo
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUBS = (b'Wine builtin DLL', b'Wine placeholder DLL')


def sha(b):
    return hashlib.sha256(b).hexdigest()


def cab_members(msi):
    import olefile
    la = ctypes.CDLL('libarchive.so.13')
    la.archive_read_new.restype = ctypes.c_void_p
    la.archive_read_data.restype = ctypes.c_ssize_t
    la.archive_read_data.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
    ole = olefile.OleFileIO(msi)
    for name in ole.listdir():
        data = ole.openstream(name).read()
        if data[:4] != b'MSCF':
            continue
        a = ctypes.c_void_p(la.archive_read_new())
        la.archive_read_support_format_cab(a)
        buf = ctypes.create_string_buffer(data, len(data))
        assert la.archive_read_open_memory(a, buf, ctypes.c_size_t(len(data))) == 0
        e, chunk = ctypes.c_void_p(), ctypes.create_string_buffer(1 << 20)
        while la.archive_read_next_header(a, ctypes.byref(e)) == 0:
            h = hashlib.sha256()
            while (n := la.archive_read_data(a, chunk, 1 << 20)) > 0:
                h.update(chunk.raw[:n])
            assert n == 0, f'{msi}: cabinet read error'
            yield h.hexdigest()
        la.archive_read_free(a)


def pe_code(b):
    """(machine, code bytes) of a Wine builtin PE (winebuild's stub), or None."""
    if len(b) < 0x40 or b[:2] != b'MZ' or not any(s in b[:1024] for s in STUBS):
        return None
    pe = struct.unpack_from('<I', b, 0x3c)[0]
    if pe + 24 > len(b) or b[pe:pe + 4] != b'PE\0\0':
        return None
    mach = {0x14c: 'i386', 0x8664: 'x86_64'}.get(struct.unpack_from('<H', b, pe + 4)[0], 'other')
    nsec, opt = struct.unpack_from('<H', b, pe + 6)[0], struct.unpack_from('<H', b, pe + 20)[0]
    code, names = 0, set()
    for i in range(nsec):
        o = pe + 24 + opt + i * 40
        if o + 40 > len(b):
            break
        names.add(b[o:o + 8].rstrip(b'\0'))
        if struct.unpack_from('<I', b, o + 36)[0] & 0x20000020:
            code += struct.unpack_from('<I', b, o + 16)[0]
    if b'.wasm' in names or b'.wasmref' in names:
        code = 0
    return mach, code


def tree_hashes(d):
    out = {}
    for dp, _, fn in os.walk(d):
        for n in fn:
            p = os.path.join(dp, n)
            if os.path.isfile(p) and not os.path.islink(p):
                out[sha(open(p, 'rb').read())] = p
    return out


def stripped_hashes(d):
    """The release copies of NATIVE_DIR's wasm modules (wine64-dist.sh strips their names with gexcc-win's
    stripnames.py unless WINE64_STRIP=0), made in a scratch directory."""
    import concurrent.futures, tempfile
    tmp = tempfile.mkdtemp(prefix='audit-strip-', dir=os.environ.get('WD_HOT') or None)
    mods = [os.path.join(d, n) for n in os.listdir(d) if n.endswith(('.wasm', '.wasm.m64'))]  # a twin's memory64 modules too

    def one(i_p):
        i, p = i_p
        o = os.path.join(tmp, '%d.wasm' % i)
        subprocess.run([sys.executable, '-I', STRIPNAMES, p, o], check=True)
        h = sha(open(o, 'rb').read())
        os.unlink(o)
        return h, p
    try:
        with concurrent.futures.ThreadPoolExecutor(8) as ex:
            return dict(ex.map(one, enumerate(mods)))
    finally:
        os.rmdir(tmp)


def main():
    args = [a for a in sys.argv[1:] if a != '-v']
    verbose = '-v' in sys.argv
    trees = args or ['w64/dist-s', 'stage/pfx', 'stage/usr']
    os.chdir(S)
    r = subprocess.run(['sha256sum', '-c', '--quiet', 'SHA256SUMS'], cwd=TEST_APPS)
    if r.returncode:
        sys.exit(f'{TEST_APPS}/SHA256SUMS does not check')
    src = {}
    for d in ('nls', 'fonts'):
        src.update(tree_hashes(os.path.join(WINE_SRC, d)))
    for f in ('dlls/mscms/srgb2014.icc', 'dlls/winspool.drv/generic.ppd'):
        f = os.path.join(WINE_SRC, f)
        src[sha(open(f, 'rb').read())] = f
    # ICU's data as wine/dist.sh cuts it, redone from the Wine tree's
    icu = os.path.join(WINE_SRC, 'nls/icudtl.dat'); cut = os.path.join(os.environ.get('GEX', ''), 'wine/icudat.py')
    if os.path.isfile(icu) and os.path.isfile(cut):
        with tempfile.TemporaryDirectory(dir=os.environ.get('WD_HOT') or None) as td:
            o = os.path.join(td, 'icudtl.dat')
            if subprocess.run([sys.executable, '-I', cut, icu, o, *os.environ.get('WINE_ICU_LOCALES', 'en en_US').split()],
                              stdout=subprocess.DEVNULL).returncode == 0:
                src[sha(open(o, 'rb').read())] = 'wine icu: ' + icu
    dist = tree_hashes('w64/dist-s')
    winmd = {}
    winmd.update({sha(open(os.path.join(WINMD_DIR, n), 'rb').read()): n
                  for n in os.listdir(WINMD_DIR) if n.endswith('.winmd')})
    # (NATIVE_DIR may name several, colon-separated: a core relinked over the dist's)
    native = {}
    for nd in filter(None, NATIVE_DIR.split(':')):
        native.update(tree_hashes(nd))
        native.update(stripped_hashes(nd) if STRIPNAMES else {})
    fon = tree_hashes('w64/fon') if os.path.isdir('w64/fon') else {}
    apps = {}
    for f in os.listdir(TEST_APPS):
        p = os.path.join(TEST_APPS, f)
        apps[sha(open(p, 'rb').read())] = f
        if f.endswith('.msi'):
            apps.update({h: f for h in cab_members(p)})
        if f.endswith('.zip'):
            with zipfile.ZipFile(p) as z:
                apps.update({sha(z.read(i)): f for i in z.infolist() if not i.is_dir()})
        if f.endswith('.tar.gz'):
            with tarfile.open(p) as t:
                apps.update({sha(t.extractfile(i).read()): f for i in t.getmembers() if i.isfile()})
    gexcc = {}
    if os.path.isdir(APPS):
        if subprocess.run(['sha256sum', '-c', '--quiet', 'SHA256SUMS'], cwd=APPS).returncode:
            sys.exit(f'{APPS}/SHA256SUMS does not check')
        gexcc = {l.split(None, 1)[0]: l.split(None, 1)[1].strip() for l in open(os.path.join(APPS, 'SHA256SUMS')) if l.strip()}
    fonts = {sha(open(os.path.join(FONTS, n), 'rb').read()): n for n in os.listdir(FONTS)
             if n != 'README.txt'}
    ours = {}
    with tempfile.TemporaryDirectory() as td:
        subprocess.run([os.path.join(REPO, 'agent/build.sh'), os.path.join(td, 'agent.exe')], check=True)
        ours[sha(open(os.path.join(td, 'agent.exe'), 'rb').read())] = 'agent.exe'
    i386 = tree_hashes('w64/dist-s/lib/wine/i386-windows')
    codebad = []
    allowed = re.compile('(' + '|'.join(ALLOWED) + ')$')
    count, bad = collections.Counter(), []
    for t in trees:
        build = winmd if os.path.normpath(t) in ('w64/dist', 'w64/dist-s') else {**dist, **winmd}
        for dp, _, fn in os.walk(t):
            for n in fn:
                p = os.path.join(dp, n)
                if os.path.islink(p) or not os.path.isfile(p):
                    continue
                b = open(p, 'rb').read()
                h = sha(b)
                rel = os.path.relpath(p, t)
                pc = pe_code(b)
                if pc and pc[1] and not (pc[0] == 'i386' and h in i386):
                    codebad.append(f'{p} ({pc[0]}, {pc[1]} B of code)')
                if h in src:
                    c = 'wine source'
                elif h in build:
                    c = 'wine build'
                elif h in native:
                    c = 'wine native'
                elif h in fon:
                    c = 'wine fon'
                elif b[:2] == b'MZ' and any(s in b[:1024] for s in STUBS):
                    c = 'winebuild PE'
                elif h in ours:
                    c = 'windemo'
                elif h in gexcc:
                    c = 'gexcc app'
                elif h in apps:
                    c = 'free app'
                elif h in fonts:
                    c = 'free font'
                elif rel.startswith('share/X11/xkb/') and os.path.isfile('/usr/' + rel) and open('/usr/' + rel, 'rb').read() == b:
                    c = 'xkb data'
                elif allowed.match(rel):
                    c = 'allowed'
                else:
                    bad.append(p)
                    continue
                count[(t, c)] += 1
    if verbose:
        for (t, c), n in sorted(count.items()):
            print(f'{n:6} {t:16} {c}')
    total = sum(count.values()) + len(bad)
    for p in bad:
        print('UNACCOUNTED', p)
    for p in codebad:
        print('CODE', p)
    print(f'audit: {total} files in {", ".join(trees)}, {len(bad)} unaccounted, {len(codebad)} Wine PE with machine code outside the i386 set')
    sys.exit(1 if bad or codebad else 0)


main()
