#!/usr/bin/env python3
# credits.py LAUNCHER.TSV OUT.html: the site's credits page, each launcher installer with its licence, its
# upstream source and where the copy on this site came from.
import html, sys
from urllib.parse import urlsplit

rows, keys = [], None
for l in open(sys.argv[1], encoding='utf-8'):
    if l.startswith('#') or not l.strip(): continue
    f = l.rstrip('\n').split('\t')
    if f[0] == 'id': keys = f; continue
    rows.append(dict(zip(keys, f)))
e = html.escape
def link(u, text=None): return f'<a href="{e(u)}">{e(text or urlsplit(u).netloc)}</a>' if u else ''
body = '\n'.join(
    f'<tr><td>{e(r["name"])}</td><td><code>{e(r["file"])}</code></td><td>{e(r["licence"])}</td>'
    f'<td>{link(r["source"], "source") if r["source"] else "not published"}</td><td>{link(r["url"])}</td></tr>'
    for r in sorted(rows, key=lambda r: r['name'].lower()))
open(sys.argv[2], 'w', encoding='utf-8').write(f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Credits and licences</title>
<style>
:root {{ --bg: #f4f4f1; --fg: #1d1d1b; --mute: #5d5d58; --line: #d6d6d0; --link: #1c3480; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg: #161615; --fg: #ececE8; --mute: #a3a39c; --line: #33332f; --link: #8fa8ff; }} }}
body {{ margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }}
main {{ max-width: 980px; margin: 0 auto; }}
h1 {{ font-size: 24px; margin: 0 0 8px; }}
p {{ color: var(--mute); margin: 0 0 16px; }}
a {{ color: var(--link); }}
.wrap {{ overflow-x: auto; }}
table {{ border-collapse: collapse; width: 100%; font-size: 14px; }}
th, td {{ text-align: left; padding: 6px 10px 6px 0; border-bottom: 1px solid var(--line); vertical-align: top; }}
th {{ font-weight: 600; }}
code {{ font-size: 12px; word-break: break-all; }}
</style></head><body><main>
<h1>Credits and licences</h1>
<p>The launcher's apps are their authors' unmodified installers, served from this site so they start
quickly. Each keeps its own licence; the source column links the upstream source of the same release. The
installer runs inside Wine in your browser, and nothing is installed on your computer.</p>
<p>The desktop is <a href="https://www.winehq.org/">Wine</a> (LGPL-2.1-or-later) running on
<a href="https://github.com/HeyPuter/gex">gex</a>. <a href="./">Back to the apps</a></p>
<div class="wrap"><table>
<thead><tr><th>App</th><th>Installer</th><th>Licence</th><th>Source</th><th>Upstream download</th></tr></thead>
<tbody>
{body}
</tbody></table></div>
</main></body></html>
''')
