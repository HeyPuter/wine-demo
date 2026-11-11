#!/usr/bin/env python3
# classic.py USER_REG SCHEME: turns the prefix's visual style off (ThemeActive 0, no DllName: Wine's classic
# drawing, which follows one scheme for frames, buttons, scrollbars and menus alike) and writes SCHEME
# (scheme.txt) as Control Panel\Colors, Desktop\WindowMetrics and flat-menus-off user preferences.
import re, struct, sys

reg_path, scheme_path = sys.argv[1:3]
sec, scheme = None, {}
for line in open(scheme_path, encoding='utf-8'):
    line = line.strip()
    if not line or line.startswith('#'): continue
    if line.startswith('['): sec = scheme.setdefault(line[1:-1], {}); continue
    k, v = line.split('=', 1); sec[k] = v

def logfont(spec):
    face, height, weight = spec.rsplit(' ', 2)
    b = struct.pack('<5i8B', int(height), 0, 0, 0, int(weight), 0, 0, 0, 1, 0, 0, 0, 0)
    return b + face.encode('utf-16-le').ljust(64, b'\0')

def hexval(b):
    return 'hex:' + ','.join(f'{x:02x}' for x in b)

s = open(reg_path, encoding='utf-8').read()

def section(name):
    """(start, end) of the values of [name] in s, made if missing"""
    global s
    m = re.search(r'^\[' + re.escape(name.replace('\\', '\\\\')) + r'\][^\n]*\n', s, re.M)
    if not m:
        s = s.rstrip('\n') + f'\n\n[{name.replace(chr(92), chr(92) * 2)}]\n'
        m = re.search(r'^\[' + re.escape(name.replace('\\', '\\\\')) + r'\][^\n]*\n', s, re.M)
    e = s.find('\n\n', m.end())
    return m.end(), (len(s) if e < 0 else e)

def put(name, values, drop=()):
    """set values ({name: 'raw reg value'}) in [name], removing the names in drop"""
    global s
    i, j = section(name)
    body = s[i:j]
    # one entry per value: its line plus continuation lines
    entries = re.findall(r'^(?:#.*|"(?:[^"\\]|\\.)*"=(?:[^\n]*\\\n)*[^\n]*)$', body, re.M)
    keep = []
    for e in entries:
        m = re.match(r'"((?:[^"\\]|\\.)*)"=', e)
        if m and (m.group(1) in values or m.group(1) in drop): continue
        keep.append(e)
    keep += [f'"{k}"={v}' for k, v in values.items()]
    s = s[:i] + '\n'.join(keep) + s[j:]

tm = r'Software\Microsoft\Windows\CurrentVersion\ThemeManager'
put(tm, {'ThemeActive': '"0"'}, drop=('DllName', 'ColorName', 'SizeName', 'NonClientMetrics', 'IconTitleFont', 'LoadedBefore'))
put(r'Control Panel\Colors', {k: f'"{v}"' for k, v in scheme['Colors'].items()})
wm = {k: f'"{v}"' for k, v in scheme['Metrics'].items()}
wm.update({k: hexval(logfont(v)) for k, v in scheme['Fonts'].items()})
put(r'Control Panel\Desktop\WindowMetrics', wm)
# gradient captions on; flat menus, menu and selection fades, drop shadows off
put(r'Control Panel\Desktop', {'UserPreferencesMask': hexval(bytes([0x10, 0, 0, 0x80, 0x12, 0, 0, 0]))})
open(reg_path, 'w', encoding='utf-8').write(s)
print(f'classic: {len(scheme["Colors"])} colors, {len(wm)} metrics into {reg_path}')
