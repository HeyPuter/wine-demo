#!/usr/bin/env python3
# sweep.py URL PASS [ID...]: every recipes.tsv and interactive.tsv row (or the named ones) through appsweep.mjs
# on the windemo page at URL, APPSWEEP_JOBS at a time (default 3), each in a systemd-run scope.
#
# WD_SWEEP: the sweep's own directory, outside the repo: dl/ (the downloads fetch.tsv names), x/ (zips
# extracted on the host), runs/PASS/ID (each run, less its browser profile) and matrix-PASS.tsv (one row per
# app, ranked as list.tsv; mkmatrix.py adds the verdicts). Rows of programs that stay off the repo go in its
# local-recipes.tsv, local-interactive.tsv and local-list.tsv, read after the repo's.
# WD_SWEEP_HOT: where a run works (default WD_SWEEP/as; a tmpfs is fine). NODE: node (default: node on PATH).
# SPKI: the page's certificate's SPKI hash, for Chromium to trust it (default: it ignores certificate errors).
import json, os, re, subprocess, sys, shutil, zipfile, time
from concurrent.futures import ThreadPoolExecutor
T = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.dirname(T)
A = os.environ.get('WD_SWEEP') or sys.exit('sweep.py: WD_SWEEP, the sweep directory, is not set')
HOT = os.environ.get('WD_SWEEP_HOT', f'{A}/as'); X = f'{A}/x'  # zips extracted on disk: a folder dropped from a tmpfs arrived as nothing
url, pas, only = sys.argv[1], sys.argv[2], sys.argv[3:]
def table(name):
    """The repo's rows of NAME, then the sweep directory's local-NAME's."""
    for p in (f'{T}/{name}', f'{A}/local-{name}'):
        if os.path.exists(p):
            for l in open(p):
                if not l.startswith('#') and l.strip(): yield l.rstrip('\n').split('\t')
lst = {f[1]: (float(f[0]), f[2], f[3]) for f in table('list.tsv')}
fetch = {f[0]: f for f in table('fetch.tsv')}
ZIPS = {'keepass': 'KeePass-2.57.zip', 'paintnet': 'paint.net.5.1.12.install.x64.zip', 'procexp': 'ProcessExplorer.zip', 'sysinternals': 'SysinternalsSuite.zip',
        'hxd': 'HxDSetup.zip', 'notepad2': 'Notepad2_4.2.25_x64.zip', 'depends': 'depends22_x86.zip', 'ddnet': 'DDNet-18.9-win64.zip', 'godot': 'Godot_v4.7.2-stable_win64.exe.zip', 'pencil2d': 'pencil2d-win64-v0.7.2.zip', 'luanti': 'luanti-5.18.0-win64.zip', 'cutter': 'Cutter-v2.5.0-Windows-x86_64.zip'}
