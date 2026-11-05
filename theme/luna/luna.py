#!/usr/bin/env python3
# luna.py AERO_DIR OUT: windemo's Luna-style visual style, drawn here as SVG (nothing taken from any other
# theme's pictures). Wine's aero.msstyles (LGPL, AERO_DIR: its aero.rc and bitmaps) is the skeleton: the same
# classes, parts, states and bitmap sizes, so its SizingMargins and ImageCounts hold. For every bitmap this
# file draws, OUT/svg/NAME.svg (NAME.bmp's size: the states stacked vertically); OUT/luna.rc is aero.rc with
# this theme's name, colors and metrics. build.sh renders the SVGs and builds luna.msstyles.
import os, re, struct, sys

AERO, OUT = sys.argv[1], sys.argv[2]
os.makedirs(f'{OUT}/svg', exist_ok=True)


def dims(name):
    with open(f'{AERO}/{name}', 'rb') as f:
        b = f.read(26)
    return struct.unpack('<ii', b[18:26])


# ---------------------------------------------------------------- drawing helpers
class Sheet:
    """One bitmap: `n` cells of w x ch stacked vertically, drawn into one SVG."""

    def __init__(self, w, h, n):
        self.w, self.h, self.n, self.ch = w, h, n, h / n
        self.defs, self.body, self.k = [], [], 0

    def grad(self, stops, x1=0, y1=0, x2=0, y2=1):
        self.k += 1
        gid = f'g{self.k}'
        s = ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
        self.defs.append(f'<linearGradient id="{gid}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{s}</linearGradient>')
        return f'url(#{gid})'

    def rgrad(self, stops, cx=.5, cy=.5, r=.5, fx=None, fy=None):
        self.k += 1
        gid = f'g{self.k}'
        s = ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
        self.defs.append(f'<radialGradient id="{gid}" cx="{cx}" cy="{cy}" r="{r}" fx="{fx if fx is not None else cx}" fy="{fy if fy is not None else cy}">{s}</radialGradient>')
        return f'url(#{gid})'

    def add(self, i, svg):
        self.body.append(f'<g transform="translate(0 {i * self.ch})">{svg}</g>')

    def svg(self):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">'
                f'<defs>{"".join(self.defs)}</defs>{"".join(self.body)}</svg>')


def rect(x, y, w, h, fill, rx=0, stroke=None, sw=1, extra=''):
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
    return f'<rect x="{x}" y="{y}" width="{max(w, 0)}" height="{max(h, 0)}" rx="{rx}" fill="{fill}"{st} {extra}/>'


def path(d, fill='none', stroke=None, sw=1, extra=''):
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
    return f'<path d="{d}" fill="{fill}"{st} {extra}/>'


written = []


def emit(name, sheet):
    with open(f'{OUT}/svg/{name[:-4]}.svg', 'w') as f:
        f.write(sheet.svg())
    written.append(name)


# ---------------------------------------------------------------- palette
BLUE_DARK = '#0831d9'      # window edge
CAP_ACTIVE = [(0, '#0997ff'), (.08, '#0053ee'), (.4, '#0050ee'), (.88, '#0066ff'), (1, '#0055e5')]
CAP_INACTIVE = [(0, '#a6caf0'), (.08, '#7b9fe4'), (.4, '#7a96df'), (.88, '#8eabe9'), (1, '#7c98dd')]
FRAME_ACTIVE = '#0841d8'
FRAME_INACTIVE = '#7d96de'
FACE = '#ece9d8'
EDGE = '#003c74'           # push button / box border
TRACK = '#f3f1ec'
SCROLL_FACE = [(0, '#c8d6fb'), (1, '#b8cbf9')]
SCROLL_HOT = [(0, '#daf0ff'), (1, '#c4dcfe')]
SCROLL_PRESSED = [(0, '#a8c0f2'), (1, '#9db6ef')]
SCROLL_EDGE = '#9eb5ec'
SCROLL_GLYPH = '#4d6185'


# ---------------------------------------------------------------- window
def caption(name, small=False):
    w, h = dims(name)
    s = Sheet(w, h, 2)
    ch = s.ch
    for i, stops in enumerate((CAP_ACTIVE, CAP_INACTIVE)):
        g = s.grad(stops)
        r = 3 if small else 7
        edge = BLUE_DARK if i == 0 else '#8ca4e2'
        # the rounded top; the bottom runs on under the frame
        s.add(i, rect(0, 0, w, ch + r, edge, rx=r) + rect(1, 1, w - 2, ch + r, g, rx=r - 1)
              + rect(1.5, 1.5, w - 3, 1, '#ffffff', extra='opacity=".35"'))
    emit(name, s)


