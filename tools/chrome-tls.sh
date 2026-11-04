#!/bin/sh
# Chromium that accepts the gooner sites' self-signed certificate (record-wine32.mjs --chrome).
exec /usr/bin/chromium --ignore-certificate-errors "$@"
