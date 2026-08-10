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

Production on every platform, including BT Panel, uses the repository's
`compose.yaml` and the HTTPS reverse-proxy section below. The raw `docker run`
examples in Plans A–C are **localhost-only temporary HTTP previews**. They are
not upgrade or production procedures, must not be exposed to another machine,
and intentionally have no automatic restart policy.

### Plan A: Windows local preview (CMD / PowerShell)

#### CMD batch script (`deploy-phd-atlas.bat`)

```batch
@echo off
chcp 65001 >nul
echo ========================================
echo   PhD Atlas - Windows Local Preview
echo ========================================
echo.

echo [1/5] Stopping and removing old preview container...
docker stop phd-atlas 2>nul
docker rm phd-atlas 2>nul
echo Done.

echo [2/5] Pulling latest image...
docker pull ghcr.io/zhoujasper/phd-atlas:latest
echo Done.

echo [3/5] Creating and starting localhost-only preview container...
docker run --detach --name phd-atlas --init --stop-timeout 75 ^
  --memory 1g --memory-reservation 512m --cpus 2 --pids-limit 256 ^
  --security-opt no-new-privileges --cap-drop ALL ^
  --log-opt max-size=10m --log-opt max-file=5 ^
  --env DOMAIN="http://localhost:8080" ^
  --env BASE_URL="http://localhost:8080" ^
  --env CORS_ORIGIN="http://localhost:8080" ^
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" ^
  --env NODE_ENV="development" ^
  --env SECURE="false" ^
  --env TRUST_PROXY="false" ^
  --volume phd-atlas-data:/app/storage ^
  --publish 127.0.0.1:8080:4317 ^
  ghcr.io/zhoujasper/phd-atlas:latest
echo Done.

echo [4/5] Waiting for container to start...
timeout /t 5 /nobreak >nul

echo [5/5] Checking container status...
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
Write-Host "  PhD Atlas - Windows Local Preview" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/5] Stopping and removing old preview container..." -ForegroundColor Yellow
docker stop phd-atlas 2>$null
docker rm phd-atlas 2>$null
Write-Host "Done." -ForegroundColor Green

Write-Host "[2/5] Pulling latest image..." -ForegroundColor Yellow
docker pull ghcr.io/zhoujasper/phd-atlas:latest
Write-Host "Done." -ForegroundColor Green

Write-Host "[3/5] Creating and starting localhost-only preview container..." -ForegroundColor Yellow
docker run --detach --name phd-atlas --init --stop-timeout 75 `
  --memory 1g --memory-reservation 512m --cpus 2 --pids-limit 256 `
  --security-opt no-new-privileges --cap-drop ALL `
  --log-opt max-size=10m --log-opt max-file=5 `
  --env DOMAIN="http://localhost:8080" `
  --env BASE_URL="http://localhost:8080" `
  --env CORS_ORIGIN="http://localhost:8080" `
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" `
  --env NODE_ENV="development" `
  --env SECURE="false" `
  --env TRUST_PROXY="false" `
  --volume phd-atlas-data:/app/storage `
  --publish 127.0.0.1:8080:4317 `
  ghcr.io/zhoujasper/phd-atlas:latest
Write-Host "Done." -ForegroundColor Green

Write-Host "[4/5] Waiting for container to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host "[5/5] Checking container status..." -ForegroundColor Yellow
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

### Plan B: Linux / Ubuntu local preview (Docker)

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
echo -e "${CYAN}  PhD Atlas - Linux Local Preview${NC}"
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

echo -e "${YELLOW}[1/6] Stopping and removing old preview container...${NC}"
sudo docker stop phd-atlas 2>/dev/null
sudo docker rm phd-atlas 2>/dev/null
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[2/6] Pulling latest image...${NC}"
sudo docker pull ghcr.io/zhoujasper/phd-atlas:latest
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[3/6] Creating localhost-only preview container...${NC}"
sudo docker run --detach --name phd-atlas --init --stop-timeout 75 \
  --memory 1g --memory-reservation 512m --cpus 2 --pids-limit 256 \
  --security-opt no-new-privileges --cap-drop ALL \
  --log-opt max-size=10m --log-opt max-file=5 \
  --env DOMAIN="http://localhost:8080" \
  --env BASE_URL="http://localhost:8080" \
  --env CORS_ORIGIN="http://localhost:8080" \
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" \
  --env NODE_ENV="development" \
  --env SECURE="false" \
  --env TRUST_PROXY="false" \
  --volume phd-atlas-data:/app/storage \
  --publish 127.0.0.1:8080:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[4/6] Waiting for container to start...${NC}"
sleep 5

echo -e "${YELLOW}[5/6] Checking container status...${NC}"
sudo docker ps | grep phd-atlas

echo -e "${YELLOW}[6/6] Viewing startup logs...${NC}"
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

docker run --detach --name phd-atlas --init --stop-timeout 75 \
  --memory 1g --memory-reservation 512m --cpus 2 --pids-limit 256 \
  --security-opt no-new-privileges --cap-drop ALL \
  --log-opt max-size=10m --log-opt max-file=5 \
  --env DOMAIN="http://localhost:8080" \
  --env BASE_URL="http://localhost:8080" \
  --env CORS_ORIGIN="http://localhost:8080" \
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" \
  --env NODE_ENV="development" \
  --env SECURE="false" \
  --env TRUST_PROXY="false" \
  --volume phd-atlas-data:/app/storage \
  --publish 127.0.0.1:8080:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest
```

