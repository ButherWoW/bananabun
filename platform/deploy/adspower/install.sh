#!/usr/bin/env bash
# AdsPower (headless) + Bananabun agent on this server, as the unprivileged user `adsagent`.
# Run as root from the folder that holds this script and a copy of mac-agent/ next to it (agent/).
#   install.sh [--deb-url https://…adspower…/….deb] [--allowed "7,8,12"]
# stdin: line 1 = AdsPower API key, line 2 = Bananabun agent key. Empty line keeps the stored key.
# Idempotent: re-running updates the agent code, units and keys; AdsPower is installed only with --deb-url.
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT_SRC="$HERE/agent"
USER_NAME=adsagent
HOME_DIR=/home/$USER_NAME
SCRIPTS=$HOME_DIR/scripts
ETC=/etc/bananabun
DEB_URL=""
ALLOWED=""
SET_ALLOWED=0

while [ $# -gt 0 ]; do
  case "$1" in
    --deb-url) DEB_URL="${2:-}"; shift 2 ;;
    --allowed) ALLOWED="${2:-}"; SET_ALLOWED=1; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
[ -d "$AGENT_SRC" ] || { echo "agent/ not found next to install.sh" >&2; exit 1; }

# Keys come on stdin so they never appear in argv, the environment of other processes or logs.
IFS= read -r ADSPOWER_KEY || true
IFS= read -r AGENT_KEY || true

echo "== user"
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$HOME_DIR" --shell /usr/sbin/nologin "$USER_NAME"
fi
gpasswd -d "$USER_NAME" affiliate >/dev/null 2>&1 || true
gpasswd -d "$USER_NAME" sudo >/dev/null 2>&1 || true
chmod 700 "$HOME_DIR"

echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl iptables xvfb xauth fonts-liberation \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libgtk-3-0 libxss1 libxtst6 libsecret-1-0 \
  >/dev/null
apt-get install -y -qq --no-install-recommends libasound2t64 >/dev/null 2>&1 \
  || apt-get install -y -qq --no-install-recommends libasound2 >/dev/null

if [ -n "$DEB_URL" ]; then
  echo "== AdsPower"
  case "$DEB_URL" in
    https://*) ;;
    *) echo "deb URL must be https" >&2; exit 1 ;;
  esac
  HOST="$(printf '%s' "$DEB_URL" | sed -E 's#^https://([^/:?]+).*#\1#')"
  case "$HOST" in
    adspower.com|*.adspower.com|adspower.net|*.adspower.net|adspower.io|*.adspower.io) ;;
    *) echo "deb URL must be on an adspower domain, got: $HOST" >&2; exit 1 ;;
  esac
  DL="$(mktemp -d /root/adspower-dl.XXXXXX)"
  curl -fsSL --proto '=https' --max-time 600 -o "$DL/adspower.deb" "$DEB_URL"
  dpkg-deb --info "$DL/adspower.deb" >/dev/null
  apt-get install -y -qq "$DL/adspower.deb" >/dev/null
  rm -rf "$DL"
fi

BIN="$(command -v adspower_global || true)"
[ -n "$BIN" ] || BIN="$(find /opt /usr -maxdepth 4 -type f -name adspower_global 2>/dev/null | head -n1 || true)"
[ -n "$BIN" ] || { echo "adspower_global not found — run install with --deb-url" >&2; exit 1; }
ln -sfn "$BIN" /usr/local/bin/adspower_global
INSTALL_DIR="$(dirname "$(readlink -f "$BIN")")"
echo "AdsPower: $BIN"

echo "== agent code"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node not found" >&2; exit 1; }
NODE_FLAGS=""
if ! "$NODE" -e 'process.exit(typeof WebSocket === "function" ? 0 : 1)'; then
  if "$NODE" --experimental-websocket -e 'process.exit(typeof WebSocket === "function" ? 0 : 1)' 2>/dev/null; then
    NODE_FLAGS="--experimental-websocket"
  else
    echo "node $("$NODE" -v) has no WebSocket; need Node 20.10+ (flag) or 22+" >&2; exit 1
  fi
