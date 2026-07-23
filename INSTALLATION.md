# Install and use PhD Atlas

[English](INSTALLATION.md) | [简体中文](INSTALLATION.zh-CN.md)

This guide installs the public `zhoujasper/phd-atlas` edition. It never requires
access to the private `phd-atlas-source` repository.

> [!WARNING]
> PhD Atlas is still Beta. Back up the complete workspace before every update.
> Keep the code/image version, `storage/` snapshot, external-database snapshot,
> and `SETTINGS_ENCRYPTION_KEY` from the same deployment together.

## Choose an installation

- **Docker Compose (recommended):** shortest and most reproducible production
  path. The next successful Beta publication is configured to publish
  `linux/amd64` and `linux/arm64`; older image tags may be `linux/amd64` only,
  so verify the selected tag on GHCR before pinning it.
- **Native Node.js:** useful when a service must run directly under systemd or
  WinSW. Follow [DEPLOYMENT.md](DEPLOYMENT.md) after the first-use sections
  below.
- **Development:** clone the public repository, run `npm ci`, then `npm run dev`.

## Docker installation

### 1. Prepare the host

Install Docker Engine with the Compose plugin, or Docker Desktop. Verify both
the client and server:

```bash
docker version
docker compose version
```

Clone the public repository:

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
cp .env.example .env
```

On PowerShell, replace the last command with:

```powershell
Copy-Item .env.example .env
```

### 2. Configure production secrets

Generate two different secrets. A Docker-only Bash host can use the same Node
image that runs PhD Atlas; no host Node.js installation is required:

```bash
printf 'JWT_SECRET='
docker run --rm node:24-bookworm-slim node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
printf 'SETTINGS_ENCRYPTION_KEY='
docker run --rm node:24-bookworm-slim node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

PowerShell 5.1 or newer can generate the values without Node.js or OpenSSL:

```powershell
function New-AtlasSecret {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
"JWT_SECRET=$(New-AtlasSecret)"
"SETTINGS_ENCRYPTION_KEY=$(New-AtlasSecret)"
```

Edit `.env` and use the following shapes:

```dotenv
BASE_URL=https://phd.example.com
CORS_ORIGIN=https://phd.example.com
ALLOWED_HOSTS=phd.example.com
TRUST_PROXY=loopback
```

`BASE_URL` and `CORS_ORIGIN` are full HTTPS origins. `ALLOWED_HOSTS` is a
hostname, optionally with a non-standard port, and must not include `https://`.
Then set:

- `JWT_SECRET` to the first generated value;
- `SETTINGS_ENCRYPTION_KEY` to the second generated value;
- optional `APP_PORT` and `PHD_ATLAS_IMAGE` overrides.

The shared `.env.example` also contains `BOOTSTRAP_*` variables for the private
source edition. The public `zhoujasper/phd-atlas` build ignores them; public
operators do not need to replace those example values and may remove those
lines from their local `.env`.

Never rotate `SETTINGS_ENCRYPTION_KEY` by simply changing `.env`. It encrypts
saved database credentials, mail/AI secrets, uploads, and other durable
envelopes. A key change requires an explicit migration.

### 3. Pull and start

```bash
docker compose pull
docker compose up -d --wait
docker compose ps
docker compose logs --tail=100 phd-atlas
```

The service listens only on `127.0.0.1:4317` by default. Put an HTTPS reverse
proxy in front of it. The supplied Nginx and IIS templates forward normal HTTP
and the `/api/health/ws` WebSocket health channel.

Check the local service from the host, substituting the configured hostname:

```bash
curl -fsS \
  -H 'Host: phd.example.com' \
  -H 'X-Forwarded-Proto: https' \
  http://127.0.0.1:4317/api/health
```

## First-time `/admin` setup

Open `https://your-host/admin`. A new public installation shows four steps:

1. Create the first administrator.
2. Choose and verify the data store.
3. Verify the system SMTP mailbox.
4. Review and create the workspace.

