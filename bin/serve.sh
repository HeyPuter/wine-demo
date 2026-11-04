#!/bin/bash
# serve.sh DIR [PORT]: DIR (a site, or pre/; relative to WD_OUT) served on PORT (default env.sh's) over TLS by
# user unit windemo-PORT (SERVE_DIR's tools/serve-h2.mjs), replacing what it served.
. "$(dirname "$0")/../env.sh"; d=${1:?DIR} port=${2:-$PORT}
case $d in /*) ;; *) d=$WD_OUT/$d;; esac
[ -d "$d" ] || { echo "serve: no $d"; exit 1; }
systemctl --user stop windemo-$port 2>/dev/null; systemctl --user reset-failed windemo-$port 2>/dev/null
systemd-run --user --unit windemo-$port -p WorkingDirectory=$SERVE_DIR /usr/bin/nice -n 5 $NODE_BIN/node tools/serve-h2.mjs "$d" $port 0.0.0.0 --tls > /dev/null 2>&1
sleep 2; curl -sk -o /dev/null -w "${d##*/} on :$port %{http_code}\n" https://$SITE_HOST:$port/
