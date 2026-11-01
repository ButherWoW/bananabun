#!/usr/bin/env bash
# Starts AdsPower headless for systemd. The key comes from EnvironmentFile (/etc/bananabun/adspower.env).
# AdsPower takes it only as a flag, so it is visible in the process list to root; nothing else is logged.
# ADSPOWER_XVFB=1 in that file (install.sh sets it) wraps the client in a virtual display: profile browsers
# cannot start without one.
set -eu
: "${ADSPOWER_API_KEY:?ADSPOWER_API_KEY is not set}"
ARGS=(--headless=true "--api-key=${ADSPOWER_API_KEY}" --api-port=50325)
if [ "${ADSPOWER_XVFB:-0}" = 1 ]; then
  exec xvfb-run -a -s "-screen 0 1920x1080x24" /usr/local/bin/adspower_global "${ARGS[@]}"
fi
exec /usr/local/bin/adspower_global "${ARGS[@]}"
