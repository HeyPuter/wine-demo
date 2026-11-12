#!/bin/bash
# mkbundle.sh: pre/bundle.tar, the page's whole tree before the eject's split: /w64 (w64/dist-s: the W64 pin
# with the drop patch and the native core) and /pfx (the page prefix template from work/pfx-apps, which has
# 7-Zip, Notepad++ and Dillo built from source (mkapps.sh, WN's gexcc drop-in), PuTTY; user gex's folders)
# and /usr/share/X11/xkb.
set -euo pipefail
. "$(dirname "$0")/../env.sh"; need_gex; S=$WD_OUT; W=$GEX; cd $S
rm -rf stage; mkdir -p stage pre
GRAPHICS=wayland $W/wine/page-prefix.sh work/pfx-apps w64/dist stage/pfx > logs/page-prefix.log 2>&1
c=stage/pfx/drive_c
# The page runs as user gex. The template's prefix was made as the build machine's user (C:\users\claude),
# whose Downloads Wine links to that user's real ~/Downloads: none of it goes in, and its registry paths
# name gex.
rm -rf "$c/users/claude"
sed -i 's/C:\\\\users\\\\claude/C:\\\\users\\\\gex/g' stage/pfx/*.reg
! find stage/pfx -type l ! -path 'stage/pfx/dosdevices/*' | grep . || { echo "mkbundle: a link in the prefix (above)"; exit 1; }
for d in Desktop Documents Downloads Music Pictures Videos; do mkdir -p $c/users/gex/$d; done
# Installers to try from the page, 64- and 32-bit (WoW64).
cp $TEST_APPS/7z2408-x64.exe $TEST_APPS/7z2408-x86.exe $TEST_APPS/putty-x86.exe $c/users/gex/Downloads/
# Every builtin at one address in every process (dll-bases.py, from dll-pins.txt and the recordings), so units hit.
cp $WDR/tools/dll-bases stage/pfx/dll-bases
# The prefix's copies of the builtins, wherever wineboot put them (system32, syswow64, winsxs, drivers, wbem,
# C:\windows, Program Files): each becomes the dist's file of that name (the native x86-64 module's skeleton;
# the translated i386 image), as a wineboot on the dist would copy it, so the tar holds it once (--dedupe); the
# ones the dist leaves out (icu, Win16, VxD) go (tools/builtins.py). Wine placeholder DLLs do not do in
# system32: cmd's conhost never starts from one and a typelib in one does not load.
python3 -I $WDR/tools/builtins.py stage/pfx w64/dist > logs/builtins.log 2>&1 || { cat logs/builtins.log; exit 1; }
# cmd's console 76 columns wide (Wine's default is 80): the file manager opens over it at the same corner,
# 640 wide, and an 80-column console (665) stuck out at its right as a strip with a close box and a scrollbar.
grep -q '^\[Console\]' stage/pfx/user.reg || printf '\n[Console] 1791289000\n"ScreenBufferSize"=dword:0096004c\n"WindowSize"=dword:0019004c\n' >> stage/pfx/user.reg
cp $WDR/tools/desktop-readme.txt "$c/users/gex/Desktop/Read me.txt"
# Wine's PE files without their debug sections (about half the download): the dist as w64/dist-s, and the
# prefix's copies of the builtins, which stay byte-identical to it. page-prefix.sh above keeps w64/dist, the
# path the template's registry names. Made again whenever the dist's content (every file's bytes, every link)
# or strip-pe.sh differs from what it was made from (w64/dist-s.key), not by the directories' times: a file
# replaced inside the dist leaves those as they were.
key=$( { (cd w64/dist && { find . -type f -print0 | xargs -0 -P8 -n64 sha256sum; find . -type l -printf '%p -> %l\n'; }) | LC_ALL=C sort; sha256sum $WDR/bin/strip-pe.sh | cut -c1-64; } | sha256sum | cut -c1-16)
[ -d w64/dist-s ] && [ "$(cat w64/dist-s.key 2>/dev/null)" = "$key" ] || {
  rm -rf w64/dist-s w64/dist-s.key; cp -a w64/dist w64/dist-s; $WDR/bin/strip-pe.sh w64/dist-s; echo $key > w64/dist-s.key; }
# The loader's and the server's wasm modules ship inside their ELF containers (wasm-elf.py), byte for byte;
# the loose copies and the loader's memory64 module from before lowering (wcc64's OUT.64.wasm) are build
# outputs nothing opens.
rm -f w64/dist-s/lib/wine/x86_64-unix/{wine,wineserver}.wasm w64/dist-s/lib/wine/x86_64-unix/wine.64.wasm
# ICU's data is icu.dll's alone, which the dist leaves out (noicu); nothing else opens it.
rm -f w64/dist-s/share/wine/nls/icudtl.dat
# Wine's raster fonts come with the dist (wine64-dist.sh's fon step).
ls w64/dist-s/share/wine/fonts/*.fon > /dev/null || { echo 'mkbundle: the dist has no .fon fonts'; exit 1; }

$WDR/bin/strip-pe.sh stage/pfx/drive_c
# The gexcc programs' wasm modules (NAME.exe.wasm beside NAME.exe) are hidden files, as Windows marks a
# program's own parts the user never opens: Wine reads the attribute from user.DOSATTRIB.
find stage/pfx/drive_c -type f -name '*.wasm' -exec setfattr -n user.DOSATTRIB -v '"0x2"' {} +
# A fallback for symbols Wine's fonts lack (arrows, shapes, dingbats: Notepad++'s menu bar drew boxes), first in
# every font's links (tools/fonts/README.txt).
cp $WDR/tools/fonts/dejavusans-symbols.ttf $c/windows/Fonts/
mkdir -p "$c/Program Files/Licenses"; cp $WDR/tools/fonts/DejaVu-LICENSE.txt "$c/Program Files/Licenses/"
# Liberation Sans, Serif and Mono (SIL OFL 1.1; upstream's 2.1.5 release, TEST_APPS): the metrics of Arial, Times
# New Roman and Courier New, which programs ask for by name, and HKCU\Software\Wine\Fonts\Replacements makes those
# names these (Pidgin waited forever for its Arial). Nothing from Windows.
L=liberation-fonts-ttf-2.1.5; rm -rf work/$L
tar -xzf $TEST_APPS/$L.tar.gz -C work $L/LICENSE $(for f in Sans Serif Mono; do for s in Regular Bold Italic BoldItalic; do echo $L/Liberation$f-$s.ttf; done; done)
cp work/$L/*.ttf $c/windows/Fonts/; cp work/$L/LICENSE "$c/Program Files/Licenses/Liberation-LICENSE.txt"; rm -rf work/$L
python3 -I - stage/pfx/user.reg <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
assert '[Software\\\\Wine\\\\Fonts\\\\Replacements]' not in s, 'Replacements already there'
s = s.rstrip('\n') + '\n\n[Software\\\\Wine\\\\Fonts\\\\Replacements] 1794440998\n' + ''.join(
    f'"{a}"="{b}"\n' for a, b in (('Arial', 'Liberation Sans'), ('Times New Roman', 'Liberation Serif'), ('Courier New', 'Liberation Mono')))
open(p, 'w', encoding='utf-8').write(s)
PY
python3 -I - stage/pfx/system.reg <<'PY'
import re, sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
i = s.index('[Software\\\\Microsoft\\\\Windows NT\\\\CurrentVersion\\\\FontLink\\\\SystemLink]')
j = s.index('\n\n', i)
sec = re.sub(r'^("[^"]+"=str\(7\):")', r'\1dejavusans-symbols.ttf,DejaVu Sans\\0', s[i:j], flags=re.M)
assert sec != s[i:j], 'no font links'
open(p, 'w', encoding='utf-8').write(s[:i] + sec + s[j:])
PY
# No Z: (Wine's drive for the Unix root): every path the page opens is on C:, and the file dialogs and the
# file manager listed the page's own / ("/" in the desktop's namespace, which goes too).
rm -f stage/pfx/dosdevices/z:
python3 -I - stage/pfx/system.reg <<'PY'
import re, sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
n = len(s)
s = re.sub(r'\[Software\\\\(?:Wow6432Node\\\\)?Microsoft\\\\Windows\\\\CurrentVersion\\\\Explorer\\\\Desktop\\\\Namespace\\\\\{9D20AAE8-0625-44B0-9CA7-71889C2254D9\}\][^\n]*\n(?:[^\n\[][^\n]*\n)*\n?', '', s, flags=re.I)
assert len(s) < n, 'no Unix root namespace key'
open(p, 'w', encoding='utf-8').write(s)
PY
# No debugger for a crashed program (Wine's default is winedbg, which held its windows for seconds): gex
# ends it, its windows go, and the page says it crashed (index.html, start()'s onCrash).
python3 -I - stage/pfx/system.reg <<'PY'
import re, sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
s, n = re.subn(r'(\[Software\\\\(?:Wow6432Node\\\\)?Microsoft\\\\Windows NT\\\\CurrentVersion\\\\AeDebug\][^\n]*\n(?:[^\n\[][^\n]*\n)*?)"Debugger"=[^\n]*\n', r'\1', s)
assert n in (0, 2), f'AeDebug Debugger values: {n}, want 2 (or 0: a prefix that has none)'
open(p, 'w', encoding='utf-8').write(s)
PY
# The keyboard's XKB data (Debian's xkb-data, MIT): winewayland compiles the compositor's keymap
# against /usr/share/X11/xkb in every process; without it no key reaches a window.
mkdir -p stage/usr/share/X11; cp -rL /usr/share/X11/xkb stage/usr/share/X11/
# A new file, not the old one rewritten: eject projects hold links to it.
rm -f pre/bundle.tar
tar -C $S --xattrs --xattrs-include='user.*' --owner=0 --group=0 \
  --transform='s,^w64/dist-s,w64,;s,^stage/pfx,pfx,;s,^stage/usr,usr,' -cf pre/bundle.tar w64/dist-s stage/pfx stage/usr
python3 -I $WDR/tools/audit.py | tee /dev/stderr | grep -q ', 0 unaccounted, 0 Wine PE' || { rm -f pre/bundle.tar; echo 'mkbundle: the audit found files of unknown origin'; exit 1; }
ls -l pre/bundle.tar