def caption_flat(name):
    """MinCaption / MaxCaption: the caption with no rounding (a maximized or minimized window)."""
    w, h = dims(name)
    s = Sheet(w, h, 2)
    for i, stops in enumerate((CAP_ACTIVE, CAP_INACTIVE)):
        s.add(i, rect(0, 0, w, s.ch, s.grad(stops)))
    emit(name, s)


def frame(name, small=False):
    w, h = dims(name)
    s = Sheet(w, h, 2)
    side = 'left' in name or 'right' in name
    for i, c in enumerate((FRAME_ACTIVE, FRAME_INACTIVE)):
        dark = BLUE_DARK if i == 0 else '#8ca4e2'
        if side:
            g = s.grad([(0, dark), (.3, c), (.7, c), (1, dark)], 0, 0, 1, 0)
        else:
            g = s.grad([(0, c), (.6, c), (1, dark)])
        s.add(i, rect(0, 0, w, s.ch, g))
    emit(name, s)


# caption buttons: 8 cells: normal, hot, pressed, disabled (active window), then the same, inactive window
def cap_button_bg(name, close=False):
    w, h = dims(name)
    s = Sheet(w, h, 8)
    ch = s.ch
    for i in range(8):
        st, inactive = i % 4, i >= 4
        if close:
            stops = [[(0, '#f0896b'), (.5, '#e2532c'), (1, '#c63a14')], [(0, '#ffb39c'), (.5, '#f2734d'), (1, '#d9502a')],
                     [(0, '#c23b16'), (1, '#d9653f')], [(0, '#e7b3a5'), (1, '#d99a89')]][st]
        else:
            stops = [[(0, '#5a8ff8'), (.5, '#2e6bf1'), (1, '#1d58e3')], [(0, '#8db7ff'), (.5, '#4f88f9'), (1, '#3470ee')],
                     [(0, '#1a4fc9'), (1, '#3b70e6')], [(0, '#9fb6e8'), (1, '#8ea7e2')]][st]
        if inactive:
            stops = [(o, mix(c, '#c4d2f2', .55)) for o, c in stops]
        s.add(i, rect(.5, .5, w - 1, ch - 1, s.grad(stops), rx=3, stroke='#ffffff' if not inactive else '#e8eefc', sw=1))
    emit(name, s)


def mix(a, b, t):
    pa = [int(a[k:k + 2], 16) for k in (1, 3, 5)]
    pb = [int(b[k:k + 2], 16) for k in (1, 3, 5)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(pa, pb))


def cap_glyph(name, kind):
    w, h = dims(name)
    n = 8 if 'small' not in name else 8
    s = Sheet(w, h, n)
    z = w / 13.0
    for i in range(n):
        st, inactive = i % 4, i >= 4
        col = '#ffffff' if st != 3 else '#d6e0f5'
        if inactive and st != 3:
            col = '#f2f5fd'
        t = max(1, round(2 * z))
        if kind == 'min':
            g = rect(round(3 * z), round(8.5 * z), round(5 * z), t, col)
        elif kind == 'max':
            x0, y0, sz = round(2.5 * z), round(2.5 * z), round(8 * z)
            g = rect(x0, y0, sz, sz, 'none', stroke=col, sw=max(1, round(z))) + rect(x0, y0, sz, t + max(1, round(z)) - 1, col)
        elif kind == 'restore':
            sz = round(6 * z)
            a = rect(round(4.5 * z), round(1.5 * z), sz, sz, 'none', stroke=col, sw=max(1, round(z))) + rect(round(4.5 * z), round(1.5 * z), sz, t, col)
            b = rect(round(1.5 * z), round(4.5 * z), sz, sz, '#3b74ee' if not inactive else '#a9bdee', stroke=col, sw=max(1, round(z))) + rect(round(1.5 * z), round(4.5 * z), sz, t, col)
            g = a + b
        elif kind == 'close':
            sw = max(1.5, 2.2 * z)
            g = path(f'M{3 * z} {3 * z}L{10 * z} {10 * z}M{10 * z} {3 * z}L{3 * z} {10 * z}', stroke=col, sw=sw, extra='stroke-linecap="round"')
        else:  # help
            g = (path(f'M{4 * z} {4.5 * z}C{4 * z} {1.5 * z} {9.5 * z} {1.5 * z} {9.5 * z} {4.5 * z}C{9.5 * z} {6.5 * z} {6.5 * z} {6.5 * z} {6.5 * z} {8.5 * z}',
                      stroke=col, sw=max(1.3, 1.8 * z), extra='stroke-linecap="round"')
                 + rect(5.6 * z, 10 * z, 1.8 * z, 1.8 * z, col))
        s.add(i, g)
    emit(name, s)


