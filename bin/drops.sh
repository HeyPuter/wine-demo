#!/bin/bash
# drops.sh: DROPS, the files the checks drag into the page from the host (SMOKE_DROP's @): the Win32 programs
# from TEST_APPS (putty-x86.exe, the 7-Zip x86 installer, Notepad++ x86 portable unzipped as npp86/), and
# made here: hello.txt, folder/ (a nested folder), test.zip (an archive for 7-Zip to open).
set -euo pipefail; . "$(dirname "$0")/../env.sh"
D=$DROPS; rm -rf "${D:?}"; mkdir -p "$D/folder/sub" "$D/npp86"
cp "$TEST_APPS/putty-x86.exe" "$TEST_APPS/7z2408-x86.exe" "$D/"
(cd "$D/npp86" && unzip -q "$TEST_APPS/npp.8.6.9.portable.x86.zip")
echo 'hello from the host' > "$D/hello.txt"; echo a > "$D/folder/a.txt"; echo inner > "$D/folder/sub/inner.txt"
(cd "$D" && TZ=UTC touch -d 2026-01-01 hello.txt && zip -qX test.zip hello.txt putty-x86.exe)
echo "drops: $D"