### Plan C: BT Panel — local preview or production Compose

> Requires **Docker Manager** or **Docker** app installed in BT Panel.
> Plans A and B are isolated previews only: keep port 8080 bound to loopback and
> use an SSH tunnel if needed. Do not open it in the server firewall.

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
| Restart policy | `No automatic restart` |
| Memory / CPU / PIDs | `1 GiB / 2 CPUs / 256` |
| Security | `no-new-privileges`, drop all capabilities |

4. **Environment variables** (add each):

| Variable | Value |
|----------|-------|
| `DOMAIN` | `http://localhost:8080` |
| `BASE_URL` | `http://localhost:8080` |
| `CORS_ORIGIN` | `http://localhost:8080` |
| `ALLOWED_HOSTS` | `localhost,localhost:8080,127.0.0.1` |
| `NODE_ENV` | `development` |
| `SECURE` | `false` |
| `TRUST_PROXY` | `false` |

5. **Volume** (add):
   - Container path: `/app/storage`
   - Host path: `/www/wwwroot/phd-atlas-data` (or custom)

6. Click **Create** to start the container

**Step 3: Access**

From the host, visit `http://localhost:8080/admin`. From an administrator
workstation, first create an SSH tunnel; never expose this HTTP preview.

#### Method B: BT Panel SSH Terminal

In the BT Panel **Terminal**:

```bash
# 1. Stop and remove old container (if exists)
docker stop phd-atlas 2>/dev/null
docker rm phd-atlas 2>/dev/null

# 2. Create data directory
mkdir -p /www/wwwroot/phd-atlas-data
chown 1000:1000 /www/wwwroot/phd-atlas-data

# 3. Start container
docker run --detach --name phd-atlas --init --stop-timeout 75 \
  --memory 1g --memory-reservation 512m --cpus 2 --pids-limit 256 \
  --security-opt no-new-privileges --cap-drop ALL \
  --log-opt max-size=10m --log-opt max-file=5 \
  --env DOMAIN="http://localhost:8080" \
  --env BASE_URL="http://localhost:8080" \
  --env CORS_ORIGIN="http://localhost:8080" \
  --env ALLOWED_HOSTS="localhost,localhost:8080,127.0.0.1" \
  --env NODE_ENV="development" \
  --env SECURE="false" \
  --env TRUST_PROXY="false" \
  --volume /www/wwwroot/phd-atlas-data:/app/storage \
  --publish 127.0.0.1:8080:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest

# 4. Check status
docker ps | grep phd-atlas
docker logs phd-atlas --tail 20
```

#### Method C: Docker Compose (BT Panel supports this)