# ---------------------------------------------------------------- buttons
def push_button(name):
    w, h = dims(name)
    s = Sheet(w, h, 6)  # normal, hot, pressed, disabled, defaulted, defaulted-animating
    ch = s.ch
    for i in range(6):
        face = [(0, '#ffffff'), (.85, '#f0f0ea'), (1, '#d6d0c5')]
        edge, inner = EDGE, None
        if i == 1:
            inner = [(0, '#fff0cf'), (.5, '#fcd281'), (1, '#e5a43a')]
        elif i == 2:
            face = [(0, '#e2e1d9'), (1, '#efeee7')]
        elif i == 3:
            face = [(0, '#f5f4ea'), (1, '#f5f4ea')]
            edge = '#c9c7ba'
        elif i in (4, 5):
            inner = [(0, '#cee7ff'), (.5, '#97bff0'), (1, '#6182d6')]
        g = rect(.5, .5, w - 1, ch - 1, s.grad(face), rx=3, stroke=edge)
        if inner:
            g += rect(1.5, 1.5, w - 3, ch - 3, 'none', rx=2, stroke=s.grad(inner), sw=2)
            g += rect(3, 3, w - 6, ch - 6, s.grad(face), rx=1)
        s.add(i, g)
    emit(name, s)


def checkbox(name):
    w, h = dims(name)
    s = Sheet(w, h, 20)  # unchecked, checked, mixed, implicit, excluded: normal, hot, pressed, disabled each
    z = w / 13.0
    for i in range(20):
        kind, st = i // 4, i % 4
        box = [(0, '#dcdcd7'), (1, '#ffffff')] if st != 2 else [(0, '#b0b0a7'), (1, '#e3e1d6')]
        edge = '#1c5180' if st != 3 else '#cac8bb'
        g = rect(.5, .5, w - 1, w - 1, s.grad(box, 0, 0, 1, 1), stroke=edge)
        if st == 1:
            g += rect(1.5, 1.5, w - 3, w - 3, 'none', stroke=s.grad([(0, '#fff0cf'), (1, '#f8b330')], 0, 0, 1, 1), sw=max(1, round(1.5 * z)))
        ink = '#21a121' if st != 3 else '#cac8bb'
        if kind == 1 or kind == 3:
            g += path(f'M{3 * z} {6.5 * z}L{5.5 * z} {9 * z}L{10 * z} {3.5 * z}', stroke=ink, sw=max(1.5, 2 * z), extra='stroke-linejoin="round"')
        elif kind == 2:
            g += rect(3 * z, 3 * z, 7 * z, 7 * z, ink)
        elif kind == 4:
            g += path(f'M{3.5 * z} {3.5 * z}L{9.5 * z} {9.5 * z}M{9.5 * z} {3.5 * z}L{3.5 * z} {9.5 * z}', stroke='#c3402a' if st != 3 else '#cac8bb', sw=max(1.5, 2 * z))
        s.add(i, g)
    emit(name, s)


def radio(name):
    w, h = dims(name)
    s = Sheet(w, h, 8)  # unchecked n/h/p/d, checked n/h/p/d
    c = w / 2
    for i in range(8):
        on, st = i >= 4, i % 4
        fill = s.rgrad([(0, '#ffffff'), (1, '#dcdcd7')] if st != 2 else [(0, '#e3e1d6'), (1, '#b0b0a7')], .35, .35, .7)
        edge = '#1c5180' if st != 3 else '#cac8bb'
        g = f'<circle cx="{c}" cy="{c}" r="{c - .5}" fill="{fill}" stroke="{edge}"/>'
        if st == 1:
            g += f'<circle cx="{c}" cy="{c}" r="{c - 1.8}" fill="none" stroke="#f8b330" stroke-width="{max(1, w / 10)}"/>'
        if on:
            dot = s.rgrad([(0, '#7deb7d'), (1, '#1ea21e')] if st != 3 else [(0, '#d9d7cc'), (1, '#cac8bb')], .35, .35, .7)
            g += f'<circle cx="{c}" cy="{c}" r="{w * .22}" fill="{dot}"/>'
        s.add(i, g)
    emit(name, s)