RANK = {'procexp': 39, 'autoruns': 40.1, 'procmon': 40.2}
# Launch timeouts past APPSWEEP_LAUNCH's: Audacity's first start scans for plugins (a "Searching for plugins"
# dialog and Audacity.exe --host children) before its main window, which the recipe waits for.
# Thunderbird on the memory64 twin is up and waiting for input after about 2 min.
# Firefox (Gecko, on the twin): GL at 81 s and a content process at 89 s, no window in 240 s: 900 to tell slow from stuck.
# Shotcut: a 320x320 splash titled Shotcut while it loads its plugins, then "Untitled - Shotcut".
LAUNCH_T = {'audacity': 900, 'anki': 600, 'rawtherapee': 600, 'openshot': 900, 'dbeaver': 900, 'pdfsam': 900, 'thunderbird': 900, 'firefox': 900, 'seamonkey': 900, 'thonny': 600, 'deluge': 1200, 'shotcut': 600, 'pidgin': 600, 'openscad': 900}
# Settle before the usable keys past appsweep's 6 s: SuperTux and SuperTuxKart show a Loading screen for tens of
# seconds after their window (STK's keys landed on it).
# Krita: a 160x160 splash at its first window, its main window 2 to 3 min after it on a GPU.
# Transmission (Qt 6): its first paint some 10 s after its window alone, past 20 s with three runs at once.
SETTLE = {'supertuxkart': 60000, 'supertux': 45000, 'krita': 300000, 'zoom': 90000, 'doublecmd': 60000, 'mkvtoolnix': 90000, 'shotcut': 120000, 'darktable': 180000, 'scribus': 180000, 'steam': 1500000, 'transmission': 30000}
# (Zoom's window is white for 30-60 s on the page before its D3D content)
# a picture every that many seconds of a plan's settle
SHOTS = {'steam': 60}
# A program's own dialog on the way to its window: OBS's "Wine detected" (Launch Anyway at 354,153 in its
# 506x185 box).
# Ditto lives in the tray (its postinstall starts it): its clip list comes up on its hotkey, Ctrl+`
LAUNCH_STEPS = {'ditto': [{'sleep': 20}, {'ctrl': '`'}], 'obs': [{'wait': '^Wine detected$', 't': 600}, {'click': [354, 153], 'in': '^Wine detected$'}],
                # first-run boxes before the main window: LMMS's "Working directory" (create it) and MediaInfo's
                # "Preferences" (OK): a click on the title, then Enter
                'lmms': [{'wait': '^Working directory$', 't': 300}, {'click': [200, 10], 'in': '^Working directory$'}, {'key': 'Enter'}],
                # PCSX2's "Missing Font File" (download a font for this language's on-screen text?): No, with Escape
                'pcsx2': [{'wait': '^Missing Font File$', 't': 300}, {'click': [254, 10], 'in': '^Missing Font File$'}, {'key': 'Escape'}],
                'mediainfo': [{'wait': '^Preferences$', 't': 300}, {'click': [200, 10], 'in': '^Preferences$'}, {'key': 'Enter'}],
                # XnView MP's first-run Startup Wizard: its OK (the defaults)
                'xnviewmp': [{'wait': '^Startup Wizard$', 't': 300}, {'click': [201, 386], 'in': '^Startup Wizard$'}],
                # Code::Blocks' first start: "Compilers auto-detection" (its OK at 523,369 in the 577x394 box)
                'codeblocks': [{'wait': '^Compilers auto-detection$', 't': 300}, {'click': [523, 369], 'in': '^Compilers auto-detection$'}],
                # HeidiSQL's update check (online) over its session manager: Skip at 333,432 in the 400x457 box
                # once the check has said (3 s): its window is ^HeidiSQL (the box's title has it too, and the
                # sweep took the box for the program and its Escapes closed the session manager)
                'heidisql': [{'wait': '^Check for HeidiSQL updates', 't': 300}, {'sleep': 3}, {'click': [333, 432], 'in': '^Check for HeidiSQL updates'}]}
KIND = {'procexp': 'zip', 'autoruns': 'zip', 'procmon': 'zip'}
rows = []
for f in table('recipes.tsv'):
    f = f + [''] * 6
    i, drop, inst, launch, title, chk = f[:6]
    if only and i not in only: continue
    rows.append((i, drop, inst, launch, title, chk))
# A program's own interaction where the default one (Alt, Down; then letters) has nothing to act on: Krita's
# start page takes no keys; its New Image link opens the new-document dialog.
# The memory64 fallback: the first start falls short with gex's "needs 64-bit
# memory" notice, the second runs on wine.m64, and after a page reload a third goes straight to it
RESTARTS = {'firefox': {'restarts': 1, 'reload': True, 'image': 'firefox.exe'},
            'thunderbird': {'restarts': 1, 'reload': True, 'image': 'thunderbird.exe'},
            'seamonkey': {'restarts': 1, 'reload': True, 'image': 'seamonkey.exe'},
            # both outgrow the wasm32 arena on their first start (openshot 128 MiB at 0x7e370000, dbeaver's JVM 1 GiB)
            'openshot': {'restarts': 1, 'reload': True, 'image': 'openshot-qt.exe'},
            'dbeaver': {'restarts': 1, 'reload': True, 'image': 'dbeaver.exe'},
            'pdfsam': {'restarts': 1, 'reload': True, 'image': 'pdfsam.exe'}}
USE = {'krita': [{'click': [124, 200], 'in': '^Krita$'}, {'sleep': 5}],
       # MediaInfo's empty view draws nothing new on a click: its Help menu does
       'mediainfo': [{'click': [228, 25], 'in': 'MediaInfo$'}, {'sleep': 3}]}
UI = {}
for f in table('interactive.tsv'):
    UI[f[0]] = f
    if not only or f[0] in only: rows.append((f[0], f[2], None, f[7], f[8], ""))
    KIND[f[0]] = f[1] + ' (interactive)'; base = f[0][:-3]
    RANK[f[0]] = (RANK.get(base) or {'npp': 8, 'audacity': 21, 'putty': 12}.get(base, 999)) + 0.5
def host_file(drop):
    if not drop.startswith('x:'): return f'{A}/dl/{drop}'
    z, p = drop[2:].split('/', 1); d = f'{X}/{z}'
    if not os.path.isdir(d):
        os.makedirs(d); zipfile.ZipFile(f'{A}/dl/{ZIPS[z]}').extractall(d)
    return f'{d}/{p}'.rstrip('/')