For production, upload the repository's unmodified `compose.yaml` and a reviewed
`.env`, then configure the HTTPS reverse proxy below. Do not recreate a reduced
panel-specific service: the supplied Compose file owns the stop window,
resource/PID/log limits, storage volume, proxy trust, and restart-fuse contract.

---

## Docker Compose (recommended for production)

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
cp .env.example .env
```

Edit `.env` and set both required first-boot values. The bootstrap token must
be a private 32–512-byte value from a password manager or
`openssl rand -base64 48`; do not use the placeholder literally:

```dotenv
DOMAIN=https://phd.example.com
PHD_ATLAS_BOOTSTRAP_TOKEN=<private-random-operator-token>
```

`BASE_URL`, `CORS_ORIGIN`, and `ALLOWED_HOSTS` are auto-derived from DOMAIN.
`JWT_SECRET` and `SETTINGS_ENCRYPTION_KEY` are auto-generated on first boot
and persisted to `storage/bootstrap-secrets.json`.

The supplied `compose.yaml` hard-pins `PHD_ATLAS_PROJECT_ROOT=/app` and
`PHD_ATLAS_STORAGE_ROOT=/app/storage`, matching its `phd-atlas-data` mount.
Values in `.env` cannot redirect container durability elsewhere, and the
container entrypoint refuses a mismatched storage root at startup. This keeps
the database, generated keys, uploads, backups, and persistent restart fuse
together across container replacement.

The supplied Compose service enforces `NODE_ENV=production`. Because its
published API port is fixed to host `127.0.0.1`, it also defaults
`TRUST_PROXY=1` for exactly one host reverse-proxy hop. Set `TRUST_PROXY` in
`.env` only when the private proxy chain is different, and then use the exact
hop count or trusted subnet. Never publish port 4317 on a public interface while
trusting forwarded headers. The image-level `TRUST_PROXY=loopback` default is
only the narrower fallback that lets the internal production readiness probe
authenticate its own forwarded HTTPS marker; Compose deliberately overrides it
for a host-side proxy.

Run exactly one PhD Atlas application replica. Do not use
`docker compose up --scale`, Docker Swarm replicas, PM2 cluster mode, or multiple
systemd units against the same workspace. SQLite coordinates its SQL file, but
realtime subscribers, admission queues, background ownership, update state, and
parts of upload coordination are intentionally process-local. The supported
100-user profile comes from bounded concurrency inside one worker, not from
sharing one storage volume across workers.

Keep the supplied shutdown windows layered: the worker drains requests and
background owners for at most 20 seconds, then uses a 40-second primary window
of referenced exponential backoff for final durable storage shutdown. If the
source of truth is still unavailable, the resident worker keeps retrying at a
maximum interval of five seconds; it never voluntarily exits with durability
unconfirmed. The
container's inner worker supervisor waits 70 seconds and Compose/systemd wait
at least 75 seconds before SIGKILL. The detached update helper stops waiting at
65 seconds, before either forced-kill boundary. It applies an update only when
the old PID is gone and a separate atomic safe-exit marker exactly matches the
update id, random handoff nonce, package, target, old PID, and exit code 75.
An OOM kill, manual kill, stale marker, or mismatched helper therefore aborts
the update. A forced kill is a last-resort data-risk boundary; do not reduce
these outer windows.

The container supervisor also owns a restart fuse persisted on the attached
`/app/storage` volume. Eight rapid worker or runtime-preparation failures write
`diagnostics/container-restart-fuse.json`. Compose may recreate the container
once, but the replacement reads that marker and waits the remaining 15-minute
cooldown before starting another worker. A normal isolated exit still recovers
through `restart: unless-stopped`; a configuration or OOM crash loop cannot spin
continuously across container IDs. Inspect the bounded diagnostics and correct
the cause during the cooldown. The marker expires and is removed automatically;
never detach `/app/storage` to bypass it.

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

`latest` and `stable` point to the highest validated stable release. `beta`
points only to the highest validated Beta and never moves stable installations
back onto a prerelease channel.

## Reverse proxy

### Nginx

Copy `deploy/nginx/phd-atlas.conf` to `/etc/nginx/sites-available/`, replace
the example hostname and certificate paths, then enable the site.

Key settings:
- Forward the original Host and `X-Forwarded-Proto` headers
- Keep `TRUST_PROXY` aligned with the private proxy path (`1` for the supplied
  host-loopback Compose topology; `loopback` for the same-host systemd unit)
- Forward `Upgrade` and `Connection` headers for WebSocket
- `proxy_read_timeout 3600s` (required for Admin update requests)
- Keep the server-wide `client_max_body_size` at `2m`. The supplied template
  widens only the complete audited multipart route families: general file
  batches to `502m` (20 x 25 MiB plus bounded multipart overhead), outgoing
  mail to `52m` (the application enforces a 50 MiB aggregate attachment
  budget), and system-update packages to `102m` (one 100 MiB package).
- Create `/var/lib/nginx/phd-atlas-client-body`, make it writable by the Nginx
  worker, and keep at least 6 GiB free on that dedicated filesystem before
  enabling the site. Upload-only zones cap active buffered uploads at eight
  globally/four per client IP and rate-limit upload starts. A campus/company
  NAT can therefore use half the bounded proxy capacity without starving other
  networks. Nginx-owned rejections return structured JSON 429 with
  `Retry-After`; SSE, workspace/AI streams, WebSocket, and ordinary API requests
  do not inherit these limits.
- Nginx-owned body-size rejections return structured JSON 413 with
  `REQUEST_TOO_LARGE` and `X-Request-Id`; application-owned structured 413
  responses pass through unchanged.
- The immutable asset cache stores only successful 200 responses. A deploy-race
  404 is explicitly excluded and is retried after the new build arrives.
- Gateway failures that occur before an SSE, NDJSON, AI, or WebSocket response
  starts use the same structured `503`/`Retry-After` contract as ordinary APIs.
  Once streaming has begun, its native protocol owns termination semantics.
- Keep the exact `/api/workspace/bootstrap/stream` location unbuffered; the
  route sends `X-Accel-Buffering: no` and flushes its protocol manifest before
  transferring bounded NDJSON chunks.
- Keep `application/x-ndjson` in `gzip_types`. Direct Node connections and the
  supplied proxy negotiate gzip, while clients that omit `Accept-Encoding`
  receive the identity stream. The NDJSON route remains private and
  `no-store`, and an existing upstream `Content-Encoding` remains authoritative.
  It deliberately does not emit `no-transform`, because that directive would
  prohibit the negotiated compression; SSE endpoints retain `no-transform`
  and remain uncompressed.

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
The WinSW template fixes `TRUST_PROXY=loopback` because IIS ARR is on the same
host. A remote proxy may use only its exact trusted private subnet. WinSW
restarts twice, then performs no further restart until its one-hour failure
window resets; inspect the logs before manually restarting a fused service.

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
sudo mkdir -p /etc/phd-atlas
sudo cp /opt/phd-atlas/.env.example /etc/phd-atlas/phd-atlas.env
sudo chmod 0600 /etc/phd-atlas/phd-atlas.env
# Edit /etc/phd-atlas/phd-atlas.env — set DOMAIN and PHD_ATLAS_BOOTSTRAP_TOKEN

# Install the systemd service
sudo cp /opt/phd-atlas/deploy/linux/phd-atlas.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now phd-atlas
```