def groupbox(name):
    w, h = dims(name)
    s = Sheet(w, h, 1)
    s.add(0, rect(.5, .5, w - 1, h - 1, 'none', rx=3, stroke='#d0d0bf'))
    emit(name, s)


# ---------------------------------------------------------------- scrollbar
def scroll_face(s, i, st, w, ch, horizontal=False):
    stops = [SCROLL_FACE, SCROLL_HOT, SCROLL_PRESSED, [(0, '#eeede5'), (1, '#eeede5')], SCROLL_HOT][st]
    g = s.grad(stops, 0, 0, 0 if horizontal else 1, 1 if horizontal else 0)
    edge = SCROLL_EDGE if st != 3 else '#e2e0d6'
    return rect(.5, .5, w - 1, ch - 1, g, rx=2, stroke=edge)


def scroll_arrows(name):
    w, h = dims(name)
    s = Sheet(w, h, 20)  # up, down, left, right: normal, hot, pressed, disabled, hover
    for i in range(20):
        s.add(i, rect(0, 0, w, s.ch, TRACK) + scroll_face(s, i, i % 5, w, s.ch, i >= 10))
    emit(name, s)


def scroll_arrow_glyphs(name):
    w, h = dims(name)
    s = Sheet(w, h, 20)
    z = w / 13.0
    for i in range(20):
        d, st = i // 5, i % 5
        col = SCROLL_GLYPH if st != 3 else '#c9c8c0'
        pts = {0: [(3.5, 8), (6.5, 5), (9.5, 8)], 1: [(3.5, 5), (6.5, 8), (9.5, 5)],
               2: [(8, 3.5), (5, 6.5), (8, 9.5)], 3: [(5, 3.5), (8, 6.5), (5, 9.5)]}[d]
        p = 'M' + 'L'.join(f'{x * z} {y * z}' for x, y in pts)
        s.add(i, path(p, stroke=col, sw=max(1.6, 2 * z), extra='stroke-linecap="square" stroke-linejoin="miter"'))
    emit(name, s)


def scroll_thumb(name):
    w, h = dims(name)
    s = Sheet(w, h, 5)
    for i in range(5):
        s.add(i, scroll_face(s, i, i, w, s.ch, 'horizontal' in name))
    emit(name, s)


def scroll_gripper(name):
    w, h = dims(name)
    s = Sheet(w, h, 5)
    horizontal = 'horizontal' in name
    for i in range(5):
        g = ''
        n = 4
        for k in range(n):
            if horizontal:
                x = 1 + k * (w - 2) / n
                g += rect(round(x), 1, 1, s.ch - 2, '#eef4fe') + rect(round(x) + 1, 1, 1, s.ch - 2, '#8cb0f8')
            else:
                y = 1 + k * (s.ch - 2) / n
                g += rect(1, round(y), w - 2, 1, '#eef4fe') + rect(1, round(y) + 1, w - 2, 1, '#8cb0f8')
        s.add(i, g)
    emit(name, s)


def scroll_track(name):
    w, h = dims(name)
    s = Sheet(w, h, 5)
    horizontal = 'horizontal' in name
    for i in range(5):
        c = [TRACK, '#eae8e0', '#bfbdb3', '#f7f6f2', '#eae8e0'][i]
        g = s.grad([(0, '#eeede5'), (.5, c), (1, '#f8f7f3')], 0, 0, 0 if horizontal else 1, 1 if horizontal else 0)
        s.add(i, rect(0, 0, w, s.ch, g))
    emit(name, s)


# ---------------------------------------------------------------- tabs
def tab_item(name):
    w, h = dims(name)
    s = Sheet(w, h, 5)  # normal, hot, selected, disabled, focused
    ch = s.ch
    for i in range(5):
        face = [(0, '#ffffff'), (1, '#ecebe5')] if i != 2 else [(0, '#ffffff'), (1, '#fcfcfe')]
        g = rect(.5, .5, w - 1, ch + 2, s.grad(face), rx=2, stroke='#919b9c')
        if i == 1 or i == 2 or i == 4:
            g += rect(.5, .5, w - 1, 2.5, '#ffc83c' if i != 2 else '#e68b2c', rx=1.5)
        if i == 3:
            g = rect(.5, .5, w - 1, ch + 2, '#f4f3ee', rx=2, stroke='#c9c7ba')
        s.add(i, g)
    emit(name, s)


