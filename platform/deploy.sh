#!/bin/bash
set -e

# ============================================================
# Affiliate Platform — Deploy Script for Ubuntu 24/26 LTS
# Usage: bash deploy.sh <SERVER_IP> <DOMAIN> [DB_PASSWORD]
# Example: bash deploy.sh 1.2.3.4 panel.example.com MyS3cret!
# ============================================================

SERVER_IP="${1:?Usage: bash deploy.sh <IP> <DOMAIN> [DB_PASSWORD]}"
DOMAIN="${2:?Usage: bash deploy.sh <IP> <DOMAIN> [DB_PASSWORD]}"
DB_PASS="${3:-$(openssl rand -base64 24 | tr -d /=+ | head -c 32)}"
JWT_SECRET="$(openssl rand -base64 48 | tr -d /=+ | head -c 64)"
APP_DIR="/opt/affiliate"
APP_USER="affiliate"

echo "======================================"
echo " Deploying to ${SERVER_IP} (${DOMAIN})"
echo "======================================"

# ---- 1. Pack the project locally ----
echo "[1/8] Packing project..."
cd "$(dirname "$0")"
TMPTAR="/tmp/affiliate_deploy_$(date +%s).tar.gz"
tar -czf "$TMPTAR" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='frontend/dist' \
  --exclude='backend/uploads' \
  .
echo "  → $TMPTAR"

# ---- 2. Copy archive to server ----
echo "[2/8] Copying to server..."
scp -o StrictHostKeyChecking=no "$TMPTAR" "root@${SERVER_IP}:/tmp/affiliate.tar.gz"
rm "$TMPTAR"

# ---- 3. Run server setup via SSH ----
echo "[3/8] Setting up server..."
ssh -o StrictHostKeyChecking=no "root@${SERVER_IP}" bash -s -- \
  "$APP_USER" "$APP_DIR" "$DB_PASS" "$JWT_SECRET" "$DOMAIN" << 'REMOTE'

set -e
APP_USER="$1"
APP_DIR="$2"
DB_PASS="$3"
JWT_SECRET="$4"
DOMAIN="$5"

echo "--- Installing packages ---"
apt-get update -qq
apt-get install -y -qq curl gnupg2 ca-certificates lsb-release software-properties-common ufw fail2ban

# PostgreSQL official repo
if ! command -v psql &>/dev/null; then
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
  echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get install -y -qq postgresql-16
fi

# Nginx, Redis, Certbot
apt-get install -y -qq nginx redis-server certbot python3-certbot-nginx

# Node.js 20 LTS
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "  Node: $(node -v), npm: $(npm -v)"

# ---- Create system user ----
id "$APP_USER" &>/dev/null || useradd --system --create-home --shell /bin/bash "$APP_USER"

# ---- PostgreSQL ----
echo "--- Setting up PostgreSQL ---"
systemctl enable postgresql --now
su -c "psql -c \"SELECT 1\" 2>/dev/null || true" postgres
su -c "psql -tc \"SELECT 1 FROM pg_user WHERE usename='affiliate'\" | grep -q 1 || \
  psql -c \"CREATE USER affiliate WITH PASSWORD '${DB_PASS}'\"" postgres
su -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='affiliate'\" | grep -q 1 || \
  psql -c \"CREATE DATABASE affiliate OWNER affiliate\"" postgres

# ---- Redis ----
echo "--- Setting up Redis ---"
sed -i 's/^bind 127.0.0.1.*/bind 127.0.0.1/' /etc/redis/redis.conf
systemctl enable redis-server --now

# ---- Extract app ----
echo "--- Extracting app ---"
mkdir -p "$APP_DIR"
tar -xzf /tmp/affiliate.tar.gz -C "$APP_DIR"
rm /tmp/affiliate.tar.gz
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
mkdir -p "$APP_DIR/backend/uploads"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/backend/uploads"

# ---- Backend .env ----
echo "--- Writing backend .env ---"
cat > "$APP_DIR/backend/.env" << ENV
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://affiliate:${DB_PASS}@127.0.0.1:5432/affiliate
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=${JWT_SECRET}
UPLOADS_DIR=${APP_DIR}/backend/uploads
FA_AGENT_TOKEN=agt_e78e2432fb504bbaa2649b44
FA_WORKSPACE=ws_76b3003056c54172aa76cff8
KEITARO_URL=https://whynot.partners
KEITARO_API_KEY=9e65ec8f223606786e19e0ee0954442f
ENV
chown "$APP_USER:$APP_USER" "$APP_DIR/backend/.env"
chmod 600 "$APP_DIR/backend/.env"

# ---- Install deps & run migrations ----
echo "--- Installing backend deps ---"
cd "$APP_DIR/backend"
su -c "npm ci --omit=dev" "$APP_USER"
echo "--- Running migrations ---"
su -c "node src/db/migrate.js" "$APP_USER" || \
  su -c "node -e \"
    import('./src/db/client.js').then(async ({db}) => {
      const fs = await import('fs');
      const path = await import('path');
      const dir = './src/db/migrations';
      const files = fs.readdirSync(dir).sort();
      for (const f of files) {
        if (!f.endsWith('.sql')) continue;
        const sql = fs.readFileSync(path.join(dir,f),'utf8');
        await db.query(sql);
        console.log('  Applied:', f);
      }
      process.exit(0);
    }).catch(e=>{console.error(e);process.exit(1)});
  \"" "$APP_USER"

# ---- Build frontend ----
echo "--- Building frontend ---"
cd "$APP_DIR/frontend"
cat > .env.production << FENV
VITE_API_URL=https://${DOMAIN}
FENV
su -c "npm ci" "$APP_USER"
su -c "npm run build" "$APP_USER"

# ---- systemd: backend ----
echo "--- Creating systemd services ---"
cat > /etc/systemd/system/affiliate-backend.service << SVC
[Unit]
Description=Affiliate Platform Backend
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=${APP_DIR}/backend/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=affiliate-backend

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable affiliate-backend
systemctl restart affiliate-backend

# ---- Nginx ----
echo "--- Configuring Nginx ---"
cat > /etc/nginx/sites-available/affiliate << NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    # Frontend (static)
    root ${APP_DIR}/frontend/dist;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
        client_max_body_size 50m;
    }

    # Uploads
    location /uploads/ {
        alias ${APP_DIR}/backend/uploads/;
        expires 7d;
    }

    # SPA fallback
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/affiliate /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx

# ---- Firewall ----
echo "--- Configuring firewall ---"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ---- SSL ----
echo "--- Setting up SSL ---"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m admin@${DOMAIN} || \
  echo "  WARNING: SSL setup failed — run manually: certbot --nginx -d ${DOMAIN}"

echo ""
echo "======================================"
echo " Deploy complete!"
echo " URL: https://${DOMAIN}"
echo " DB password: ${DB_PASS}"
echo " Check logs: journalctl -u affiliate-backend -f"
echo "======================================"

REMOTE

echo ""
echo "======================================"
echo " Done! Open https://${DOMAIN}"
echo "======================================"
