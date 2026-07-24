# Deploying PhD Atlas

[English](DEPLOYMENT.md) | [简体中文](DEPLOYMENT.zh-CN.md)

Production deployment, reverse proxy, backup, and upgrade guide. For the quick
start, read [INSTALLATION.md](INSTALLATION.md) first.

## Production requirements

- Docker Engine 24+ (recommended) or 64-bit Node.js 24 LTS
- Persistent local disk for `storage/` (no NFS/SMB for SQLite)
- HTTPS reverse proxy (Nginx, Caddy, Traefik, IIS ARR)
- At least 1 GB RAM

## Docker Compose

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
```

Or an immutable reference:

```dotenv
PHD_ATLAS_IMAGE=ghcr.io/zhoujasper/phd-atlas@sha256:<manifest-digest>
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

# Or in-app Admin update (beta.2+): Admin → System info → System update → Check
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

Admin Release package update (beta.2+): Admin → System info → System update.
Supports automatic GitHub Release checks or manual `.tar.gz` upload.

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

## Acceptance checks

- `/api/health` returns success over public HTTPS, WebSocket upgrades with 101
- A fresh installation shows the `/admin` setup steps
- The selected database passes its connection test and survives a restart
- Normal and administrator login work
- Create, edit, delete, upload, download, and export all function
- A whole-workspace backup can be created and its restore tested
- PWA manifest and service worker load over HTTPS
- SMTP and web push pass their respective tests