def tab_pane(name):
    w, h = dims(name)
    s = Sheet(w, h, 1)
    s.add(0, rect(.5, .5, w - 1, h - 1, '#fcfcfe', stroke='#919b9c'))
    emit(name, s)


def tab_body(name):
    w, h = dims(name)
    s = Sheet(w, h, 1)
    s.add(0, rect(0, 0, w, h, s.grad([(0, '#fcfcfe'), (1, '#f4f3ee')])))
    emit(name, s)


# ---------------------------------------------------------------- edit, combobox
def edit_border(name):
    w, h = dims(name)
    s = Sheet(w, h, 4)  # normal, hot, focused, disabled
    for i in range(4):
        edge = ['#7f9db9', '#5c7fb1', '#3c6fb4', '#c9c7ba'][i]
        s.add(i, rect(.5, .5, w - 1, s.ch - 1, '#ffffff' if i != 3 else '#f5f4ea', stroke=edge))
    emit(name, s)


def combo_button(name):
    w, h = dims(name)
    s = Sheet(w, h, 4)  # normal, hot, pressed, disabled
    for i in range(4):
        stops = [[(0, '#c1d3fb'), (1, '#a7c0f4')], [(0, '#dcebff'), (1, '#bcd4fd')], [(0, '#8fadeb'), (1, '#a5bff2')], [(0, '#eeede5'), (1, '#eeede5')]][i]
        s.add(i, rect(.5, .5, w - 1, s.ch - 1, s.grad(stops), rx=2, stroke='#b9cdf5' if i != 3 else '#e2e0d6'))
    emit(name, s)


def combo_glyph(name):
    w, h = dims(name)
    s = Sheet(w, h, 4)
    ch = s.ch
    for i in range(4):
        col = SCROLL_GLYPH if i != 3 else '#c9c8c0'
        cx, cy, k = w / 2, ch / 2, min(w, ch) * .28
        s.add(i, path(f'M{cx - k} {cy - k / 2}L{cx} {cy + k / 2}L{cx + k} {cy - k / 2}', stroke=col, sw=max(1.6, min(w, ch) / 6)))
    emit(name, s)


def combo_border(name):
    edge_sheet = name
    edit_border(edge_sheet)


# ---------------------------------------------------------------- toolbar
def toolbar_buttons(name):
    w, h = dims(name)
    s = Sheet(w, h, 8)  # normal, hot, pressed, disabled, checked, hot-checked, nearhot, other-side-hot
    for i in range(8):
        if i in (0, 3):
            g = ''
        elif i in (1, 6, 7):
            g = rect(.5, .5, w - 1, s.ch - 1, s.grad([(0, '#fefefd'), (1, '#e9e7df')]), rx=3, stroke='#cecec3')
        elif i == 2:
            g = rect(.5, .5, w - 1, s.ch - 1, s.grad([(0, '#dddcd5'), (1, '#f2f1eb')]), rx=3, stroke='#9d9d92')
        else:
            g = rect(.5, .5, w - 1, s.ch - 1, s.grad([(0, '#ffffff'), (1, '#f2f1ec')]), rx=3, stroke='#a8a89f')
        s.add(i, g)
    emit(name, s)


# ---------------------------------------------------------------- menus
def menu_bar_background(name):
    w, h = dims(name)
    s = Sheet(w, h, 2)
    for i in range(2):
        s.add(i, rect(0, 0, w, s.ch, FACE))
    emit(name, s)


def menu_bar_item(name):
    w, h = dims(name)
    s = Sheet(w, h, 6)  # normal, hot, pushed, disabled, disabled-hot, disabled-pushed
    for i in range(6):
        s.add(i, rect(0, 0, w, s.ch, '#316ac5') if i in (1, 2) else '')
    emit(name, s)


def menu_popup_item(name):
    w, h = dims(name)
    s = Sheet(w, h, 4)  # normal, hot, disabled, disabled-hot
    for i in range(4):
        s.add(i, rect(0, 0, w, s.ch, '#316ac5') if i == 1 else '')
    emit(name, s)


# ---------------------------------------------------------------- the taskbar (explorer's Start::Button,
# TaskBand::Toolbar, Taskbar and TrayNotify classes; aero has none, so these bitmaps and sections are new)
EXTRA = {}


