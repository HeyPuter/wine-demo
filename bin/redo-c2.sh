#!/bin/bash
# redo-c2.sh URL TAGSUFFIX: (C) on a windemo site. File manager: Copy on Read me.txt, Documents, its empty list's Paste and F5 (the view does not show the pasted file by itself; the context menus: Wine's shell view has no Ctrl+C/Ctrl+V); F2 rename of the copy; drag of it onto the tree's Desktop (no move: Wine's tree and desktop take no drops; it must not trap). 7-Zip FM: Documents, Up
# (C:\users\gex), "desktop" Enter by the list's type-to-find, "read" (Read me.txt), Add and OK, then the
# archive found the same way and Tested. Dillo: the location bar, example.com, Enter. Evals: the files opened.
. "$(dirname "$0")/../env.sh"; S=$WD_OUT; cd "$S"; U=${1:?URL} x=${2:?SUFFIX}
C=(SMOKE_SPKI=$SPKI SMOKE_PRELOAD_FILE=./start-preload.js SMOKE_OUT_W=1300 SMOKE_OUT_H=713)
ev() { printf '%s' "(async () => [\"$1\", (await __ntOpened()).filter((f) => /$2/i.test(typeof f === 'string' ? f : JSON.stringify(f)))])()" | base64 -w0; }
bash "$WDR/bin/q-smoke.sh" cfm$x $U 160 2 "${C[@]}" SMOKE_EVAL_AT=90,115,155 SMOKE_EVAL_AT_B64=$(ev fm 'documents.*read|renamed') \
  "SMOKE_KEYS=62:rclick:205:117,65:click:237:189,68:click:86:147,74:rclick:400:300,77:click:433:364,85:F5,95:click:205:117,98:F2,101:ctrl:a,102:type:renamed.txt,105:Enter,125:drag:205:117:41:115"
bash "$WDR/bin/q-smoke.sh" c7z$x $U 220 2 "${C[@]}" SMOKE_EVAL_AT=175,215 SMOKE_EVAL_AT_B64=$(ev 7z '[.]7z') \
  "SMOKE_KEYS=90:click:20:703,93:click:30:612,97:click:170:627,120:dblclick:50:170,128:click:16:111,135:click:400:400,136:type:desktop,138:Enter,145:click:400:400,146:type:read,149:click:24:72,160:Enter,180:click:400:400,181:type:read+me.7,184:click:107:72"
# A drop between processes (OLE drag-drop): 7-Zip FM in Documents, moved right by its caption so its list is
# clear of the file manager's window; the file manager raised by its taskbar button; Read me.txt dragged
# from it into 7-Zip's list, whose drop is Add to Archive (Enter: Documents\Read me.7z).
bash "$WDR/bin/q-smoke.sh" cxd$x $U 200 2 "${C[@]}" SMOKE_EVAL_AT=170,195 SMOKE_EVAL_AT_B64=$(ev xd 'documents.*read') \
  "SMOKE_KEYS=90:click:20:703,93:click:30:612,97:click:170:627,120:dblclick:50:170,128:drag:300:15:950:185,136:click:300:703,142:drag:205:117:900:450,155:Enter"
bash "$WDR/bin/q-smoke.sh" cdl$x $U 170 2 "${C[@]}" "SMOKE_KEYS=90:click:20:703,93:click:30:612,97:click:170:646,118:click:200:44,119:ctrl:a,120:type:example.com,123:Enter"
cd runs; for r in cfm$x c7z$x cxd$x cdl$x; do echo "== $r"; grep -a 'smoke-eval@' out-$r.txt | cut -c1-300
  grep -a '\] pid [0-9:]* threw' out-$r/console.txt | cut -c1-160
  grep -a '\[wins\]' out-$r/console.txt | tail -n1 | tr '|' '\n' | grep -o '"[^"]*"' | grep -v '""' | sort -u | tr '\n' ' '; echo; done
echo REDO-DONE
