# Deploying PhD Atlas

[English](DEPLOYMENT.md) | [简体中文](DEPLOYMENT.zh-CN.md)

Production deployment, reverse proxy, backup, and upgrade guide. For the quick
start, read [INSTALLATION.md](INSTALLATION.md) first.

## Production requirements

- Docker Engine 24+ (recommended) or 64-bit Node.js 24 LTS
- Persistent local disk for `storage/` (no NFS/SMB for SQLite)
- HTTPS reverse proxy (Nginx, Caddy, Traefik, IIS ARR)
- At least 1 GB RAM

---

## Deployment plans

Three-platform deployment scripts for Windows, Linux, and BT Panel.

### Plan A: Windows (CMD / PowerShell)

#### CMD batch script (`deploy-phd-atlas.bat`)

```batch
@echo off
chcp 65001 >nul
echo ========================================
echo   PhD Atlas - Windows Docker Deploy
echo ========================================
echo.

echo [1/6] Stopping and removing old container...
docker stop phd-atlas 2>nul
docker rm phd-atlas 2>nul
echo Done.

echo [2/6] Removing old data volume (clears data)...
docker volume rm phd-atlas-data 2>nul
echo Done.

echo [3/6] Pulling latest image...
docker pull ghcr.io/zhoujasper/phd-atlas:latest
echo Done.

echo [4/6] Creating and starting container...
docker run --detach --name phd-atlas ^
  --env DOMAIN="http://localhost:8080" ^
  --env BASE_URL="http://localhost:8080" ^
  --env CORS_ORIGIN="http://localhost:8080" ^
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" ^
  --env NODE_ENV="development" ^
  --env SECURE="false" ^
  --env TRUST_PROXY="false" ^
  --volume phd-atlas-data:/app/storage ^
  --restart unless-stopped ^
  --publish 127.0.0.1:8080:4317 ^
  ghcr.io/zhoujasper/phd-atlas:latest
echo Done.

echo [5/6] Waiting for container to start...
timeout /t 5 /nobreak >nul

echo [6/6] Checking container status...
docker ps | findstr phd-atlas

echo.
echo ========================================
echo   Deploy complete!
echo   Visit: http://localhost:8080/admin
echo   First visit creates the admin account
echo   Use localhost, not 127.0.0.1
echo ========================================
echo.
docker logs phd-atlas --tail 10
echo.
pause
```

#### PowerShell script (`deploy-phd-atlas.ps1`)

```powershell
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PhD Atlas - Windows Docker Deploy" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/6] Stopping and removing old container..." -ForegroundColor Yellow
docker stop phd-atlas 2>$null
docker rm phd-atlas 2>$null
Write-Host "Done." -ForegroundColor Green

Write-Host "[2/6] Removing old data volume..." -ForegroundColor Yellow
docker volume rm phd-atlas-data 2>$null
Write-Host "Done." -ForegroundColor Green

Write-Host "[3/6] Pulling latest image..." -ForegroundColor Yellow
docker pull ghcr.io/zhoujasper/phd-atlas:latest
Write-Host "Done." -ForegroundColor Green

Write-Host "[4/6] Creating and starting container..." -ForegroundColor Yellow
docker run --detach --name phd-atlas `
  --env DOMAIN="http://localhost:8080" `
  --env BASE_URL="http://localhost:8080" `
  --env CORS_ORIGIN="http://localhost:8080" `
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" `
  --env NODE_ENV="development" `
  --env SECURE="false" `
  --env TRUST_PROXY="false" `
  --volume phd-atlas-data:/app/storage `
  --restart unless-stopped `
  --publish 127.0.0.1:8080:4317 `
  ghcr.io/zhoujasper/phd-atlas:latest
Write-Host "Done." -ForegroundColor Green