def extra(name, w, h, n, fn, section):
    s = Sheet(w, h * n, n)
    for i in range(n):
        s.add(i, fn(s, i, w, h))
    with open(f'{OUT}/svg/{name[:-4]}.svg', 'w') as f:
        f.write(s.svg())
    written.append(name)
    EXTRA[name] = section


def start_button(s, i, w, h):
    stops = [[(0, '#3c9a3c'), (.12, '#5cc55c'), (.5, '#2f9a2f'), (1, '#287f28')],
             [(0, '#4aac4a'), (.12, '#74d874'), (.5, '#3cae3c'), (1, '#2f912f')],
             [(0, '#1f6e1f'), (.5, '#287f28'), (1, '#3a9a3a')],
             [(0, '#8fbf8f'), (1, '#7aa87a')],
             [(0, '#3c9a3c'), (.12, '#5cc55c'), (.5, '#2f9a2f'), (1, '#287f28')]][i]
    r = h / 2
    d = f'M0 0H{w - r}A{r} {r} 0 0 1 {w} {r}V{h - r * .4}Q{w} {h} {w - r * .4} {h}H0Z'
    return path(d, fill=s.grad(stops)) + path(f'M0 1.5H{w - r}', stroke='#ffffff', sw=1, extra='opacity=".35"') \
        + path(d, stroke='#1d5f1d', sw=1, extra='opacity=".6"')


def band_button(s, i, w, h):
    # normal, hot, pressed, disabled, checked (the active window), hot-checked, nearhot, other-side-hot
    stops = {0: [(0, '#5a9cf7'), (.15, '#3c81f3'), (1, '#2a6ce6')], 1: [(0, '#79b3ff'), (.15, '#5395ff'), (1, '#3d7fef')],
             2: [(0, '#1b4fb5'), (1, '#2b62cc')], 3: [(0, '#7d9fe0'), (1, '#6f92d8')], 4: [(0, '#1b4fb5'), (1, '#2558c4')],
             5: [(0, '#2a61c8'), (1, '#3168d2')], 6: [(0, '#79b3ff'), (1, '#3d7fef')], 7: [(0, '#79b3ff'), (1, '#3d7fef')]}[i]
    edge = '#1a3f8f' if i in (2, 4, 5) else '#2556c6'
    return rect(.5, .5, w - 1, h - 1, s.grad(stops), rx=3, stroke=edge)


def taskbar_bg(s, i, w, h):
    return rect(0, 0, w, h, s.grad([(0, '#3168d5'), (.05, '#4993e6'), (.12, '#2157d7'), (.85, '#2663e0'), (1, '#1941a5')]))


def tray_bg(s, i, w, h):
    return rect(0, 0, w, h, s.grad([(0, '#0c59b9'), (.05, '#1ca2ef'), (.15, '#1188e7'), (.85, '#1196ea'), (1, '#095bc9')])) \
        + rect(0, 0, 1, h, '#0e4ec0') + rect(1, 0, 1, h, '#5ab6f4')


extra('luna_start_button.bmp', 64, 30, 5, start_button,
      '"[Start::Button.Pushbutton]\\r\\n" "BgType = ImageFile\\r\\n" "ImageFile = luna_start_button.bmp\\r\\n" "ImageCount = 5\\r\\n"'
      ' "ImageLayout = Vertical\\r\\n" "SizingType = Stretch\\r\\n" "SizingMargins = 4, 16, 4, 4\\r\\n" "ContentMargins = 6, 12, 2, 2\\r\\n"'
      ' "Transparent = True\\r\\n" "TextColor = 255 255 255\\r\\n" "Font = Tahoma, 11, bold, italic\\r\\n"')
extra('luna_taskband_button.bmp', 32, 24, 8, band_button,
      '"[TaskBand::Toolbar.Button]\\r\\n" "BgType = ImageFile\\r\\n" "ImageFile = luna_taskband_button.bmp\\r\\n" "ImageCount = 8\\r\\n"'
      ' "ImageLayout = Vertical\\r\\n" "SizingType = Stretch\\r\\n" "SizingMargins = 4, 4, 4, 4\\r\\n" "ContentMargins = 4, 4, 2, 2\\r\\n"'
      ' "Transparent = True\\r\\n" "TextColor = 255 255 255\\r\\n" "Font = Tahoma, 8\\r\\n"')