fi
install -d -o "$USER_NAME" -g "$USER_NAME" -m 700 "$SCRIPTS" "$SCRIPTS/logs" "$SCRIPTS/fb" "$SCRIPTS/push"
# Code only: tokens (fb/), push state, keys and logs of the Mac never travel here.
tar -C "$AGENT_SRC" --exclude='./fb' --exclude='./push' --exclude='./logs' --exclude='./node_modules' --exclude='./test' \
    --exclude='./.adspower_key' --exclude='./.bananabun_agent_key' --exclude='./*.plist' -cf - . \
  | tar -C "$SCRIPTS" --no-same-owner -xf -
chown -R "$USER_NAME:$USER_NAME" "$SCRIPTS"
chmod -R go-rwx "$SCRIPTS"

echo "== keys"
install -d -m 700 "$ETC"
write_key() { # file value — keeps the old key when value is empty
  local file="$1" value="$2"
  if [ -n "$value" ]; then
    printf '%s' "$value" > "$file"
  fi
  [ -s "$file" ] || { echo "missing key: $(basename "$file")" >&2; exit 1; }
}
write_key "$SCRIPTS/.adspower_key" "$ADSPOWER_KEY"
write_key "$SCRIPTS/.bananabun_agent_key" "$AGENT_KEY"
chown "$USER_NAME:$USER_NAME" "$SCRIPTS/.adspower_key" "$SCRIPTS/.bananabun_agent_key"
chmod 600 "$SCRIPTS/.adspower_key" "$SCRIPTS/.bananabun_agent_key"
# Only the key line is rewritten: ADSPOWER_XVFB / ADSPOWER_BLOCK_PORTS set by hand stay.
touch "$ETC/adspower.env"
grep -v '^ADSPOWER_API_KEY=' "$ETC/adspower.env" > "$ETC/adspower.env.new" || true
printf 'ADSPOWER_API_KEY=%s\n' "$(cat "$SCRIPTS/.adspower_key")" >> "$ETC/adspower.env.new"
mv "$ETC/adspower.env.new" "$ETC/adspower.env"
chmod 600 "$ETC/adspower.env"
if [ "$SET_ALLOWED" = 1 ] || [ ! -f "$ETC/agent.env" ]; then
  CLEAN="$(printf '%s' "$ALLOWED" | tr -cd '0-9,')"
  printf 'AGENT_ALLOWED_SERIALS=%s\n' "$CLEAN" > "$ETC/agent.env"
fi
chmod 600 "$ETC/agent.env"
unset ADSPOWER_KEY AGENT_KEY

echo "== firewall"
install -m 755 "$HERE/firewall.sh" /usr/local/sbin/bananabun-adspower-fw
install -m 755 "$HERE/run-adspower.sh" /usr/local/sbin/bananabun-run-adspower

echo "== services"
sed -e "s#@INSTALL_DIR@#$INSTALL_DIR#g" "$HERE/adspower.service" > /etc/systemd/system/adspower.service
sed -e "s#@NODE@#$NODE#g" -e "s#@NODE_FLAGS@#$NODE_FLAGS#g" "$HERE/bananabun-agent.service" > /etc/systemd/system/bananabun-agent.service
install -m 644 "$HERE/bananabun-adspower-fw.service" /etc/systemd/system/bananabun-adspower-fw.service
systemctl daemon-reload
systemctl enable --now bananabun-adspower-fw.service >/dev/null
# The site must still reach its own backend as its own user; if not, take the loopback rule back off.
if id -u affiliate >/dev/null 2>&1 && ! runuser -u affiliate -- curl -s -o /dev/null --max-time 5 http://127.0.0.1:4000/health; then
  echo "site lost loopback access — removing the outbound rule" >&2
  for ipt in iptables ip6tables; do command -v "$ipt" >/dev/null && "$ipt" -w -F BB_ADSPOWER_OUT 2>/dev/null || true; done
fi
systemctl enable adspower.service bananabun-agent.service >/dev/null
systemctl restart adspower.service
sleep 5
systemctl restart bananabun-agent.service
echo "installed; check with the status action"