The unit pins `NODE_ENV=production`, `TRUST_PROXY=loopback`, and a 1 GiB
`RUNTIME_MEMORY_BUDGET_BYTES` on `ExecStart`. It deliberately does **not** pin
`UV_THREADPOOL_SIZE`: `tools/start-server.mjs` derives the libuv pool from the
host CPU count and only does so while that variable is unset, so setting it
here would hold every host at the formula's floor.
This is intentional: systemd `EnvironmentFile=` values override ordinary
`Environment=` assignments regardless of where those lines appear, whereas
the final `/usr/bin/env` assignments on `ExecStart` cannot be downgraded by a
stale environment file. The template therefore assumes the supplied Nginx
proxy runs on the same host. For a remote private proxy, replace the unit's
`loopback` value with that proxy's exact trusted subnet in a reviewed unit
override; changing `/etc/phd-atlas/phd-atlas.env` alone will not override this
security invariant.

The default storage root is `/opt/phd-atlas/storage`, already covered by
`ReadWritePaths=/opt/phd-atlas`. For an external `PHD_ATLAS_STORAGE_ROOT`,
create/chown that exact absolute path and add it with `ReadWritePaths=` in the
same reviewed drop-in. Alternatively set `StateDirectory=phd-atlas` and use
`PHD_ATLAS_STORAGE_ROOT=/var/lib/phd-atlas`. Under `ProtectSystem=strict`,
changing only the environment variable correctly leaves an external path
unwritable and is not a valid deployment.

