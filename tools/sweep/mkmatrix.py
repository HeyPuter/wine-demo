#!/usr/bin/env python3
# mkmatrix.py OUT PASS... : one row per app from WD_SWEEP/runs/PASS/ID/result.json, a later PASS's row replacing
# an earlier one's, ranked as list.tsv; the verdict column says pass, fail, or why a row is not counted.
#
# The verdicts that are decisions, not results, are the sweep directory's (WD_SWEEP/verdicts.tsv, off the repo):
#   ID  unsupported  TEXT   decided: nobody works on it
#   ID  blocked      TEXT   waits on a named fix (while the row does not pass)
#   ID  note         TEXT   said beside the row
#   ID  x64cr        TEXT   TEXT when the row stops at gex's address-space message (x64 Electron/Chromium)
#   PASS gpu-pass    TEXT   a pass run on a GPU: its passes say so, with TEXT
# MATRIX_SITE: a line naming the site, written first.
import json, os, sys
T = os.path.dirname(os.path.abspath(__file__))
A = os.environ.get('WD_SWEEP') or sys.exit('mkmatrix.py: WD_SWEEP, the sweep directory, is not set')
out, passes = sys.argv[1], sys.argv[2:]
def table(name):
    """The repo's rows of NAME, then the sweep directory's local-NAME's; verdicts.tsv is the directory's alone."""
    for p in (f'{A}/{name}',) if name == 'verdicts.tsv' else (f'{T}/{name}', f'{A}/local-{name}'):
        if os.path.exists(p):
            for l in open(p):
                if not l.startswith('#') and l.strip(): yield l.rstrip('\n').split('\t')
lst = {f[1]: (float(f[0]), f[2], f[3]) for f in table('list.tsv')}
fetch = {f[0]: f for f in table('fetch.tsv')}
RANK = {'procexp': 39, 'autoruns': 40.1, 'procmon': 40.2}
V = {}
for f in table('verdicts.tsv'):
    V.setdefault(f[1], {})[f[0]] = f[2] if len(f) > 2 else ''
UNSUP, BLOCKED, NOTES, X64CR, GPU = (V.get(k, {}) for k in ('unsupported', 'blocked', 'note', 'x64cr', 'gpu-pass'))
rows = {}
for p in passes:
    d = f'{A}/runs/{p}'
    if not os.path.isdir(d): continue
    for i in os.listdir(d):
        f = f'{d}/{i}/result.json'
        if os.path.exists(f):
            r = json.load(open(f)); r['pass'] = p; rows[i] = r
ASPACE = 'needs more than 16 GiB of address space'
def says_aspace(r):
    if ASPACE in (r.get('first_error') or ''): return True
    c = f"{A}/runs/{r['pass']}/{r['id']}/console.txt"
    return os.path.exists(c) and ASPACE in open(c, errors='replace').read()
def verdict(i, r):
    if i in UNSUP: return UNSUP[i]
    if i in X64CR and says_aspace(r): return X64CR[i]
    if i in BLOCKED and r.get('usable') != 'ok': return BLOCKED[i]
    if r.get('wrong_dir'): return f'blocked: x64 install under {r["wrong_dir"]}'
    if r['pass'] in GPU and r.get('usable') == 'ok': return f"pass (GPU leg {r['pass']}: {GPU[r['pass']]})"
    # a row with no launch line passes on its install alone; one the sweep started (or killed before its launch
    # was judged) does not
    started = r.get('starts') or any('killed' in n for n in r.get('notes') or [])
    if r.get('usable') == 'ok' or ((r.get('install') or '').startswith('ok') and not r.get('launch') and not r.get('first_error') and not started): return 'pass'
    if (r.get('install') or '').startswith('ok') and r.get('launch') == 'ok': return 'partial (launches, interaction failed)'
    return 'fail'
def rank(i): return RANK.get(i, lst.get(i, (999,))[0])
with open(out, 'w') as m:
    if os.environ.get('MATRIX_SITE'): m.write(f"# {os.environ['MATRIX_SITE']}\n")
    m.write('rank\tid\tkind\tdownload_MB\tverdict\tdrop\tinstall\tlaunches\tusable\tinstall_s\tlaunch_s\twindow\tfirst_error\tpass\tnotes\n')
    for i in sorted(rows, key=rank):
        r = rows[i]; t = r.get('times', {})
        sz = fetch[i][2] if i in fetch and len(fetch[i]) > 2 else ''
        m.write('\t'.join(str(x) for x in [rank(i), i, lst.get(i, ('', '?'))[1], f'{int(sz)/1e6:.1f}' if sz.isdigit() else '-', verdict(i, r),
            r.get('drop') or '-', r.get('install') or '-', r.get('launch') or '-', r.get('usable') or '-', t.get('install', ''), t.get('launch', ''),
            r.get('window', ''), (r.get('first_error') or '').replace('\t', ' ').replace('\n', ' ')[:300], r['pass'], NOTES.get(i, '')]) + '\n')
print(out, len(rows), 'rows')
