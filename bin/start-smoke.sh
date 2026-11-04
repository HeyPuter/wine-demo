#!/bin/bash
# start-smoke.sh PREFIX [DIST] [GEXC]: the Start menu check, natively under gexc's Wayland compositor (no Xvfb):
# the page's desktop (explorer /desktop=shell, cmd, the file manager on the Desktop folder) at 1300x713.
# Start is clicked and the menu must map, a click on the taskbar must close it, Start clicked again must map it again
# (the desktop process still answers), and then a double-click on "Read me.txt" in the file manager must
# start Notepad. The menu is seen in the compositor's window list ([wl-place]): a window more.
# PREFIX is copied (never written). Log logs/start-smoke.log. Exit 0 = pass.
set -uo pipefail
. "$(dirname "$0")/../env.sh"; S=$WD_OUT; src=$(realpath "${1:?PREFIX}"); D=$(realpath "${2:-$S/w64/dist-s}")
G=${3:-$GEXC}; H=$S/work/start-smoke; L=$S/logs/start-smoke.log
SX=${START_X:-20} SY=${START_Y:-703} RX=${README_X:-205} RY=${README_Y:-117}
rm -rf "${H:?}"; mkdir -p $H; cp -a "$src" $H/pfx; chmod -R u+w $H/pfx
# SHIFT=N moves every input N s later (a loaded machine starts the desktop late).
T=${SHIFT:-0}; at() { python3 -c "print($1+$T)"; }
cat > $H/in.txt <<EOF
frames 0
$(at 40) click $SX $SY
$(at 50) click 700 703
$(at 56) click $SX $SY
$(at 64) click 700 703
$(at 68) click $RX $RY
$(at 68.15) click $RX $RY
EOF
cd $H/pfx/drive_c/users/gex || exit 1
timeout -k 10 $((95 + T)) systemd-run --user --scope -q -E GEX_WL_INPUT=$H/in.txt ${GEX_STALL_EVERY:+-E GEX_STALL_EVERY=$GEX_STALL_EVERY -E GEX_STALL_BT=1} -p MemoryMax=16G -p TasksMax=2048 nice -n 10 \
  $G run --wayland $H/wl --wayland-size 1300x713 --wayland-out null \
  --env WINEPREFIX=$H/pfx --env "WINEDEBUG=${DBG:-err+all,fixme-all,+loaddll}" --env USER=gex --env HOME=/tmp \
  --env WINEGEX_DOOR=1 --env WINEGEX_WOW64=1 --env WINEGEX_FIT_DESKTOP=1 --env 'WINEDLLOVERRIDES=mscoree=;mshtml=' \
  $D/lib/wine/x86_64-unix/wine 'C:\windows\explorer.exe' /desktop=shell cmd.exe /k start explorer.exe 'C:\users\gex\Desktop' > $L 2>&1
cd $S
python3 -I $WDR/tools/start-smoke.py $L $T
fail=$?
grep -q 'exec .*notepad' $L && echo "start-smoke: ok Notepad started from the file manager" || { echo "start-smoke: FAIL no Notepad from the double-click"; fail=1; }
grep -q 'loader_section.*blocked by' $L && { echo "start-smoke: FAIL a thread waits on the loader lock: $(grep -m1 'loader_section' $L)"; fail=1; }
[ -n "${KEEP:-}" ] || rm -rf "${H:?}"
exit $fail
