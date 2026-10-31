#!/usr/bin/env bash
# AdsPower's Local API (50325) answers only on this machine. Own chain, jumped to from INPUT;
# no other rule is touched, SSH and the site are not affected. Re-runnable (used at boot).
# Extra ports (e.g. a Chromium debug range, if a listener is ever seen outside loopback) go in
# ADSPOWER_BLOCK_PORTS="30000:40000" in /etc/bananabun/adspower.env.
set -eu
CHAIN=BB_ADSPOWER
EXTRA="${ADSPOWER_BLOCK_PORTS:-}"
if [ -z "$EXTRA" ] && [ -f /etc/bananabun/adspower.env ]; then
  EXTRA="$(sed -n 's/^ADSPOWER_BLOCK_PORTS=\([0-9:,]*\)$/\1/p' /etc/bananabun/adspower.env)"
fi
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
done
