#!/bin/bash
# check.sh TAG [STEP...]: the checks on the site served at URL (env.sh), each run on the bench box (q-smoke.sh)
# into WD_OUT/runs. Steps (default all, in order):
#   start    the Start menu, the taskbar and typing into Notepad, the file manager and cmd (start-page.sh)
#   launch   each Start-menu program launched in its own run (rec-order.sh): its windows and traps
#   banner   7zz's console banner (the first line should read 7-Zip ... Igor Pavlov, no stray glyphs)
#   prefs    Notepad++'s Settings > Preferences: click to window
#   c2       the file manager's copy/paste/rename, 7-Zip FM's add and test, the cross-process drop, Dillo (redo-c2.sh)
#   win32    the Win32 drops under WoW64 (DROPS: make drops): putty-x86.exe; the 7-Zip x86 installer, Install,
#            then the installed 7zFM.exe opening test.zip; Notepad++ x86 portable (notepad++.exe)
set -uo pipefail; . "$(dirname "$0")/../env.sh"; B=$WDR/bin; cd "$WD_OUT"
t=${1:?TAG}; shift; STEPS=${*:-start launch banner prefs c2 win32}
C=(SMOKE_SPKI=$SPKI SMOKE_PRELOAD_FILE=./start-preload.js SMOKE_OUT_W=1300 SMOKE_OUT_H=713)
wins() { grep -a '\[wins\]' runs/out-$1/console.txt | tail -n1 | tr '|' '\n' | grep -o '"[^"]*"' | grep -v '""' | sort -u | tr '\n' ' '; }
# at TAG KEY TITLE: seconds from the last KEY press (an Enter or a click) to the first window titled TITLE
at() { awk -v k="$2" -v w="$3" '$0 ~ "\\[smoke\\] " k {t=$1} /\[wins\]/ && index($0, w) && t != "" {printf "%.1f s (%.1f -> %.1f)", $1 - t, t, $1; exit}' runs/out-$1/console.txt; }
for st in $STEPS; do case $st in
start) bash $B/start-page.sh $t-sp $URL 2>&1 | grep -a '^start-page' | cut -c1-160;;
launch)
  bash $B/rec-order.sh $URL work/$t-order.txt > logs/$t-order.txt 2>&1
  for n in np fm dillo putty con; do echo "launch $n: $(wins ro-$n | sed 's/"C:[^"]*cmd.exe" //;s/"Desktop" //')$(grep -ac 'threw' runs/out-ro-$n/console.txt) traps"; done;;
banner)
  # 7zz's help scrolls its banner out of view: drag the console's scrollbar thumb to the top first
  bash $B/q-smoke.sh $t-ban $URL 125 2 "${C[@]}" "SMOKE_KEYS=90:click:20:703,93:click:30:612,97:click:170:$(row con),112:drag:620:155:620:30" > /dev/null 2>&1
  echo "banner: $(ls -t runs/out-$t-ban/s-*.png | head -n1)";;
prefs)
  bash $B/sweep.sh $t-pref 175 "92:click:20:703,95:click:30:612,98:click:170:$(row np),122:click:279:41,125:click:290:61" SMOKE_TCPU=500 | head -1
  echo "prefs: Preferences $(at sw-$t-pref 'click:290:61' '"Preferences"')";;
c2) bash $B/redo-c2.sh $URL $t 2>&1 | grep -v REDO-DONE;;
win32)
  K="105:click:100:703,108:click:300:200,109:type:cd+desktop,110:Enter"
  bash $B/sweep.sh $t-putty 165 "$K,113:type:putty-x86,114:Enter" "SMOKE_DROP=100:900:400:@/putty-x86.exe" | head -1
  echo "win32 putty-x86: PuTTY Configuration $(at sw-$t-putty 'key "Enter"' '"PuTTY Configuration"')"
  # the installer's Install button at 630,422; cmd clicked again once it is done
  bash $B/sweep.sh $t-7z 200 "$K,113:type:7z2408-x86,114:Enter,124:click:630:422,150:click:300:200,152:type:cd+\\program+files+(x86)\\7-zip,156:Enter,158:type:7zfm+\\users\\gex\\desktop\\test.zip,162:Enter" \
    "SMOKE_DROP=100:900:400:@/7z2408-x86.exe|@/test.zip" | head -1
  echo "win32 7-Zip x86: setup $(at sw-$t-7z 'key "Enter"' '7-Zip 24.08 Setup'), then 7zFM on test.zip (the installed copy) $(at sw-$t-7z 'key "Enter"' 'test.zip')"
  bash $B/sweep.sh $t-npp 175 "$K,113:type:cd+npp86,114:Enter,116:type:notepad\\+\\+,117:Enter" "SMOKE_DROP=100:900:400:@/npp86" | head -1
  echo "win32 Notepad++ x86: $(at sw-$t-npp 'key "Enter"' 'Notepad++')";;
*) echo "check: no step $st"; exit 1;;
esac; done