The native unit also bounds restart and resource failure modes: at most six
starts in five minutes, a 75-second final stop ceiling around the worker's
20-second drain plus 40-second primary durability-recovery window,
`MemoryHigh=768M`, `MemoryMax=1G`,
`TasksMax=256`, and `CPUQuota=200%`. These are overridable systemd defaults.
The fixed 512 MiB application budget puts its default hard admission boundary
at 448 MiB. That leaves 320 MiB before `MemoryHigh` and 576 MiB before
`MemoryMax`, both larger than the current maximum 128 MiB single reservation.
For 100-user production capacity, raise the application budget along with the
OS/cgroup ceiling instead of keeping the low-resource template profile.

| Concurrent users | `RUNTIME_MEMORY_BUDGET_BYTES` | Notes |
| --- | --- | --- |
| ≤ 20 | `536870912` (512 MiB) | Fits small VPS deployments |
| ≤ 100 | `1073741824` – `2147483648` (1–2 GiB) | Keep OS/cgroup limit above this budget |

When no cgroup limit is reported, the process now falls back to a 1024 MiB
application budget. `/api/health` reports `eventLoopLagP50`,
`eventLoopLagP99`, `rssBytes`, `memoryBudgetBytes`, and `pressureLevel` for
capacity checks.
Use `sudo systemctl edit phd-atlas`, place `StartLimitIntervalSec` and
`StartLimitBurst` under `[Unit]` and resource/stop overrides under `[Service]`,
then run `sudo systemctl daemon-reload && sudo systemctl restart phd-atlas`.
Keep `MemoryMax` above `RUNTIME_MEMORY_BUDGET_BYTES`; otherwise the kernel may
kill the worker before its structured memory-pressure response can protect
active users. After a real crash loop reaches the start limit, inspect the
worker diagnostics before using `sudo systemctl reset-failed phd-atlas`.

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

## Management commands (Docker Compose on every platform)

Run these commands from the directory containing the reviewed `compose.yaml`
and `.env`:

```bash
docker compose stop
docker compose start
docker compose restart
docker compose logs --tail 50 phd-atlas
docker compose exec phd-atlas sh
```

## Notes

1. **Always use the configured HTTPS domain name** to avoid host-policy errors
2. **First visit must present the private bootstrap token, then create an admin account**
3. Set `DOMAIN` to the public HTTPS origin, for example `https://phd.example.com`
4. Production deployments require HTTPS through the reviewed reverse proxy
5. Data is stored in Docker volumes — back up the volume or mounted directory
6. The `/admin` setup page supports light/dark theme toggle and language switching
   (12 languages)

## Acceptance checks

- `/api/health/live` returns 200 while the Node process is alive; use it only
  as the container/orchestrator liveness probe
- `/api/health/ready` returns 200 only after storage recovery and while memory
  and external-database state can safely accept traffic; use it for load-balancer
  readiness (the legacy `/api/health` remains an always-200 diagnostic surface)
- `/api/health/ws` upgrades with 101 only while the instance is ready
- A fresh installation shows the `/admin` setup steps with theme and language controls
- The selected database passes its connection test and survives a restart
- Normal and administrator login work
- Create, edit, delete, upload, download, and export all function
- A whole-workspace backup can be created and its restore tested
- PWA manifest and service worker load over HTTPS
- SMTP and web push pass their respective tests