Write-Host "[5/6] Waiting for container to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host "[6/6] Checking container status..." -ForegroundColor Yellow
docker ps | findstr phd-atlas

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Deploy complete!" -ForegroundColor Green
Write-Host "  Visit: http://localhost:8080/admin" -ForegroundColor Green
Write-Host "  First visit creates the admin account" -ForegroundColor Yellow
Write-Host "  Use localhost, not 127.0.0.1" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
docker logs phd-atlas --tail 10
Read-Host "Press Enter to exit"
```

### Plan B: Linux / Ubuntu (Docker)

#### Deployment script (`deploy-phd-atlas.sh`)

```bash
#!/bin/bash

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  PhD Atlas - Linux Docker Deploy${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Check Docker installation
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker not installed!${NC}"
    echo "Install Docker first:"
    echo "  curl -fsSL https://get.docker.com | sudo sh"
    echo "  sudo usermod -aG docker \$USER"
    exit 1
fi

echo -e "${YELLOW}[1/7] Stopping and removing old container...${NC}"
sudo docker stop phd-atlas 2>/dev/null
sudo docker rm phd-atlas 2>/dev/null
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[2/7] Removing old data volume...${NC}"
sudo docker volume rm phd-atlas-data 2>/dev/null
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[3/7] Pulling latest image...${NC}"
sudo docker pull ghcr.io/zhoujasper/phd-atlas:latest
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[4/7] Creating and starting container...${NC}"
sudo docker run --detach --name phd-atlas \
  --env DOMAIN="http://localhost:8080" \
  --env BASE_URL="http://localhost:8080" \
  --env CORS_ORIGIN="http://localhost:8080" \
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" \
  --env NODE_ENV="development" \
  --env SECURE="false" \
  --env TRUST_PROXY="false" \
  --volume phd-atlas-data:/app/storage \
  --restart unless-stopped \
  --publish 127.0.0.1:8080:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[5/7] Waiting for container to start...${NC}"
sleep 5

echo -e "${YELLOW}[6/7] Checking container status...${NC}"
sudo docker ps | grep phd-atlas

echo -e "${YELLOW}[7/7] Viewing startup logs...${NC}"
sudo docker logs phd-atlas --tail 10

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}Deploy complete!${NC}"
echo -e "${GREEN}Visit: http://localhost:8080/admin${NC}"
echo -e "${YELLOW}First visit creates the admin account${NC}"
echo -e "${RED}Use localhost, not 127.0.0.1${NC}"
echo -e "${CYAN}========================================${NC}"
```

#### Usage

```bash
# 1. Make executable
chmod +x deploy-phd-atlas.sh

# 2. Run
./deploy-phd-atlas.sh
```

#### Without sudo (non-root Docker user)

```bash
#!/bin/bash
# If Docker is already configured for non-root users, omit sudo

docker run --detach --name phd-atlas \
  --env DOMAIN="http://localhost:8080" \
  --env BASE_URL="http://localhost:8080" \
  --env CORS_ORIGIN="http://localhost:8080" \
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" \
  --env NODE_ENV="development" \
  --env SECURE="false" \
  --env TRUST_PROXY="false" \
  --volume phd-atlas-data:/app/storage \
  --restart unless-stopped \
  --publish 127.0.0.1:8080:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest
```

### Plan C: BT Panel (Baota) — Docker

> Requires **Docker Manager** or **Docker** app installed in BT Panel.
> Make sure port **8080** (or your custom port) is open on the server.

#### Method A: BT Docker Manager (GUI)

**Step 1: Pull the image**

1. Log in to BT Panel
2. Go to **Docker** → **Image Management**
3. Click **Pull Image**
4. Enter: `ghcr.io/zhoujasper/phd-atlas:latest`
5. Click **Pull**

**Step 2: Create the container**

1. Go to **Docker** → **Container Management**
2. Click **Create Container**
3. Configure as follows:

| Setting | Value |
|---------|-------|
| Container name | `phd-atlas` |
| Image | `ghcr.io/zhoujasper/phd-atlas:latest` |
| Port mapping | `127.0.0.1:8080:4317` |
| Restart policy | `Always restart unless stopped` |

4. **Environment variables** (add each):

| Variable | Value |
|----------|-------|
| `DOMAIN` | `http://your-domain-or-ip:8080` |
| `BASE_URL` | `http://your-domain-or-ip:8080` |
| `CORS_ORIGIN` | `http://your-domain-or-ip:8080` |
| `ALLOWED_HOSTS` | `localhost,your-domain-or-ip` |
| `NODE_ENV` | `development` |
| `SECURE` | `false` |
| `TRUST_PROXY` | `false` |

5. **Volume** (add):
   - Container path: `/app/storage`
   - Host path: `/www/wwwroot/phd-atlas-data` (or custom)

6. Click **Create** to start the container

**Step 3: Access**

Visit `http://your-server-ip:8080/admin` to complete setup.

#### Method B: BT Panel SSH Terminal

In the BT Panel **Terminal**:

```bash
# 1. Stop and remove old container (if exists)
docker stop phd-atlas 2>/dev/null
docker rm phd-atlas 2>/dev/null

# 2. Create data directory
mkdir -p /www/wwwroot/phd-atlas-data

# 3. Start container
docker run --detach --name phd-atlas \
  --env DOMAIN="http://your-server-ip:8080" \
  --env BASE_URL="http://your-server-ip:8080" \
  --env CORS_ORIGIN="http://your-server-ip:8080" \
  --env ALLOWED_HOSTS="localhost,127.0.0.1,your-server-ip" \
  --env NODE_ENV="production" \
  --env SECURE="false" \
  --env TRUST_PROXY="false" \
  --volume /www/wwwroot/phd-atlas-data:/app/storage \
  --restart unless-stopped \
  --publish 127.0.0.1:8080:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest

# 4. Check status
docker ps | grep phd-atlas
docker logs phd-atlas --tail 20
```

#### Method C: Docker Compose (BT Panel supports this)

Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  phd-atlas:
    image: ghcr.io/zhoujasper/phd-atlas:latest
    container_name: phd-atlas
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:4317"
    environment:
      DOMAIN: "http://your-server-ip:8080"
      BASE_URL: "http://your-server-ip:8080"
      CORS_ORIGIN: "http://your-server-ip:8080"
      ALLOWED_HOSTS: "localhost,127.0.0.1,your-server-ip"
      NODE_ENV: "production"
      SECURE: "false"
      TRUST_PROXY: "false"
    volumes:
      - /www/wwwroot/phd-atlas-data:/app/storage
```

Upload this file in BT Docker Manager and start it.

---

## Docker Compose (recommended for production)

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
cp .env.example .env
```

Edit `.env` — the bare minimum is:

```dotenv
DOMAIN=https://phd.example.com
```

`BASE_URL`, `CORS_ORIGIN`, and `ALLOWED_HOSTS` are auto-derived from DOMAIN.
`JWT_SECRET` and `SETTINGS_ENCRYPTION_KEY` are auto-generated on first boot
and persisted to `storage/bootstrap-secrets.json`.

```bash
docker compose pull
docker compose up -d --wait
docker compose ps
```

### Container networking

- `localhost` inside the container is the container itself
- Use `host.docker.internal` to reach a database on the Docker host
- Use a Compose service name for a database in the same project
- The `/app/storage` volume must remain attached even with an external database

### Pinning a release

```dotenv
PHD_ATLAS_IMAGE=ghcr.io/zhoujasper/phd-atlas:0.1.0-beta.2
# Or NJU mirror
# PHD_ATLAS_IMAGE=ghcr.nju.edu.cn/zhoujasper/phd-atlas:0.1.0-beta.2
```

Or an immutable reference:

```dotenv
PHD_ATLAS_IMAGE=ghcr.io/zhoujasper/phd-atlas@sha256:<manifest-digest>
# Or NJU mirror
# PHD_ATLAS_IMAGE=ghcr.nju.edu.cn/zhoujasper/phd-atlas@sha256:<manifest-digest>
```

`latest` and `beta` always point to the same latest Beta release.

## Reverse proxy

### Nginx

Copy `deploy/nginx/phd-atlas.conf` to `/etc/nginx/sites-available/`, replace
the example hostname and certificate paths, then enable the site.

Key settings:
- Forward the original Host and `X-Forwarded-Proto` headers
- Forward `Upgrade` and `Connection` headers for WebSocket
- `proxy_read_timeout 3600s` (required for Admin update requests)
- `client_max_body_size 550m`

### Caddy

```caddy
phd.example.com {
    reverse_proxy 127.0.0.1:4317
}
```

### Traefik

```yaml
labels:
  - "traefik.http.routers.phd-atlas.rule=Host(`phd.example.com`)"
  - "traefik.http.services.phd-atlas.loadbalancer.server.port=4317"
```

### IIS ARR

Copy `deploy/windows/web.config.example` to the IIS proxy site's `web.config`,
bind a valid HTTPS certificate, enable proxying, and preserve the Host header.

## Native deployment

### Ubuntu / Debian

