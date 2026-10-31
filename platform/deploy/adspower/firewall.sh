#!/usr/bin/env bash
# Keeps AdsPower (Local API on 50325 and the Chromium debug ports of open profiles) reachable only by the
# `adsagent` user and root. Inbound: own chain BB_ADSPOWER drops 50325 from outside. Outbound on loopback:
# chain BB_ADSPOWER_OUT lets the site user (`affiliate`) reach only the local ports it needs (4000, 4110 and the
# database / Redis ports read from its .env), so a compromised site cannot drive the FB profiles; any other user
# is refused 50325. No other rule is touched; SSH and the site are not affected. Re-runnable (used at boot).
# Extra inbound ports: ADSPOWER_BLOCK_PORTS="30000:40000" in /etc/bananabun/adspower.env.
set -eu
CHAIN=BB_ADSPOWER
OUT=BB_ADSPOWER_OUT
APP_USER=affiliate
APP_ENV=/opt/affiliate/backend/.env
EXTRA="${ADSPOWER_BLOCK_PORTS:-}"
if [ -z "$EXTRA" ] && [ -f /etc/bananabun/adspower.env ]; then
  EXTRA="$(sed -n 's/^ADSPOWER_BLOCK_PORTS=\([0-9:,]*\)$/\1/p' /etc/bananabun/adspower.env)"
fi

# Local ports of the site: backend, Umbrella, and the ports in its database / Redis URLs (defaults 5432 / 6379).
# If the site's .env cannot be read, the site user is not restricted (only 50325 is refused) and a warning is printed.
APP_PORTS="4000 4110"
ISOLATE=1
url_port() { # KEY DEFAULT
  local v; v="$(sed -n "s/^$1=//p" "$APP_ENV" | head -n1 | tr -d '"'"'")"
  [ -n "$v" ] || return 0
  v="${v#*://}"; v="${v#*@}"; v="${v%%/*}"; v="${v%%\?*}"
  case "$v" in *:*) printf '%s' "${v##*:}" ;; *) printf '%s' "$2" ;; esac
}
if [ -r "$APP_ENV" ]; then
  for kv in DATABASE_URL:5432 REDIS_URL:6379; do
    p="$(url_port "${kv%%:*}" "${kv##*:}")"
    case "$p" in '') ;; *[!0-9]*) ISOLATE=0 ;; *) APP_PORTS="$APP_PORTS $p" ;; esac
  done
else
  ISOLATE=0
fi
id -u "$APP_USER" >/dev/null 2>&1 || ISOLATE=0
[ "$ISOLATE" = 1 ] || echo "WARNING: site ports unknown; $APP_USER keeps loopback access except 50325" >&2
id -u adsagent >/dev/null 2>&1 || { echo "user adsagent missing" >&2; exit 1; }

for ipt in iptables ip6tables; do
  command -v "$ipt" >/dev/null || continue
  "$ipt" -w -N "$CHAIN" 2>/dev/null || "$ipt" -w -F "$CHAIN"
  "$ipt" -w -A "$CHAIN" -i lo -j RETURN
  "$ipt" -w -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  "$ipt" -w -A "$CHAIN" -p tcp --dport 50325 -j DROP
  IFS=, read -ra RANGES <<< "$EXTRA"
  for r in "${RANGES[@]}"; do
    [ -n "$r" ] && "$ipt" -w -A "$CHAIN" -p tcp --dport "$r" -j DROP
  done
  "$ipt" -w -C INPUT -j "$CHAIN" 2>/dev/null || "$ipt" -w -I INPUT 1 -j "$CHAIN"

  "$ipt" -w -N "$OUT" 2>/dev/null || "$ipt" -w -F "$OUT"
  "$ipt" -w -A "$OUT" -m owner --uid-owner adsagent -j RETURN
  "$ipt" -w -A "$OUT" -m owner --uid-owner 0 -j RETURN
  if [ "$ISOLATE" = 1 ]; then
    for p in $APP_PORTS; do "$ipt" -w -A "$OUT" -m owner --uid-owner "$APP_USER" -p tcp --dport "$p" -j RETURN; done
    "$ipt" -w -A "$OUT" -m owner --uid-owner "$APP_USER" -p tcp --dport 1024:65535 -m conntrack --ctstate NEW -j REJECT
  fi
  "$ipt" -w -A "$OUT" -p tcp --dport 50325 -m conntrack --ctstate NEW -j REJECT
  "$ipt" -w -C OUTPUT -o lo -j "$OUT" 2>/dev/null || "$ipt" -w -I OUTPUT 1 -o lo -j "$OUT"
done
echo "AdsPower firewall: site user $APP_USER loopback ports: $([ "$ISOLATE" = 1 ] && echo "$APP_PORTS" || echo 'not isolated')"