def one(r):
    i, drop, inst, launch, title, chk = r
    o = f'{HOT}/{pas}/{i}'; shutil.rmtree(o, ignore_errors=True); os.makedirs(o)
    # drop: one file, or several joined by | (an installer and the program that needs it)
    try: hfs = [host_file(d) for d in drop.split('|')]
    except Exception as e: return i, {'id': i, 'drop': 'no file', 'first_error': str(e)[:200]}
    hf = hfs[0]
    if not all(os.path.exists(h) for h in hfs): return i, {'id': i, 'drop': 'no download', 'first_error': 'download failed: ' + ' '.join(fetch.get(i, ['', '?'])[1:2] + fetch.get(i, [''] * 5)[4:5])}
    m = re.search(r'start "" (?:/d "([^"]+)" (\S+)|"([^"]+\.exe)")', launch or '')
    check = (m.group(1) + '\\' + m.group(2)) if m and m.group(1) else (m.group(3) if m else None)
    # an explicit check (recipes.tsv's 6th column: a path, or cmd:COMMAND) wins over the launch's program
    if chk: check = chk
    b = i[:-3] if i in UI else i  # an interactive row takes its app's launch settings
    plan = {'check': check if inst else None, 'id': i, 'drop': hfs, 'install': inst or None, 'launch': launch or None, 'title': title or None,
            'timeout': {'install': 1500 if os.path.getsize(hf) > 100e6 else 900, 'launch': LAUNCH_T.get(b, int(os.environ.get('APPSWEEP_LAUNCH', 240)))}}
    if b in SETTLE: plan['settle'] = SETTLE[b]
    if b in SHOTS: plan['settle_shots'] = SHOTS[b]
    if b in LAUNCH_STEPS: plan['launch_steps'] = LAUNCH_STEPS[b]
    if b in USE: plan['use'] = USE[b]
    if b in RESTARTS: plan.update(RESTARTS[b])
    if i in UI:
        # Enter (after the row's alt key) every 6 s until the installer's windows are gone, 900 s at most:
        # a page that takes longer (its install running) only takes more presses
        u = UI[i]; steps = [{'wait': u[3], 't': 240}, {'sleep': 3}, {'press': 'Enter', 'until': u[4], 'every': 6, 't': 900, **({'alt': u[6]} if u[6] else {})}]
        plan.update(install=None, start=f'start "" {os.path.basename(hf)}', interactive=steps, check=None)
    json.dump(plan, open(f'{o}/plan.json', 'w'))
    env = dict(os.environ, **({'SMOKE_SPKI': os.environ['SPKI']} if os.environ.get('SPKI') else {}))
    t = time.time()
    subprocess.run(['systemd-run', '--user', '--scope', '-q', '-p', 'MemoryMax=24G', '-p', 'TasksMax=4096', 'nice', '-n', '10', 'timeout', '3000',
                    os.environ.get('NODE', 'node'), f'{TOOLS}/appsweep.mjs', url, o, f'{o}/plan.json'],
                   stdout=open(f'{o}/driver.out', 'w'), stderr=subprocess.STDOUT, env=env)
    try: res = json.load(open(f'{o}/result.json'))
    except Exception: res = {'id': i, 'notes': ['no result (driver died)'], 'first_error': open(f'{o}/driver.out').read()[-200:]}
    k = f'{A}/runs/{pas}/{i}'; shutil.rmtree(k, ignore_errors=True)
    shutil.copytree(o, k, ignore=shutil.ignore_patterns('profile')); shutil.rmtree(o, ignore_errors=True)
    print(f'{i}: {res.get("install")} {res.get("launch")} {res.get("usable")} {res.get("first_error")}', flush=True)
    return i, res
with ThreadPoolExecutor(int(os.environ.get('APPSWEEP_JOBS', '3'))) as ex:
    out = dict(ex.map(one, rows))
def rank(i): return RANK.get(i, lst.get(i, (999,))[0])
with open(f'{A}/matrix-{pas}.tsv', 'w') as m:
    m.write('rank\tid\tkind\tdownload_MB\tdrop\tinstall\tlaunches\tusable\tinstall_s\tlaunch_s\twindow\tfirst_error\n')
    for i in sorted(out, key=rank):
        r = out[i]; t = r.get('times', {})
        sz = fetch.get(i, [''] * 3)[2] if i in fetch else ''
        m.write('\t'.join(str(x) for x in [rank(i), i, KIND.get(i, lst.get(i, ('', '?'))[1]), f'{int(sz)/1e6:.1f}' if sz.isdigit() else '-',
            r.get('drop') or '-', r.get('install') or '-', r.get('launch') or '-', r.get('usable') or '-', t.get('install', ''), t.get('launch', ''),
            r.get('window', ''), (r.get('first_error') or '').replace('\t', ' ').replace('\n', ' ')[:300]]) + '\n')
print('matrix:', f'{A}/matrix-{pas}.tsv')