```bash
# Install Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential python3 nginx

# Install the application
sudo useradd --system --home /opt/phd-atlas --shell /usr/sbin/nologin phd-atlas
sudo git clone https://github.com/zhoujasper/phd-atlas.git /opt/phd-atlas
sudo chown -R phd-atlas:phd-atlas /opt/phd-atlas
sudo -u phd-atlas bash -lc 'cd /opt/phd-atlas && npm ci && npm run build && npm prune --omit=dev'

# Configure
sudo cp /opt/phd-atlas/.env.example /etc/phd-atlas/phd-atlas.env
sudo chmod 0600 /etc/phd-atlas/phd-atlas.env
# Edit /etc/phd-atlas/phd-atlas.env — set DOMAIN

# Install the systemd service
sudo cp /opt/phd-atlas/deploy/linux/phd-atlas.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now phd-atlas
```

### RHEL / CentOS Stream

```bash
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs git gcc-c++ make python3 nginx
# Follow the same steps above; place the Nginx config under /etc/nginx/conf.d/
```

With SELinux enforcing:

```bash
sudo setsebool -P httpd_can_network_connect 1
```

### Windows Server

Requires Node.js 24 LTS + WinSW + IIS with ARR, URL Rewrite, and WebSocket
Protocol.

```powershell
git clone https://github.com/zhoujasper/phd-atlas.git C:\PhDAtlas
cd C:\PhDAtlas
Copy-Item .env.example .env
notepad .env    # set DOMAIN
npm ci
npm run build
npm prune --omit=dev
```

Save the WinSW executable as `C:\PhDAtlas\PhDAtlas.exe`, copy
`deploy\windows\PhDAtlas.xml.example` to `PhDAtlas.xml`, then install and
start the service. See the template comments for details.

## Upgrades

### Docker

```bash
# Base image upgrade
docker compose pull
docker compose up -d --wait

# Or in-app Admin update (beta.6+): Admin → System info → System update → Check
```

### Native

```bash
# Source checkout upgrade
sudo systemctl stop phd-atlas
cd /opt/phd-atlas
sudo -u phd-atlas git pull --ff-only
sudo -u phd-atlas npm ci
sudo -u phd-atlas npm run build
sudo -u phd-atlas npm prune --omit=dev
sudo systemctl start phd-atlas
```

Admin Release package update (beta.6+): Admin → System info → System update.
Supports automatic GitHub Release checks or manual `.tar.gz` upload. For the
one-time transition from Beta.5 or earlier to Beta.6, download the Beta.6
Release `.tar.gz` on a trusted machine and upload it through **Manual update**;
do not rely on the older automatic Install path.

Beta.6 and later update packages derive every production dependency directly
from the standard package manifest and lockfile. Exact integrity-pinned
dependency archives travel inside the Release package, while bounded npmjs,
npmmirror, Yarn-compatible, and applicable GitHub mirror fallback remains
available for legacy recovery and third-party lifecycle downloads.

## Backup and rollback

### Two-layer backup strategy

1. **In-app whole-workspace backup:** Admin → System info → Backups (includes
   hot SQLite-compatible image and uploads)
2. **Infrastructure snapshot:** stop the application, copy the complete
   `storage/` directory/volume, plus an external database snapshot if applicable

Keep the encryption key and exact release/image identifier with both layers.

### Rollback

Stop the application and restore the following as one set:
- The previous code/image version
- Its matching complete `storage/` snapshot
- The external database snapshot (if any)
- The matching `SETTINGS_ENCRYPTION_KEY`

> Rolling back only runtime files without restoring data may leave newer Beta
> data incompatible with older code.

## Management commands

### Windows
```cmd
docker stop phd-atlas
docker start phd-atlas
docker restart phd-atlas
docker logs phd-atlas --tail 50
docker exec -it phd-atlas sh
```

### Linux / BT Panel
```bash
docker stop phd-atlas
docker start phd-atlas
docker restart phd-atlas
docker logs phd-atlas --tail 50
docker exec -it phd-atlas sh
```

## Notes

1. **Always use localhost or domain name** to avoid 403 errors
2. **First visit must create an admin account**
3. If using a domain, set `DOMAIN` to `http://your-domain:8080`
4. Production deployments should configure HTTPS (Nginx reverse proxy)
5. Data is stored in Docker volumes — back up the volume or mounted directory
6. The `/admin` setup page supports light/dark theme toggle and language switching
   (12 languages)

## Acceptance checks

- `/api/health` returns success over public HTTPS, WebSocket upgrades with 101
- A fresh installation shows the `/admin` setup steps with theme and language controls
- The selected database passes its connection test and survives a restart
- Normal and administrator login work
- Create, edit, delete, upload, download, and export all function
- A whole-workspace backup can be created and its restore tested
- PWA manifest and service worker load over HTTPS
- SMTP and web push pass their respective tests