No default public administrator password is shipped. The setup route closes
after the first active administrator is created.

### Supported databases

| Engine | Default | What the database account needs |
| --- | --- | --- |
| SQLite | Yes | Write access to the selected `.sqlite`/`.sqlite3` file and directory |
| MySQL / MariaDB | No | Connect plus create/select/insert/update on a dedicated database |
| PostgreSQL | No | Connect plus create/use schema and create/select/insert/update table |
| Microsoft SQL Server | No | Connect plus create/use schema and create/select/insert/update table |

For Docker SQLite, leave the path empty or keep it under
`/app/storage/*.sqlite`. Other container paths disappear unless separately
mounted.

For an external database, enter its host, port, database, account, password,
schema, and TLS preference. MySQL also offers an explicit MySQL 5.7.44
compatibility check. The target is prepared only after the connection succeeds.

PhD Atlas stores its durable workspace snapshot in one `phd_atlas_state` table;
uploads, backups, database connection metadata, and generated integration
material remain in `storage/`. Therefore the Docker volume is still mandatory
when using MySQL, PostgreSQL, or SQL Server.

### Database safety rules

- Use a dedicated, empty target database/schema during first-time setup.
- Do not point a fresh setup at an existing PhD Atlas `phd_atlas_state` row.
  Setup and **Save and migrate** write the current workspace snapshot to the
  selected target.
- To move an existing installation to another application server, copy the
  complete `storage/` directory/volume and retain the exact
  `SETTINGS_ENCRYPTION_KEY`. The copied `database-connection.json` lets the new
  server reopen the existing external source safely.
- To move the current workspace to a new database engine, first create and
  verify a whole-workspace backup. Then open **Admin → System configuration →
  Database connection**, choose the engine, select **Test connection**, and
  finally **Save and migrate**.
- Saved database passwords are encrypted and are never returned to the browser.
- In a container, `localhost` means the container itself. Use another Compose
  service name, a reachable DNS/IP, or `host.docker.internal` for a database on
  the Docker host.

The PostgreSQL TLS switch encrypts transport and validates the server
certificate chain. For a self-signed certificate or private CA used by a
database, SMTP server, or another outbound TLS service, store its PEM bundle in
the persistent volume and point Node.js at it:

```bash
docker compose exec phd-atlas mkdir -p /app/storage/certs
docker compose cp ./private-ca.pem phd-atlas:/app/storage/certs/private-ca.pem
```

Then add this to `.env` and recreate the service:

```dotenv
NODE_EXTRA_CA_CERTS=/app/storage/certs/private-ca.pem
```

```bash
docker compose up -d --wait
```

Installing the CA only in the Docker host's trust store is not enough to change
the trust store used by Node.js inside the container.

## Start using the application

After setup:

1. Sign in at `/` with the administrator or a user account.
2. Create an application and complete the school, program, supervisor,
   deadline, status, and progress fields.
3. Use the dossier tabs for checklist materials, correspondence, funding,
   tasks, and timeline events.
4. Configure user mail, AI providers, notifications, calendar feed, sharing,
   and PWA installation only when needed.
5. Create a whole-workspace backup from Admin and test a restore before adding
   irreplaceable data.

## Routine Docker operations

View status and logs:

```bash
docker compose ps
docker compose logs -f phd-atlas
```

Restart without deleting data:

```bash
docker compose restart phd-atlas
```

Refresh the rolling Beta base image:

```bash
docker compose pull
docker compose up -d --wait
```

For reproducible deployment, pin `PHD_ATLAS_IMAGE` in `.env` to a published
release tag, for example
`ghcr.io/zhoujasper/phd-atlas:0.1.0-beta.2` after that release exists. For a
cryptographically immutable image reference, use
`ghcr.io/zhoujasper/phd-atlas@sha256:<manifest-digest>` from GHCR; the
convenience `sha-...` tag is still a movable tag. This project intentionally
does not publish a `latest` tag.

### One-time beta.1 bootstrap

The already-published `v0.1.0-beta.1` predates the guarded updater described
below.

