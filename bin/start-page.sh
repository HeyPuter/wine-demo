#!/bin/bash
# start-page.sh TAG URL: the Start menu check in the page (headless Chromium on the bench box, q-smoke.sh):
# Start clicked at 60 s, Programs at 63 s (the first menu must be up by then), the taskbar at 75 s, Start at 90 s, Programs at 96 s, the taskbar at 105 s, "Read me.txt" in the file
# manager double-clicked at 120 s; tools/start-page.py's verdict on runs/out-TAG/console.txt.
# Then typing, which a demo must never lose again: a click into Notepad at 130 s and a line typed at 132 s
# (its pixels must change), the file manager raised (its taskbar button) at 140 s, a click in its list at
# 144 s and Space at 148 s (it selects the focused first row, the only one: Down has no row to move to; the
# selection must show), cmd raised at 152 s and
# "copy nul typed.txt" typed and entered (the guest must open C:\users\gex\typed.txt); then cmd's taskbar
# button at 165 s (it is active: minimized, and its button no longer shows it active) and again at 170 s
# (restored, and active again), and
# "copy nul typed2.txt" at 174 s, which must reach cmd too (typed2.txt; the eval at 190 s).
. "$(dirname "$0")/../env.sh"; S=$WD_OUT; t=${1:?TAG} u=${2:?URL}
E=$(printf '%s' '(async () => ["typed", (await __ntOpened()).filter((f) => /typed2?\.txt/i.test(typeof f === "string" ? f : JSON.stringify(f)))])()' | base64 -w0)
bash "$WDR/bin/q-smoke.sh" $t "$u" 198 2 SMOKE_PRELOAD_FILE=./start-preload.js SMOKE_OUT_W=1300 SMOKE_OUT_H=713 SMOKE_EVAL_AT=190 SMOKE_EVAL_AT_B64=$E \
  SMOKE_KEYS=60:click:20:703,63:click:30:612,75:click:700:703,90:click:20:703,96:click:30:612,105:click:700:703,120:dblclick:205:117,130:click:300:300,132:type:typed+in+notepad,140:click:300:703,144:click:400:300,148:Space,152:click:130:703,156:type:copy+nul+typed.txt,159:Enter,165:click:130:703,170:click:130:703,174:type:copy+nul+typed2.txt,177:Enter
python3 -I $WDR/tools/start-page.py $S/runs/out-$t/console.txt $S/runs/out-$t.txt
