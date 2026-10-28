#!/bin/bash
# Ships local source to production: backup → rsync → migrate → build → restart → health check.
set -euo pipefail
HOST=root@148.230.98.232
cd "$(dirname "$0")"

# One shared SSH connection for every step: the server drops bursts of new connections.
CTL="/tmp/bb-%C"
SSH="ssh -o ControlMaster=auto -o ControlPath=$CTL -o ControlPersist=120 -o ConnectTimeout=20"
ssh() { command $SSH "$@"; }
export RSYNC_RSH="$SSH"

ssh "$HOST" 'T=$(date +%Y%m%d-%H%M%S); tar --exclude=node_modules --exclude=dist --exclude=uploads -czf /root/backups/affiliate-src-$T.tgz -C /opt affiliate && echo "backup affiliate-src-$T.tgz"'

rsync -az --delete-after --exclude '._*' --exclude .DS_Store \
  --exclude node_modules --exclude dist --exclude uploads --exclude '.env' --exclude '.git' --exclude ship.sh \
  ./backend/src/ "$HOST:/opt/affiliate/backend/src/"
rsync -az --delete-after --exclude '._*' --exclude .DS_Store --exclude node_modules --exclude dist \
  ./frontend/src/ "$HOST:/opt/affiliate/frontend/src/"

ssh "$HOST" 'set -e
chown -R affiliate:affiliate /opt/affiliate/backend/src /opt/affiliate/frontend/src
cd /opt/affiliate/backend && sudo -u affiliate node src/db/migrate.js > /tmp/migrate.log 2>&1 || { cat /tmp/migrate.log; exit 1; }; grep -v skip /tmp/migrate.log
cd /opt/affiliate/frontend && printf "VITE_API_URL=\n" > .env && npx vite build --logLevel error && echo "frontend built"
systemctl restart affiliate-backend
sleep 3
systemctl is-active affiliate-backend
curl -s -o /dev/null -w "api %{http_code}\n" http://127.0.0.1:4000/api/agent/status'