extra('luna_taskbar.bmp', 4, 30, 1, taskbar_bg,
      '"[Taskbar.BackgroundBottom]\\r\\n" "BgType = ImageFile\\r\\n" "ImageFile = luna_taskbar.bmp\\r\\n" "ImageCount = 1\\r\\n"'
      ' "SizingType = Stretch\\r\\n" "SizingMargins = 0, 0, 0, 0\\r\\n"')
extra('luna_traynotify.bmp', 8, 30, 1, tray_bg,
      '"[TrayNotify.Background]\\r\\n" "BgType = ImageFile\\r\\n" "ImageFile = luna_traynotify.bmp\\r\\n" "ImageCount = 1\\r\\n"'
      ' "SizingType = Stretch\\r\\n" "SizingMargins = 3, 0, 0, 0\\r\\n" "TextColor = 255 255 255\\r\\n"')


# ---------------------------------------------------------------- the table
RULES = [
    (r'blue_window_(caption|caption_sizing_template)\.bmp', lambda n: caption(n)),
    (r'blue_window_small_(caption|caption_sizing_template)\.bmp', lambda n: caption(n, True)),
    (r'blue_window_(min|max)_caption\.bmp', caption_flat),
    (r'blue_window_(small_)?frame_(left|right|bottom)\.bmp', frame),
    (r'blue_window_close_button_background\.bmp', lambda n: cap_button_bg(n, True)),
    (r'blue_window_small_close_button_background\.bmp', lambda n: cap_button_bg(n, True)),
    (r'blue_window_(min|max|restore|help)_button_background\.bmp', cap_button_bg),
    (r'blue_window_(min|max|restore|close|help)_button_glyph_\d+px\.bmp', lambda n: cap_glyph(n, re.search(r'window_(\w+?)_button', n).group(1))),
    (r'blue_window_small_close_button_glyph\.bmp', lambda n: cap_glyph(n, 'close')),
    (r'blue_button\.bmp', push_button),
    (r'blue_checkbox_\d+px\.bmp', checkbox),
    (r'blue_radiobutton_\d+px\.bmp', radio),
    (r'blue_groupbox\.bmp', groupbox),
    (r'blue_scrollbar_arrows\.bmp', scroll_arrows),
    (r'blue_scrollbar_arrow_glyphs_\d+px\.bmp', scroll_arrow_glyphs),
    (r'blue_scrollbar_thumb_(horizontal|vertical)\.bmp', scroll_thumb),
    (r'blue_scrollbar_gripper_(horizontal|vertical)_\d+px\.bmp', scroll_gripper),
    (r'blue_scrollbar_(lower|upper)_track_(horizontal|vertical)\.bmp', scroll_track),
    (r'blue_tab_item(_left|_right)?\.bmp', tab_item),
    (r'blue_tab_pane_edge\.bmp', tab_pane),
    (r'blue_tab_background\.bmp', tab_body),
    (r'blue_edit_border_\w+\.bmp', edit_border),
    (r'blue_combobox_border\.bmp', edit_border),
    (r'blue_combobox_(dropdownbutton|readonly)(_left|_right)?\.bmp', combo_button),
    (r'blue_combobox_dropdownbutton(_left|_right)?_glyph_\d+px\.bmp', combo_glyph),
    (r'blue_toolbar_buttons(_split|_split_dropdown)?\.bmp', toolbar_buttons),
    (r'blue_menu_bar_background\.bmp', menu_bar_background),
    (r'blue_menu_bar_item\.bmp', menu_bar_item),
    (r'blue_menu_popup_item\.bmp', menu_popup_item),
]

for f in sorted(os.listdir(AERO)):
    if not f.endswith('.bmp'):
        continue
    for pat, fn in RULES:
        if re.fullmatch(pat, f):
            fn(f)
            break

