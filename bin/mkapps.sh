#!/bin/bash
# mkapps.sh [PREFIX]: work/pfx-apps from the gate's WoW64 prefix (PREFIX, default w64/dist.env's, copied, never
# written) and w64/dist. APPS (WN's drop-in, apps/package.sh: files/ under drive_c, programs.list, licenses/,
# SHA256SUMS): 7-Zip, Notepad++ and Dillo built from source with gexcc's Windows target, as wasm modules.
# PuTTY (TEST_APPS/putty-x64.exe) goes in too. Their licenses go to
# C:\Program Files\Licenses, and each program in programs.list gets a Start menu shortcut (wscript's
# WScript.Shell.CreateShortcut, natively under gexc, no display), as do Wine's own programs the page has in
# tools/start-menu.tsv (Command Prompt, Notepad, the file manager...). mkbundle.sh makes the page prefix from it.
set -euo pipefail
. "$(dirname "$0")/../env.sh"; need_gex; S=$WD_OUT; cd $S
src=$(realpath "${1:-$(sed -n 's/^PREFIX=//p' w64/dist.env)}"); G=$GEXC; A=$APPS
(cd $A && sha256sum -c --quiet SHA256SUMS) || { echo "mkapps: $A/SHA256SUMS does not check"; exit 1; }
rm -rf work/pfx-apps; cp -a "$src" work/pfx-apps; chmod -R u+w work/pfx-apps
P=$S/work/pfx-apps; c=$P/drive_c
# The prefix's copies of the builtins are the PE build's (translated x86-64 code); the page runs the dist's
# (tools/builtins.py, as mkbundle.sh does again on the page prefix), and so does wscript below.
python3 -I $WDR/tools/builtins.py $P w64/dist > logs/mkapps-builtins.log 2>&1 || { cat logs/mkapps-builtins.log; exit 1; }
cp -a "$A/files/." "$c/"
mkdir -p "$c/Program Files/PuTTY"; cp $TEST_APPS/putty-x64.exe "$c/Program Files/PuTTY/putty.exe"
mkdir -p "$c/Program Files/Licenses"; cp -p "$A"/licenses/* "$c/Program Files/Licenses/"
# The shortcuts, for every user (C:\ProgramData\Microsoft\Windows\Start Menu\Programs).
v=$c/mklinks.vbs
{ echo 'Set sh = CreateObject("WScript.Shell")'
  echo 'd = sh.SpecialFolders("AllUsersPrograms")'
  while IFS=$'\t' read -r name exe kind; do
    [ -n "$name" ] || continue
    # 7zG.exe is 7-Zip's dialogs for 7zFM and the shell extension: started alone it only says
    # "Specify command", so no shortcut.
    case "$exe" in *\\7zG.exe) continue;; esac
    echo "Set l = sh.CreateShortcut(d & \"\\$name.lnk\")"
    if [ "$kind" = console ]; then
      # A console program run from a shortcut prints its usage and closes its window at once: in a cmd
      # that stays, as a Command Prompt shortcut to it would be.
      echo 'l.TargetPath = "C:\windows\system32\cmd.exe"'
      echo "l.Arguments = \"/k \"\"$exe\"\"\""
    else
      echo "l.TargetPath = \"$exe\""
    fi
    echo "l.WorkingDirectory = \"${exe%\\*}\""
    # Wine's shell shows a shortcut's own icon location only (shell32 folders.c), never its target's.
    echo "l.IconLocation = \"$exe,0\""
    echo 'l.Save'
  done < <(cat "$A/programs.list"; printf 'PuTTY\tC:\\Program Files\\PuTTY\\putty.exe\tgui\n')
  # Wine's own programs, in Windows' folders (made here first: CreateShortcut makes no folder)
  while IFS=$'\t' read -r dir name exe args; do
    case "$dir" in ''|'#'*) continue;; esac
    [ "$dir" = - ] && at='d' || { at="d & \"\\$dir\""; mkdir -p "$c/ProgramData/Microsoft/Windows/Start Menu/Programs/${dir//\\//}"; }
    [ -e "$c/$(echo "${exe#C:\\}" | tr '\\' /)" ] || { echo "mkapps: no $exe in the prefix (tools/start-menu.tsv)"; exit 1; }
    echo "Set l = sh.CreateShortcut($at & \"\\$name.lnk\")"
    echo "l.TargetPath = \"$exe\""
    [ -z "$args" ] || echo "l.Arguments = \"$args\""
    echo 'l.WorkingDirectory = "C:\users\gex"'
    echo "l.IconLocation = \"$exe,0\""
    echo 'l.Save'
  done < $WDR/tools/start-menu.tsv
  # The desktop's shortcuts (tools/desktop-links.tsv), in user gex's Desktop folder, which the page's desktop shows
  mkdir -p "$c/users/gex/Desktop"
  while IFS=$'\x1f' read -r name exe args icon; do
    case "$name" in ''|'#'*) continue;; esac
    [ -e "$c/$(echo "${exe#C:\\}" | tr '\\' /)" ] || { echo "mkapps: no $exe in the prefix (tools/desktop-links.tsv)"; exit 1; }
    echo "Set l = sh.CreateShortcut(\"C:\\users\\gex\\Desktop\\$name.lnk\")"
    echo "l.TargetPath = \"$exe\""
    [ -z "$args" ] || echo "l.Arguments = \"$args\""
    echo 'l.WorkingDirectory = "C:\users\gex\Desktop"'
    # Wine's desktop leaves out a shortcut it gets no icon from: the icon column for a program with none of its own
    echo "l.IconLocation = \"${icon:-$exe,0}\""
    echo 'l.Save'
  done < <(tr '\t' '\037' < $WDR/tools/desktop-links.tsv)
} > "$v"
(cd $c && timeout -k 10 600 systemd-run --user --scope -q -p TasksMax=1024 -p MemoryMax=16G nice -n 10 \
  $G run --env WINEPREFIX=$P --env WINEGEX_WOW64=1 --env WINEDEBUG=err+all,fixme-all --env USER=gex \
  $S/w64/dist/lib/wine/x86_64-unix/wine wscript.exe //nologo 'C:\mklinks.vbs') > logs/mkapps-links.log 2>&1
rm -f "$v"
n=$(find "$c/ProgramData/Microsoft/Windows/Start Menu/Programs" -maxdepth 1 -name '*.lnk' | wc -l)
[ "$n" = "$(($(grep -c . "$A/programs.list") - $(grep -c '7zG\.exe' "$A/programs.list") + 1))" ] || { echo "mkapps: $n Start menu shortcuts, not one per program (logs/mkapps-links.log)"; exit 1; }
nw=$(find "$c/ProgramData/Microsoft/Windows/Start Menu/Programs" -mindepth 2 -name '*.lnk' | wc -l)
[ "$nw" = "$(grep -cv '^#' $WDR/tools/start-menu.tsv)" ] || { echo "mkapps: $nw shortcuts to Wine's programs, not one per line of tools/start-menu.tsv (logs/mkapps-links.log)"; exit 1; }
nd=$(find "$c/users/gex/Desktop" -maxdepth 1 -name '*.lnk' | wc -l)
[ "$nd" = "$(grep -cv '^#' $WDR/tools/desktop-links.tsv)" ] || { echo "mkapps: $nd shortcuts on the desktop, not one per line of tools/desktop-links.tsv (logs/mkapps-links.log)"; exit 1; }
n=$((n + nw + nd))
# A "Print to file" printer, the default (PRINTER=0: none): Wine's PostScript driver, each job written
# over C:\users\gex\Documents\print.ps (WN's recipe: wineps.drv and winspool.drv's generic.ppd in the
# driver directory, then tools/prt/addprinter.c, built here with mingw into work/ and not shipped). It needs a loader
# with localspl's, winspool's and wineps's Unix sides and DLL reload (wineps.drv's DllMain runs again).
pr=none
if [ "${PRINTER:-1}" != 0 ]; then
  dd=$c/windows/system32/spool/drivers/x64; mkdir -p "$dd"
  cp $S/w64/dist/lib/wine/x86_64-windows/wineps.drv "$dd/"
  python3 -I $WDR/tools/prt/ppd.py $S/w64/dist/lib/wine/x86_64-windows/winspool.drv "$dd/generic.ppd"
  $MINGW_CC -municode -O2 -o work/addprinter.exe $WDR/tools/prt/addprinter.c -lwinspool
  cp work/addprinter.exe $c/addprinter.exe
  (cd $c && timeout -k 10 300 systemd-run --user --scope -q -p TasksMax=1024 -p MemoryMax=16G nice -n 10 \
    $G run --env WINEPREFIX=$P --env WINEGEX_WOW64=1 --env WINEDEBUG=err+all,fixme-all --env USER=gex \
    $S/w64/dist/lib/wine/x86_64-unix/wine 'C:\addprinter.exe' 'Print to file' 'C:\users\gex\Documents\print.ps') > logs/mkapps-printer.log 2>&1
  rm -f $c/addprinter.exe
  grep -q '^addprinter: ' logs/mkapps-printer.log || { echo "mkapps: no printer (logs/mkapps-printer.log)"; exit 1; }
  pr='"Print to file"'
fi
# The launcher's agent (agent/agent.c): the page's tiles drop their jobs into C:\windemo\queue for it.
mkdir -p $c/windemo
$WDR/agent/build.sh $c/windemo/agent.exe
# The look (THEME, default classic: windemo's own scheme, theme/classic, drawn by Wine's classic code with no
# visual style; aero: Wine's stock visual style, as the gate's prefix has it).
th=${THEME:-classic}
case $th in
  classic) python3 -I $WDR/theme/classic/classic.py $P/user.reg $WDR/theme/classic/scheme.txt > logs/mkapps-theme.log ;;
  aero) ;;
  *) echo "mkapps: THEME is classic or aero, not $th"; exit 1 ;;
esac
echo "mkapps: $P, $n shortcuts, printer $pr, theme $th"
