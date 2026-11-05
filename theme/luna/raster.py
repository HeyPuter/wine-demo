#!/usr/bin/env python3
# raster.py OUT: OUT/svg/*.svg to OUT/bmp/*.bmp, each at its own size with its alpha (headless Chromium draws
# them into canvases, ImageMagick's convert writes 32-bit BMPs as Wine's buildimage does).
import base64, html, json, os, subprocess, sys, tempfile
OUT = os.path.abspath(sys.argv[1])
names = sorted(f[:-4] for f in os.listdir(f'{OUT}/svg') if f.endswith('.svg'))
page = f'{OUT}/raster.html'
with open(page, 'w') as f:
    f.write('<!doctype html><body><script>const N=%s;(async()=>{const o={};for(const n of N){const i=new Image();'
            'i.src="svg/"+n+".svg";await i.decode();const c=document.createElement("canvas");c.width=i.naturalWidth;'
            'c.height=i.naturalHeight;c.getContext("2d").drawImage(i,0,0);o[n]=c.toDataURL("image/png");}'
            'document.body.textContent=JSON.stringify(o);})()</script>' % json.dumps(names))
with tempfile.TemporaryDirectory() as prof:
    dom = subprocess.run(['chromium', '--headless', '--no-sandbox', '--disable-gpu', f'--user-data-dir={prof}',
                          '--allow-file-access-from-files', '--virtual-time-budget=60000', '--dump-dom', 'file://' + page],
                         capture_output=True, text=True, timeout=300).stdout
s = dom.index('{'); e = dom.rindex('}') + 1
o = json.loads(html.unescape(dom[s:e]))
os.makedirs(f'{OUT}/png', exist_ok=True); os.makedirs(f'{OUT}/bmp', exist_ok=True)
for n in names:
    open(f'{OUT}/png/{n}.png', 'wb').write(base64.b64decode(o[n].split(',', 1)[1]))
    subprocess.run(['convert', f'{OUT}/png/{n}.png', '-define', 'bmp:format=bmp4', f'BMP:{OUT}/bmp/{n}.bmp'], check=True)
print(f'raster: {len(names)} bitmaps')