# ---------------------------------------------------------------- the rc
rc = open(f'{AERO}/aero.rc', encoding='utf-8').read()
rc = rc.replace('"DisplayName = Aero\\r\\n"', '"DisplayName = Luna (windemo)\\r\\n"').replace('"ToolTip = Aero Visual Style\\r\\n"', '"ToolTip = windemo\'s Luna-style visual style\\r\\n"')
COLORS = {
    'Scrollbar': '212 208 200', 'Background': '0 78 152', 'ActiveCaption': '0 84 227', 'InactiveCaption': '122 150 223',
    'Menu': '255 255 255', 'Window': '255 255 255', 'WindowFrame': '0 0 0', 'MenuText': '0 0 0', 'WindowText': '0 0 0',
    'CaptionText': '255 255 255', 'ActiveBorder': '212 208 200', 'InactiveBorder': '212 208 200', 'AppWorkSpace': '128 128 128',
    'Highlight': '49 106 197', 'HighlightText': '255 255 255', 'BtnFace': '236 233 216', 'BtnShadow': '172 168 153',
    'GrayText': '172 168 153', 'BtnText': '0 0 0', 'InactiveCaptionText': '216 228 248', 'BtnHighlight': '255 255 255',
    'DkShadow3d': '113 111 100', 'Light3d': '241 239 226', 'InfoText': '0 0 0', 'InfoBk': '255 255 225',
    'ButtonAlternateFace': '181 181 181', 'HotTracking': '0 0 128', 'GradientActiveCaption': '61 149 255',
    'GradientInactiveCaption': '157 185 235', 'MenuHilight': '49 106 197', 'MenuBar': '236 233 216',
}
for k, v in COLORS.items():
    rc = re.sub(rf'"{k} = [0-9 ]+\\r\\n"', lambda m, k=k, v=v: f'"{k} = {v}\\r\\n"', rc, count=1)
rc = rc.replace('"CaptionFont = Tahoma, 10, bold\\r\\n"', '"CaptionFont = Tahoma, 9, bold\\r\\n"').replace('"CaptionBarHeight = 25\\r\\n"', '"CaptionBarHeight = 26\\r\\n"')
rc = rc.replace('"FlatMenus = true\\r\\n"', '"FlatMenus = true\\r\\n"')
# white caption text; green progress in blocks
rc = rc.replace('"[Window.Caption]\\r\\n"', '"[Window.Caption]\\r\\n"', 1)
sec = rc.index('"[Window.Caption]\\r\\n"')
end = rc.index('"[Window.SmallCaption]\\r\\n"')
rc = rc[:sec] + rc[sec:end].replace('"TextColor = 0 0 0\\r\\n"', '"TextColor = 255 255 255\\r\\n"') + rc[end:]
rc = re.sub(r'("\[Progress\]\\r\\n"\s*"ProgressChunkSize = )1(\\r\\n"\s*"ProgressSpaceSize = )0', r'\g<1>8\g<2>2', rc)
def in_sections(rc, prefix, fn):
    """fn over the text of each section whose name starts with prefix."""
    parts = re.split(r'(?="\[[^\]]*\]\\r\\n")', rc)
    return ''.join(fn(p) if p.startswith(f'"[{prefix}') else p for p in parts)


rc = in_sections(rc, 'Progress', lambda t: t.replace('"FillColor = 48 150 250\\r\\n"', '"FillColor = 49 211 49\\r\\n"'))
i = rc.index('"[Button.Pushbutton]\\r\\n"')
rc = rc[:i] + ''.join(v + '\n' for v in EXTRA.values()) + rc[i:]
i = rc.index('/* @makedep: blue_button.bmp */')
rc = rc[:i] + ''.join(f'/* @makedep: {n} */\n{n[:-4].upper()}_BMP BITMAP "{n}"\n\n' for n in EXTRA) + rc[i:]
open(f'{OUT}/luna.rc', 'w', encoding='utf-8').write(rc)
# The same colors under HKCU\Control Panel\Colors' names: Wine's uxtheme sets them for the session only
# (SetSysColors), as Windows does; its theme manager is what writes them, here mkapps.sh.
REG = {'ActiveCaption': 'ActiveTitle', 'BtnFace': 'ButtonFace', 'BtnShadow': 'ButtonShadow', 'BtnText': 'ButtonText',
       'CaptionText': 'TitleText', 'GradientActiveCaption': 'GradientActiveTitle', 'GradientInactiveCaption': 'GradientInactiveTitle',
       'Highlight': 'Hilight', 'HighlightText': 'HilightText', 'HotTracking': 'HotTrackingColor', 'InactiveCaption': 'InactiveTitle',
       'InactiveCaptionText': 'InactiveTitleText', 'InfoBk': 'InfoWindow', 'BtnHighlight': 'ButtonHilight', 'DkShadow3d': 'ButtonDkShadow',
       'Light3d': 'ButtonLight'}
open(f'{OUT}/colors.txt', 'w').write(''.join(f'{REG.get(k, k)}={v}\n' for k, v in COLORS.items()))
open(f'{OUT}/drawn.txt', 'w').write('\n'.join(written) + '\n')
print(f'luna: {len(written)} bitmaps drawn, the rest aero\'s')
