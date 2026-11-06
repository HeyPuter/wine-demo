#!/bin/bash
# theme.sh PREFIX THEME_DIR [COLORS]: makes THEME_DIR's visual style (THEME_DIR/NAME.msstyles and whatever is
# beside it, copied to C:\windows\resources\themes\NAME) the style of the Wine prefix PREFIX, through uxtheme's
# own ApplyTheme (theme/apply.c), which writes the style's colors, caption metrics and flat menus to
# PREFIX/user.reg, and turns menu drop shadows on. COLORS (NAME=R G B lines, theme/luna's colors.txt) then
# replace those of the same names in Control Panel\Colors. Runs DIST's wine (default w64/dist) under gexc, natively.
set -euo pipefail
. "$(dirname "$0")/../env.sh"; need_gex; S=$WD_OUT; cd $S
D=${DIST:-$S/w64/dist}; P=$(realpath "$1"); T=$(realpath "$2"); colors=${3:-}
ms=$(cd "$T" && ls *.msstyles | head -1); [ -n "$ms" ] || { echo "theme: no .msstyles in $T"; exit 1; }
name=${ms%.msstyles}; c=$P/drive_c; td="$c/windows/resources/themes/$name"
mkdir -p "$td"; cp -a "$T/." "$td/"
$MINGW_CC -municode -O2 -o work/apply-theme.exe $WDR/theme/apply.c
cp work/apply-theme.exe $c/apply-theme.exe
(cd $c && timeout -k 10 300 systemd-run --user --scope -q -p TasksMax=1024 -p MemoryMax=16G nice -n 10 \
  $GEXC run --env WINEPREFIX=$P --env WINEGEX_WOW64=1 --env WINEDEBUG=err+all,fixme-all --env USER=gex \
  $D/lib/wine/x86_64-unix/wine 'C:\apply-theme.exe' "C:\\windows\\resources\\themes\\$name\\$ms") > logs/theme-$name.log 2>&1 || true
rm -f $c/apply-theme.exe
grep -q '^apply: C:' logs/theme-$name.log && grep -q "$ms" $P/user.reg || { echo "theme: the style did not apply (logs/theme-$name.log)"; exit 1; }
[ -z "$colors" ] || python3 -I - $P/user.reg "$colors" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
cols = dict(l.strip().split('=', 1) for l in open(sys.argv[2]) if '=' in l)
i = s.index('[Control Panel\\\\Colors]'); j = s.index('\n\n', i)
sec = s[i:j]
for k, v in cols.items():
    sec, n = re.subn(rf'^"{k}"="[0-9 ]*"$', f'"{k}"="{v}"', sec, flags=re.M)
    if not n:
        sec += f'\n"{k}"="{v}"'
open(p, 'w', encoding='utf-8').write(s[:i] + sec + s[j:])
PY
echo "theme: $name applied to $P"
