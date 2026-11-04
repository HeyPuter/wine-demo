#!/bin/bash
# print-page.sh TAG URL: print to file in the page (headless Chromium on the bench box, q-smoke.sh): "Read me.txt" in
# the file manager double-clicked at 60 s (Notepad), its File menu at 80 s, Print... at 88 s, the Print
# dialog's OK (the default printer, "Print to file") at 100 s; the file manager raised (its taskbar button) at
# 112 s and its Documents folder opened at 117 s, print.ps and its size in the screenshots after; at 110 s and 130 s the page's opened files naming print.ps (__ntOpened) and the
# browser's local time, for the taskbar clock in the screenshots (every 5 s).
. "$(dirname "$0")/../env.sh"; S=$WD_OUT; t=${1:?TAG} u=${2:?URL}
E=$(printf '%s' '(async () => [new Date().toString(), (await __ntOpened()).filter((f) => /print\.ps/i.test(typeof f === "string" ? f : JSON.stringify(f)))])()' | base64 -w0)
bash "$WDR/bin/q-smoke.sh" $t "$u" 140 5 SMOKE_OUT_W=1300 SMOKE_OUT_H=713 SMOKE_EVAL_AT=110,130 SMOKE_EVAL_AT_B64=$E \
  SMOKE_KEYS=60:dblclick:205:117,80:click:16:41,88:click:40:138,100:click:352:379,112:click:300:703,117:click:86:147
grep -a 'smoke-eval' $S/runs/out-$t/console.txt $S/runs/out-$t.txt 2>/dev/null | cut -c1-400