- **Docker beta.1:** set `PHD_ATLAS_IMAGE` in `.env` to the published
  `ghcr.io/zhoujasper/phd-atlas:0.1.0-beta.2` image (or its manifest digest),
  then run:

  ```bash
  docker compose pull phd-atlas
  docker compose up -d --wait phd-atlas
  ```

  This replaces the container runtime while preserving the named `storage/`
  volume. Verify the version and data before changing the pin again.
- **Native Linux or Windows beta.1:** do **not** upload beta.2 through the old
  Admin card. The beta.1 Linux unit uses systemd's default
  `KillMode=control-group` and grants write access only to
  `/opt/phd-atlas/storage`, so its detached helper is killed and cannot replace
  the runtime. The old native handoff also predates beta.2's guarded first-boot
  flow. Follow the stopped-service, Release-package-only procedure in
  [DEPLOYMENT.md](DEPLOYMENT.md#one-time-native-beta1-to-beta2-bootstrap).

After the installation is running beta.2 or later, use the Admin flow below.

### Update from Admin

On beta.2 and later, the public edition supports the same published GitHub
Release package on Docker, systemd, and WinSW:

1. Create and verify a whole-workspace backup and a stopped `storage/`
   snapshot.
2. Open **Admin → System information → System update**.
3. Select **Check for updates**, review the version and Release link, then
   select **Install vX**.
4. Expect a brief disconnect while the verified helper installs production
   dependencies and restarts the server. Reopen Admin and verify the displayed
   version, `/api/health`, and normal application data.

Automatic checks are fixed to the public `zhoujasper/phd-atlas` GitHub
Releases feed. The server accepts one matching package plus its `.sha256`
asset, enforces size/timeout/redirect/host limits, verifies the external
checksum and internal manifest, and only then schedules installation. If the
server cannot reach GitHub, expand **Manual update** and upload the trusted
`.tar.gz` Release asset instead.

An automatic package download is capped at 15 minutes. The browser allows up
to 30 minutes for either update path because package validation and the
pre-update whole-workspace backup complete before the server accepts the
restart. Configure every reverse proxy in front of PhD Atlas with at least a
60-minute upstream/read timeout.

The helper syntax-checks and import-preflights the managed runtime before
handoff. A candidate that passes then has a default 30-second first-boot trial.
If it fails or exits unexpectedly before confirmation, the supplied launcher
restores the previous active package or runtime snapshot and retries. If safe
restoration cannot complete, it records
`storage/.update-runtime-invalid.json` and refuses to start the application
instead of running a partly updated tree.

In Docker, the image entrypoint keeps the container alive while the helper
works. After a successful update, a content-addressed active package and
pointer remain under `/app/storage/active-update/`. If a container is recreated
from an older base image, the entrypoint revalidates and replays that newer
active package. A same-version or newer verified base image supersedes the
stale active package. No Docker socket is mounted or required.

`docker compose pull && docker compose up -d --wait` remains the way to refresh
or pin the base image. Restoring an older Beta requires its matching complete
`storage/` and external-database snapshots; otherwise the active package or
newer data can defeat an intended rollback.

### Back up the Docker volume

Create an in-app whole-workspace backup first. For an additional stopped-volume
copy, resolve the real Compose-generated volume name instead of assuming a
directory prefix:

```bash
container_id="$(docker compose ps -q phd-atlas)"
test -n "$container_id" || { echo "The phd-atlas container is not running." >&2; exit 1; }
volume_name="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/storage"}}{{.Name}}{{end}}{{end}}' "$container_id")"
test -n "$volume_name" || { echo "The /app/storage volume was not found." >&2; exit 1; }
if ! docker compose stop phd-atlas; then
  echo "Unable to stop the phd-atlas container; no backup was taken." >&2
  docker compose start phd-atlas || echo "The service could not be started." >&2
  exit 1
fi
trap 'docker compose start phd-atlas' EXIT
backup_status=0
docker run --rm -v "${volume_name}:/data:ro" -v "$PWD:/backup" \
  alpine tar -czf /backup/phd-atlas-storage.tgz -C /data . || backup_status=$?
start_status=0
docker compose start phd-atlas || start_status=$?
trap - EXIT
if [ "$backup_status" -ne 0 ]; then
  echo "Docker volume backup failed." >&2
fi
if [ "$start_status" -ne 0 ]; then
  echo "The backup command finished, but the service could not be started." >&2
fi
if [ "$backup_status" -ne 0 ] || [ "$start_status" -ne 0 ]; then exit 1; fi
```

PowerShell users can run the equivalent stopped-volume copy directly in Docker
Desktop:

```powershell
$containerId = docker compose ps -q phd-atlas
if (-not $containerId) { throw "The phd-atlas container does not exist." }
$volumeName = docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/storage"}}{{.Name}}{{end}}{{end}}' $containerId
if (-not $volumeName) { throw "The /app/storage volume was not found." }
$backupPath = (Get-Location).Path
$failures = @()
try {
  docker compose stop phd-atlas
  if ($LASTEXITCODE -ne 0) {
    $failures += "Unable to stop the phd-atlas container; no backup was taken."
  } else {
    docker run --rm `
      --mount "type=volume,source=$volumeName,target=/data,readonly" `
      --mount "type=bind,source=$backupPath,target=/backup" `
      alpine tar -czf /backup/phd-atlas-storage.tgz -C /data .
    if ($LASTEXITCODE -ne 0) { $failures += "Docker volume backup failed." }
  }
} finally {
  docker compose start phd-atlas
  if ($LASTEXITCODE -ne 0) { $failures += "The service could not be started." }
}
if ($failures.Count -gt 0) { throw ($failures -join " ") }
```

The Bash version also works from WSL when the repository path is available to
Docker Desktop.

Never run `docker compose down -v` unless permanent deletion of the complete
workspace is intentional.

## Native installation and reverse proxies

[DEPLOYMENT.md](DEPLOYMENT.md) contains the complete Ubuntu, RHEL-compatible,
other Linux, Windows Server + IIS, Nginx, service, upgrade, and rollback
procedures. From beta.2 onward, Admin Release checks and trusted manual package
uploads work on both the supplied Docker entrypoint and compatible
systemd/WinSW services.

## Troubleshooting

- **Docker API unavailable:** start Docker Desktop/Engine, then rerun
  `docker version`.
- **Compose says `.env` is missing:** copy `.env.example`, replace the public
  production URL and secret placeholders, and keep `.env` uncommitted. The
  public build ignores the private-only `BOOTSTRAP_*` entries.
- **Container is unhealthy:** inspect `docker compose logs phd-atlas`; invalid
  secrets, an unreachable selected external database, or incorrect host/HTTPS
  headers make health checks fail closed.
- **Database connection fails from Docker:** replace `localhost`; verify the
  database firewall, account privileges, schema, port, and TLS requirements.
- **Browser reports offline behind a proxy:** confirm WebSocket Upgrade and
  Connection headers reach `/api/health/ws`.
- **Release check cannot reach GitHub:** allow outbound HTTPS to
  `api.github.com` and `release-assets.githubusercontent.com`, or download the
  two Release assets elsewhere and use **Manual update**.
- **The Admin update request disconnects early:** raise the reverse proxy's
  upstream/read timeout to at least 60 minutes. The supplied Nginx template
  uses 3600 seconds; configure IIS ARR for at least 3600 seconds as well.
- **An update does not return to healthy:** inspect
  `docker compose logs phd-atlas`, `/app/storage/last-update-result.json`, and
  `/app/storage/update-helper.log` inside the container volume. Do not delete
  update markers blindly; restore the matching pre-update `storage/` and
  external-database snapshots, or recreate from a verified same/newer base
  image and recheck the logs.
- **Saved credentials become unreadable:** restore the matching
  `SETTINGS_ENCRYPTION_KEY`; do not create a new key over existing encrypted
  storage.
