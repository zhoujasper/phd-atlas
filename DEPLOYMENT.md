# Deploying PhD Atlas

[English](DEPLOYMENT.md) | [简体中文](DEPLOYMENT.zh-CN.md)

This guide covers production service, proxy, upgrade, backup, and rollback
operations for the public `zhoujasper/phd-atlas` edition. For the shortest
Docker path and the first-use walkthrough, start with
[INSTALLATION.md](INSTALLATION.md).

PhD Atlas runs as one Node.js process: Express serves both `/api` and the built
React application. The durable workspace can use SQLite, MySQL/MariaDB,
PostgreSQL, or Microsoft SQL Server. Regardless of the selected database,
`storage/` remains required for database connection metadata (with its password
encrypted), uploads, backups, update packages, caches, and generated
integration material.

> [!WARNING]
> The current release line is Beta. Runtime update packages are
> integrity-checked and rollback-aware, but database-schema and stored-data
> compatibility between Beta versions is not guaranteed. Before every
> deployment or update, verify a whole-workspace backup and keep the matching
> code/image version, `storage/` snapshot, external-database snapshot, and
> `SETTINGS_ENCRYPTION_KEY` together.

## Production requirements

- Docker Engine/Desktop with Compose for the recommended container deployment,
  or 64-bit Node.js 24 LTS for a native deployment. Vite 8 technically accepts
  Node `^20.19.0` or `>=22.12.0`, but Node 24 LTS is the supported production
  line for this project.
- Persistent local disk for `storage/`. When SQLite is selected, keep the live
  database on that local disk; do not place it on NFS, SMB, or another network
  filesystem.
- For MySQL/MariaDB, PostgreSQL, or SQL Server, a reachable dedicated
  database/schema and an account allowed to create and update the
  `phd_atlas_state` table.
- HTTPS at a reverse proxy. Production redirects ordinary HTTP requests to
  HTTPS, and the proxy must forward WebSocket upgrades for
  `/api/health/ws`.
- At least 1 GB RAM for a small personal deployment; allow more memory during
  `npm ci`, native-module compilation, and `npm run build`.

## Production configuration

Copy `.env.example` to `.env`. Generate different random values for
`JWT_SECRET` and `SETTINGS_ENCRYPTION_KEY`; the Docker-only and PowerShell
commands are in [INSTALLATION.md](INSTALLATION.md#2-configure-production-secrets).
Use these value shapes:

```dotenv
BASE_URL=https://phd.example.com
CORS_ORIGIN=https://phd.example.com
ALLOWED_HOSTS=phd.example.com
TRUST_PROXY=loopback
JWT_SECRET=replace-with-a-unique-random-value
SETTINGS_ENCRYPTION_KEY=replace-with-another-unique-random-value
```

`BASE_URL` and `CORS_ORIGIN` are full HTTPS origins. `ALLOWED_HOSTS` is a
hostname, optionally followed by a non-standard port, and must not contain
`https://`. Keep `.env` outside version control.

The shared `.env.example` contains private-edition `BOOTSTRAP_*` entries. The
public `zhoujasper/phd-atlas` build ignores those entries and ships no default
administrator password. Never rotate `SETTINGS_ENCRYPTION_KEY` by merely
changing the environment value: it protects durable credentials, uploads, and
other encrypted envelopes, so rotation requires an explicit migration.

On the first start, open `https://your-host/admin`. The one-time public setup
creates the first administrator, selects and tests the data store, verifies the
system SMTP mailbox, and creates the workspace. The setup route closes after
the first active administrator is created.

## Database deployment

The `/admin` setup and **Admin → System configuration → Database connection**
support:

| Engine | Recommended deployment |
| --- | --- |
| SQLite | Default; keep the file under persistent `storage/` |
| MySQL / MariaDB | Dedicated database; MySQL 5.7.44 compatibility can be checked explicitly |
| PostgreSQL | Dedicated database/schema; SSL validates the server certificate chain |
| Microsoft SQL Server | Dedicated database/schema |

External engines store the current workspace snapshot in one
`phd_atlas_state` table. Uploads and operational files do not move into that
table, so an external database does not replace the `storage/` volume or
directory.

Use a dedicated, empty target for first-time setup. A fresh setup and
**Save and migrate** write the current workspace into the selected target; do
not use either flow to “adopt” an existing `phd_atlas_state` row. To move an
existing installation to another application server, copy the complete
`storage/` directory/volume and preserve the exact
`SETTINGS_ENCRYPTION_KEY`. The copied
`storage/database-connection.json`—whose password field is encrypted—then lets
the new server reconnect to the existing external database.

Before changing database engines, create and verify a whole-workspace backup.
Then select the new engine, run **Test connection**, and only then choose
**Save and migrate**. PostgreSQL SSL verifies the certificate chain. For a
self-signed or private CA, place the PEM bundle under persistent
`storage/certs/`, set `NODE_EXTRA_CA_CERTS` to its in-container or native
absolute path, and restart the process. Installing the CA only on the Docker
host does not change the trust store used by Node.js inside the container.

See [Supported databases and safety rules](INSTALLATION.md#supported-databases)
for field and container-network details.

## Docker Compose (recommended)

The public prebuilt image is
[`ghcr.io/zhoujasper/phd-atlas`](https://github.com/zhoujasper/phd-atlas/pkgs/container/phd-atlas);
it does not require access to `phd-atlas-source` or a GitHub login. Clone the
public repository only to obtain `compose.yaml` and `.env.example`, then:

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
cp .env.example .env
# Edit .env before continuing.
docker compose pull
docker compose up -d --wait
docker compose ps
docker compose logs --tail=100 phd-atlas
```

PowerShell uses `Copy-Item .env.example .env` instead of `cp`.

`compose.yaml` defaults to the rolling
`ghcr.io/zhoujasper/phd-atlas:beta` channel. This project intentionally does
not publish a `latest` tag. For reproducible deployment, set
`PHD_ATLAS_IMAGE` in `.env` to a published prerelease tag—for example
`ghcr.io/zhoujasper/phd-atlas:0.1.0-beta.2` after that release exists. For a
cryptographically immutable deployment, use
`ghcr.io/zhoujasper/phd-atlas@sha256:<manifest-digest>` from GHCR; a
convenience `sha-...` tag can still be moved.

The next successful Beta publication is configured to build both
`linux/amd64` and `linux/arm64`. Older tags may be `linux/amd64` only, so
confirm the selected tag's manifest in GHCR before pinning it.

Compose binds the application to `127.0.0.1:4317` by default. To change the
host-side port on Bash or PowerShell, edit `.env`:

```dotenv
APP_PORT=8080
```

Then run `docker compose up -d --wait` again. The container still listens on
port 4317 internally.

The named volume mounted at `/app/storage` must remain attached even when an
external database is selected. In a container, `localhost` is the container
itself. Use another Compose service name, a reachable DNS/IP, or
`host.docker.internal` for a database on the Docker host; the supplied Compose
file provides the host-gateway mapping.

Starting with beta.2, Docker supports two upgrade paths:

- **Admin Release update:** check the fixed public GitHub Releases feed or
  upload the trusted `.tar.gz` asset manually. The container entrypoint keeps
  running while the update helper replaces and restarts the server worker.
- **Base-image update:** pull a published image and recreate the service with
  `docker compose pull` followed by `docker compose up -d --wait`.

Do not add `--build` when using the prebuilt `image:` configuration. Never run
`docker compose down -v` unless permanent deletion of the complete workspace
is intentional. Follow
[Update from Admin](INSTALLATION.md#update-from-admin) for the container replay
model and
[Back up the Docker volume](INSTALLATION.md#back-up-the-docker-volume) for safe
Bash and PowerShell stopped-volume copies.

## Ubuntu Server

The following native instructions target Ubuntu 22.04/24.04 or newer.

1. Install Node.js 24 LTS, Git, build tools, and Nginx. For example:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential python3 nginx
node --version
```

Confirm that `node --version` reports v24.

2. Create an unprivileged service account and install the public application:

```bash
sudo useradd --system --home /opt/phd-atlas --shell /usr/sbin/nologin phd-atlas
sudo git clone https://github.com/zhoujasper/phd-atlas.git /opt/phd-atlas
sudo chown -R phd-atlas:phd-atlas /opt/phd-atlas
sudo -u phd-atlas bash -lc 'cd /opt/phd-atlas && npm ci && npm run build && npm prune --omit=dev'
sudo install -d -o phd-atlas -g phd-atlas /opt/phd-atlas/storage
sudo install -d -m 0750 /etc/phd-atlas
sudo cp /opt/phd-atlas/.env.example /etc/phd-atlas/phd-atlas.env
sudo chmod 0600 /etc/phd-atlas/phd-atlas.env
sudoedit /etc/phd-atlas/phd-atlas.env
```

Keep a custom SQLite path under `/opt/phd-atlas/storage`. A path elsewhere
requires matching ownership and a deliberate systemd `ReadWritePaths` change.

3. Install and start the supplied unit:

```bash
sudo cp /opt/phd-atlas/deploy/linux/phd-atlas.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now phd-atlas
sudo systemctl status phd-atlas
curl -H 'Host: phd.example.com' \
  -H 'X-Forwarded-Proto: https' \
  http://127.0.0.1:4317/api/health
```

The supplied unit intentionally uses `Restart=on-failure`,
`KillMode=process`, and write access to `/opt/phd-atlas`. The Admin updater
starts a detached, integrity-checking helper and exits the main process with a
failure status; these unit settings let the helper finish while systemd waits
on the update lock and relaunches the service. Do not tighten the unit in a way
that kills the helper or makes the managed runtime read-only if Admin updates
must remain available.

4. Copy `deploy/nginx/phd-atlas.conf` to
`/etc/nginx/sites-available/phd-atlas`, replace the example hostname and
certificate paths, enable the site, and validate it:

```bash
sudo ln -s /etc/nginx/sites-available/phd-atlas /etc/nginx/sites-enabled/phd-atlas
sudo nginx -t
sudo systemctl reload nginx
```

The template sets a 550 MiB request limit, forwards the original host and
scheme, forwards WebSocket Upgrade/Connection headers, and keeps upstream reads
open for 3600 seconds. Keep a 60-minute upstream/read timeout for Admin update
requests. Obtain a valid TLS certificate before exposing the service.

## CentOS Stream / RHEL-compatible Linux

Use CentOS Stream 9/10 or another supported RHEL-compatible release. Do not
deploy a new internet-facing service on end-of-life CentOS Linux 7.

1. Install Node.js 24 LTS and the native build toolchain:

```bash
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs git gcc-c++ make python3 nginx
node --version
```

2. Follow the Ubuntu service-account, clone, build, environment, and systemd
   steps. The Nginx template normally goes under
   `/etc/nginx/conf.d/phd-atlas.conf`; remove or adapt the Debian
   `sites-available` steps.
3. After configuring a certificate, open HTTPS and start the services:

```bash
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
sudo nginx -t
sudo systemctl enable --now nginx phd-atlas
```

If SELinux is enforcing and Nginx cannot reach the local Node process:

```bash
sudo setsebool -P httpd_can_network_connect 1
```

## Other Linux distributions

Install Node.js 24 LTS, Git, Python 3, `make`, a C++ compiler, and an HTTPS
reverse proxy using supported distribution packages. Use the supplied unit on
systemd systems. The native build sequence is:

```bash
npm ci
npm run build
npm prune --omit=dev
NODE_ENV=production node tools/start-server.mjs
```

Run under a dedicated unprivileged user, load the production environment,
persist `storage/`, and proxy HTTPS to `127.0.0.1:4317`. If you create a custom
supervisor configuration, it must restart on the updater's non-zero exit,
leave the detached helper alive, and start through `tools/start-server.mjs` so
the update lock is honored.

## Windows Server

The supported native layout is Node.js 24 LTS + WinSW + IIS with ARR, URL
Rewrite, and the IIS WebSocket Protocol feature.

1. Install 64-bit Node.js 24 LTS, Git, IIS WebSocket Protocol, URL Rewrite 2,
   and Application Request Routing (ARR).
2. Clone the public repository and build in an elevated PowerShell:

```powershell
git clone https://github.com/zhoujasper/phd-atlas.git C:\PhDAtlas
Set-Location C:\PhDAtlas
Copy-Item .env.example .env
notepad .env
npm ci
npm run build
npm prune --omit=dev
```

3. Download a current stable WinSW executable from its official releases,
   save it as `C:\PhDAtlas\PhDAtlas.exe`, and copy
   `deploy\windows\PhDAtlas.xml.example` to
   `C:\PhDAtlas\PhDAtlas.xml`. The template runs
   `tools\start-server.mjs`, restarts after an update request, and leaves the
   project `.env` available to the launcher.
4. Install and verify the service:

```powershell
Set-Location C:\PhDAtlas
.\PhDAtlas.exe install
.\PhDAtlas.exe start
.\PhDAtlas.exe status
```

5. In IIS ARR, enable proxying and preserve the original Host header. Add
   `HTTP_X_FORWARDED_PROTO` to allowed server variables. Copy
   `deploy\windows\web.config.example` to the IIS proxy site's `web.config`,
   bind a valid HTTPS certificate, and point the site at a small directory
   containing that file:

```powershell
& $env:windir\System32\inetsrv\appcmd.exe set config `
  /section:system.webServer/proxy /enabled:true /preserveHostHeader:true
```

The template enables WebSocket forwarding and raises IIS's request limit to
550 MiB. In IIS Manager, open the server's **Application Request Routing
Cache → Server Proxy Settings** and set **Time-out (seconds)** to at least
`3600`. Set `BASE_URL` and `CORS_ORIGIN` to the full IIS HTTPS origin, set
`ALLOWED_HOSTS` to the hostname without a scheme, and use
`TRUST_PROXY=loopback`.

## Reverse-proxy verification

After configuring Nginx, IIS, Caddy, Traefik, or another proxy:

```bash
curl -fsS https://phd.example.com/api/health
```

Also open the application and confirm the browser receives a `101 Switching
Protocols` response for `wss://phd.example.com/api/health/ws`. A plain HTTP GET
to that endpoint intentionally returns `426`; it is not a successful
WebSocket check.

Preserve the original Host header and HTTPS scheme. Do not expose port 4317 to
the public internet when the reverse proxy is on the same host. Keep the
upstream/read timeout for Admin update requests at 60 minutes: a Release
download may occupy the server for up to 15 minutes, while the browser allows
30 minutes for download or upload, package validation, and the pre-update
whole-workspace backup. Short proxy defaults can disconnect the browser before
the server returns the verified result.

## Backup and rollback

Use two complementary backup layers:

1. **Admin whole-workspace archive:** includes a hot SQLite-compatible database
   image and uploads. For an external engine it also includes an engine-specific
   SQL representation of `phd_atlas_state`. Restore it only after selecting the
   same database adapter that created it.
2. **Infrastructure snapshot:** while the application is stopped, copy the
   complete `storage/` directory/volume and snapshot the external database
   when one is selected.

Keep the encryption key and exact release/image identifier with both layers.
SQLite WAL/SHM files are part of live database state; use the Admin hot backup
or copy the entire stopped `storage/` directory, never only one `.sqlite` file.

For a Beta rollback, stop the application and restore the previous code/image,
its matching complete `storage/` snapshot, the matching external-database
snapshot, and the matching `SETTINGS_ENCRYPTION_KEY` as one set. Rolling back
only runtime files may leave newer Beta data incompatible with older code.

## Upgrade paths

### Docker base image

```bash
docker compose pull
docker compose up -d --wait
docker compose ps
```

Record the published release tag and, for a fixed production image, pin its
`@sha256:<manifest-digest>` reference.

The base image is not the only durable update state. A successful Admin update
persists a content-addressed Release package and pointer under
`storage/active-update/`. On container recreation, the entrypoint verifies the
immutable image runtime: it replays an active package that is newer than the
base image, while a verified base image at the same or a newer version
supersedes and archives the stale active pointer. Keep the `storage/` snapshot
and image reference from the same deployment together.

### Native manual upgrade

This source-checkout path is for operators who intentionally maintain the
public Git repository. It is not the beta.1 package bootstrap described in the
next section. After the backups described above:

```bash
sudo systemctl stop phd-atlas
cd /opt/phd-atlas
sudo -u phd-atlas git pull --ff-only
sudo -u phd-atlas npm ci
sudo -u phd-atlas npm run build
sudo -u phd-atlas npm prune --omit=dev
sudo systemctl start phd-atlas
```

On Windows, stop WinSW, update and build in `C:\PhDAtlas`, then start the
service.

### One-time native beta.1 to beta.2 bootstrap

Do not submit beta.2 to the Admin update card in a native
`v0.1.0-beta.1` installation. That Linux release unit uses systemd's default
`KillMode=control-group`, so it kills the detached helper with the server, and
`ProtectSystem=strict` only grants write access to `/opt/phd-atlas/storage`.
The helper therefore cannot replace the runtime. The beta.1 native handoff also
predates beta.2's first-boot recovery.

The following one-time procedure uses only the two published beta.2 Release
assets and the validator/helper already installed with beta.1. It does not
clone or pull a source repository. Before starting:

1. While beta.1 is still running, create and verify an Admin whole-workspace
   backup.
2. If an external database is selected, prepare a vendor-native snapshot that
   can be restored with the same engine and adapter.
3. Confirm Node.js 24, `npm`, the native build toolchain, `curl`, `tar`, and
   enough free space for a second copy of `storage/` and `node_modules`.
4. Wait until `v0.1.0-beta.2` and both deterministic Release assets are
   published. Never substitute an asset from an issue, fork, or chat message.

#### Standard systemd layout

This block targets the supplied `/opt/phd-atlas` and
`/etc/phd-atlas/phd-atlas.env` layout. It downloads over HTTPS, verifies the
published sidecar and exact internal version, rejects unsafe archive paths,
stops the service, creates independent stopped-state backups, then invokes the
installed beta.1 helper manually outside the old systemd sandbox:

```bash
set -euo pipefail

release_version='0.1.0-beta.2'
release_tag="v${release_version}"
asset="phd-atlas-update-${release_version}-release.tar.gz"
release_root="https://github.com/zhoujasper/phd-atlas/releases/download/${release_tag}"
app_root='/opt/phd-atlas'
download_root="$(mktemp -d /tmp/phd-atlas-beta2.XXXXXX)"

cleanup_download() {
  case "$download_root" in
    /tmp/phd-atlas-beta2.*) rm -rf -- "$download_root" ;;
    *) echo "Refusing to remove unexpected path: $download_root" >&2 ;;
  esac
}
trap cleanup_download EXIT

current_version="$(
  sudo -u phd-atlas /usr/bin/node \
    -e "process.stdout.write(require('/opt/phd-atlas/package.json').version)"
)"
if [ "$current_version" != '0.1.0-beta.1' ]; then
  echo "This bootstrap requires beta.1; found $current_version." >&2
  exit 1
fi
if [ -e "$app_root/storage/.update-in-progress.json" ]; then
  echo 'An earlier update is unresolved. Restore/repair beta.1 before continuing.' >&2
  exit 1
fi
if ! sudo -u phd-atlas test -w "$app_root"; then
  echo 'The phd-atlas account cannot modify /opt/phd-atlas.' >&2
  exit 1
fi

curl --fail --location --proto '=https' --proto-redir '=https' \
  --output "$download_root/$asset" "$release_root/$asset"
curl --fail --location --proto '=https' --proto-redir '=https' \
  --output "$download_root/$asset.sha256" "$release_root/$asset.sha256"

checksum_line="$(tr -d '\r\n' < "$download_root/$asset.sha256")"
if [[ ! "$checksum_line" =~ ^([0-9a-fA-F]{64})[[:space:]]+\*?([^[:space:]]+)$ ]]; then
  echo 'The Release checksum sidecar is malformed.' >&2
  exit 1
fi
if [ "${BASH_REMATCH[2]}" != "$asset" ]; then
  echo 'The Release checksum sidecar names another file.' >&2
  exit 1
fi
actual_hash="$(sha256sum "$download_root/$asset" | awk '{print $1}')"
if [ "${BASH_REMATCH[1],,}" != "${actual_hash,,}" ]; then
  echo 'The Release package SHA-256 does not match its sidecar.' >&2
  exit 1
fi

archive_entries="$(tar -tzf "$download_root/$asset")"
if printf '%s\n' "$archive_entries" | grep -Eq '(^/)|(^|/)\.\.(/|$)|\\'; then
  echo 'The Release archive contains an unsafe path.' >&2
  exit 1
fi

manifest_json="$(
  tar -xOf "$download_root/$asset" ./update-manifest.json 2>/dev/null \
    || tar -xOf "$download_root/$asset" update-manifest.json
)"
manifest_version="$(
  printf '%s' "$manifest_json" |
    node -e "let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const m=JSON.parse(s);if(m.formatVersion!==1||m.appId!=='phd-atlas')process.exit(2);process.stdout.write(String(m.version||''))})"
)"
if [ "$manifest_version" != "$release_version" ]; then
  echo "Manifest version $manifest_version does not match $release_version." >&2
  exit 1
fi

sudo systemctl stop phd-atlas
if sudo systemctl is-active --quiet phd-atlas; then
  echo 'phd-atlas is still running; refusing to replace its runtime.' >&2
  exit 1
fi

backup_dir="/var/backups/phd-atlas/beta1-to-beta2-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 0700 "$backup_dir/runtime"
for entry in dist server tools node_modules package.json package-lock.json; do
  if [ ! -e "$app_root/$entry" ]; then
    echo "Required beta.1 runtime entry is missing: $entry" >&2
    exit 1
  fi
  sudo cp -a "$app_root/$entry" "$backup_dir/runtime/$entry"
done
sudo cp -a /etc/systemd/system/phd-atlas.service "$backup_dir/phd-atlas.service"
sudo cp -a /etc/phd-atlas/phd-atlas.env "$backup_dir/phd-atlas.env"
if [ -f "$app_root/.env" ]; then
  sudo cp -a "$app_root/.env" "$backup_dir/project.env"
fi
sudo tar -C "$app_root" -czf "$backup_dir/storage.tar.gz" storage
echo "Stopped beta.1 backup: $backup_dir"

bootstrap_package="$app_root/storage/update-packages/$asset"
sudo install -d -o phd-atlas -g phd-atlas "$app_root/storage/update-packages"
sudo install -o phd-atlas -g phd-atlas -m 0600 \
  "$download_root/$asset" "$bootstrap_package"

cd "$app_root"
sudo -u phd-atlas /usr/bin/node tools/apply-update.mjs \
  --package "$bootstrap_package" \
  --pid 0

sudo tee /etc/systemd/system/phd-atlas.service >/dev/null <<'UNIT'
[Unit]
Description=PhD Atlas
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=phd-atlas
Group=phd-atlas
WorkingDirectory=/opt/phd-atlas
EnvironmentFile=/etc/phd-atlas/phd-atlas.env
ExecStart=/usr/bin/node tools/start-server.mjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=35
KillSignal=SIGTERM
KillMode=process
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/phd-atlas

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl start phd-atlas
sudo systemctl is-active --quiet phd-atlas
installed_version="$(
  sudo -u phd-atlas /usr/bin/node \
    -e "process.stdout.write(require('/opt/phd-atlas/package.json').version)"
)"
if [ "$installed_version" != "$release_version" ]; then
  echo "Installed version is $installed_version, expected $release_version." >&2
  exit 1
fi
echo "PhD Atlas $installed_version is running. Backup retained at $backup_dir"
```

The beta.1 helper validates every manifest-listed runtime file and runs
`npm ci --omit=dev`; it attempts to restore its runtime snapshot if that step
fails. The separate backup above is still required. The script never replaces
`storage/`, `/etc/phd-atlas/phd-atlas.env`, a project `.env`, or the encryption
key. Because this one-time handoff is initiated by the beta.1 helper, it does
not create beta.2's pending first-boot trial; the independent backup and
post-start health/data checks are mandatory. After it succeeds, verify the
public `/api/health`, displayed version, logs, and a representative read/write
operation.

If the block stops after the service was stopped, leave the service stopped and
inspect `storage/last-update-result.json` and `storage/update-helper.log`.
Restore the printed runtime backup and the saved unit before restarting. If
beta.2 was started or wrote data, also restore the matching stopped `storage/`
archive and external-database snapshot; never combine beta.1 runtime with
beta.2 data.

#### Standard WinSW layout

Run the following in elevated PowerShell for the supplied `C:\PhDAtlas`
layout. It verifies and extracts the package with beta.1's tagged validator,
stops WinSW, copies only manifest-verified runtime files, runs `npm.cmd ci`
directly, preserves `.env` and `storage`, and writes the beta.2-compatible
standard WinSW configuration. It does not call beta.1's Windows installer:

```powershell
$ErrorActionPreference = 'Stop'
$null = Get-Command curl.exe -ErrorAction Stop
$null = Get-Command tar.exe -ErrorAction Stop

$releaseVersion = '0.1.0-beta.2'
$releaseTag = "v$releaseVersion"
$asset = "phd-atlas-update-$releaseVersion-release.tar.gz"
$releaseRoot = "https://github.com/zhoujasper/phd-atlas/releases/download/$releaseTag"
$expectedRoot = 'C:\PhDAtlas'
$appRoot = (Resolve-Path -LiteralPath $expectedRoot).Path.TrimEnd('\')
if (-not $appRoot.Equals($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "This block only supports the standard $expectedRoot layout."
}
$nodeExe = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw "Node.js 24 was not found at $nodeExe."
}
$npmCmd = 'C:\Program Files\nodejs\npm.cmd'
if (-not (Test-Path -LiteralPath $npmCmd)) {
  throw "npm was not found at $npmCmd."
}

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$workDir = Join-Path $tempBase ("phd-atlas-beta2-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workDir | Out-Null

try {
  Push-Location $appRoot
  try {
    $currentVersion = & $nodeExe `
      -e "process.stdout.write(require('./package.json').version)"
  } finally {
    Pop-Location
  }
  if ($currentVersion -ne '0.1.0-beta.1') {
    throw "This bootstrap requires beta.1; found $currentVersion."
  }
  if (Test-Path -LiteralPath (Join-Path $appRoot 'storage\.update-in-progress.json')) {
    throw 'An earlier update is unresolved. Restore/repair beta.1 first.'
  }

  $packagePath = Join-Path $workDir $asset
  $checksumPath = "$packagePath.sha256"
  & curl.exe --fail --location --proto '=https' --proto-redir '=https' `
    --output $packagePath "$releaseRoot/$asset"
  if ($LASTEXITCODE -ne 0) { throw 'Unable to download the Release package.' }
  & curl.exe --fail --location --proto '=https' --proto-redir '=https' `
    --output $checksumPath "$releaseRoot/$asset.sha256"
  if ($LASTEXITCODE -ne 0) { throw 'Unable to download the checksum sidecar.' }

  $checksumLine = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
  $checksumMatch = [regex]::Match(
    $checksumLine,
    '^(?<hash>[0-9a-fA-F]{64})\s+\*?(?<name>[^\s]+)\s*$'
  )
  if (-not $checksumMatch.Success -or $checksumMatch.Groups['name'].Value -ne $asset) {
    throw 'The Release checksum sidecar is malformed or names another file.'
  }
  $actualHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
  if (-not $actualHash.Equals(
    $checksumMatch.Groups['hash'].Value,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw 'The Release package SHA-256 does not match its sidecar.'
  }

  $archiveEntries = @(& tar -tzf $packagePath)
  if ($LASTEXITCODE -ne 0) { throw 'Unable to list the Release package.' }
  foreach ($entry in $archiveEntries) {
    if (
      $entry.StartsWith('/') -or
      $entry.StartsWith('\') -or
      $entry -match '(^|[\\/])\.\.([\\/]|$)'
    ) {
      throw "The Release archive contains an unsafe path: $entry"
    }
  }

  $validatorScript = Join-Path $workDir 'validate-update.mjs'
  @'
import { pathToFileURL } from 'node:url'
const [modulePath, packagePath, workRoot] = process.argv.slice(2)
const module = await import(pathToFileURL(modulePath).href)
const validated = await module.validateUpdatePackage(packagePath, workRoot)
process.stdout.write(JSON.stringify(validated))
'@ | Set-Content -LiteralPath $validatorScript -Encoding UTF8
  $validationRoot = Join-Path $workDir 'validation'
  $systemUpdateModule = Join-Path $appRoot 'server\systemUpdate.js'
  $validationJson = @(
    & $nodeExe $validatorScript $systemUpdateModule $packagePath $validationRoot
  )
  if ($LASTEXITCODE -ne 0) {
    throw 'The beta.1 validator rejected the Release package.'
  }
  $validated = ($validationJson -join "`n") | ConvertFrom-Json
  $manifest = $validated.manifest
  if (
    $manifest.formatVersion -ne 1 -or
    $manifest.appId -ne 'phd-atlas' -or
    $manifest.version -ne $releaseVersion
  ) {
    throw 'The update manifest is not the expected PhD Atlas beta.2 package.'
  }
  $extractRoot = [IO.Path]::GetFullPath([string]$validated.extractRoot).TrimEnd('\')
  $expectedValidationRoot = [IO.Path]::GetFullPath($validationRoot).TrimEnd('\')
  if (-not $extractRoot.StartsWith(
    "$expectedValidationRoot\",
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "The validator returned an unexpected extraction path: $extractRoot"
  }
  $manifestPaths = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )
  foreach ($file in @($manifest.files)) {
    $relativePath = [string]$file.path
    if (
      $relativePath.Contains('\') -or
      $relativePath.StartsWith('/') -or
      $relativePath.StartsWith('./') -or
      $relativePath.Contains('//') -or
      $relativePath -match '(^|/)\.\.(/|$)' -or
      (
        $relativePath -ne 'package.json' -and
        $relativePath -ne 'package-lock.json' -and
        $relativePath -notmatch '^(dist|server|tools)/.+'
      ) -or
      -not $manifestPaths.Add($relativePath)
    ) {
      throw "The manifest contains an unsafe or duplicate path: $relativePath"
    }
  }

  Push-Location $appRoot
  try {
    & .\PhDAtlas.exe stop
    if ($LASTEXITCODE -ne 0) { throw 'WinSW could not stop PhD Atlas.' }
  } finally {
    Pop-Location
  }
  $service = Get-Service -Name 'PhDAtlas'
  $service.Refresh()
  if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
    throw 'PhD Atlas is still running; refusing to replace its runtime.'
  }

  $backupRoot = "C:\PhDAtlas-backups\beta1-to-beta2-$(
    [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
  )"
  $runtimeBackup = Join-Path $backupRoot 'runtime'
  New-Item -ItemType Directory -Path $runtimeBackup -Force | Out-Null
  foreach ($entry in @(
    'dist', 'server', 'tools', 'node_modules', 'package.json', 'package-lock.json'
  )) {
    $source = Join-Path $appRoot $entry
    if (-not (Test-Path -LiteralPath $source)) {
      throw "Required beta.1 runtime entry is missing: $entry"
    }
    Copy-Item -LiteralPath $source `
      -Destination (Join-Path $runtimeBackup $entry) -Recurse -Force
  }
  Copy-Item -LiteralPath (Join-Path $appRoot 'storage') `
    -Destination (Join-Path $backupRoot 'storage') -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $appRoot 'PhDAtlas.xml') `
    -Destination (Join-Path $backupRoot 'PhDAtlas.xml') -Force
  if (Test-Path -LiteralPath (Join-Path $appRoot '.env')) {
    Copy-Item -LiteralPath (Join-Path $appRoot '.env') `
      -Destination (Join-Path $backupRoot '.env') -Force
  }
  Write-Host "Stopped beta.1 backup: $backupRoot"

  $packageRoot = Join-Path $appRoot 'storage\update-packages'
  New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
  $bootstrapPackage = Join-Path $packageRoot $asset
  Copy-Item -LiteralPath $packagePath -Destination $bootstrapPackage -Force

  Push-Location $appRoot
  try {
    foreach ($entry in @('dist', 'server', 'tools')) {
      Remove-Item -LiteralPath (Join-Path $appRoot $entry) -Recurse -Force
    }
    foreach ($file in @($manifest.files)) {
      $relativePath = [string]$file.path
      $source = Join-Path $extractRoot $relativePath.Replace('/', '\')
      $destination = Join-Path $appRoot $relativePath.Replace('/', '\')
      New-Item -ItemType Directory -Path (Split-Path -Parent $destination) `
        -Force | Out-Null
      Copy-Item -LiteralPath $source -Destination $destination -Force
    }
    & $npmCmd ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      throw 'npm could not install the beta.2 production dependencies.'
    }

    @'
<service>
  <id>PhDAtlas</id>
  <name>PhD Atlas</name>
  <description>PhD Atlas application server</description>
  <executable>C:\Program Files\nodejs\node.exe</executable>
  <arguments>tools\start-server.mjs</arguments>
  <workingdirectory>%BASE%</workingdirectory>
  <env name="NODE_ENV" value="production" />
  <env name="PORT" value="4317" />
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <stoptimeout>35 sec</stoptimeout>
  <logpath>%BASE%\logs\service</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
</service>
'@ | Set-Content -LiteralPath .\PhDAtlas.xml -Encoding UTF8

    & .\PhDAtlas.exe start
    if ($LASTEXITCODE -ne 0) { throw 'WinSW could not start PhD Atlas.' }
    $installedVersion = & $nodeExe `
      -e "process.stdout.write(require('./package.json').version)"
    if ($installedVersion -ne $releaseVersion) {
      throw "Installed version is $installedVersion, expected $releaseVersion."
    }
    Write-Host "PhD Atlas $installedVersion is running. Backup: $backupRoot"
  } finally {
    Pop-Location
  }
} finally {
  $resolvedWork = [IO.Path]::GetFullPath($workDir).TrimEnd('\')
  if (-not $resolvedWork.StartsWith(
    "$tempBase\",
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "Refusing to remove unexpected path: $resolvedWork"
  }
  Remove-Item -LiteralPath $resolvedWork -Recurse -Force
}
```

For a custom WinSW service account, confirm it has Modify permission on the
managed `C:\PhDAtlas` runtime as well as `storage` before enabling later Admin
updates. The Windows block intentionally does not call beta.1's installer:
that tagged helper can fail while spawning `npm.cmd` on current Windows Node
runtimes. If the block fails after stopping the service, keep it stopped and
restore the printed runtime and WinSW configuration; if beta.2 ran, also
restore the matching `storage` and external-database snapshots before
restarting.

### Admin Release update (Docker and native)

Tagged public GitHub Releases attach
`phd-atlas-update-<version>-release.tar.gz` and a matching `.sha256` file.
This section applies to beta.2 and later. After creating the complete backups:

1. Open **Admin → System information → System update**.
2. Select **Check for updates**. The public edition queries only
   `zhoujasper/phd-atlas`; the browser cannot supply an arbitrary download URL.
3. Review the Release page, version, publication time, and package size, then
   choose **Install vX**.
4. Wait for the process to restart, sign in again, and verify the version,
   `/api/health`, logs, and a representative read/write operation.

The download is HTTPS-only and bounded by allowed hosts, redirects, time, and
100 MiB. The server requires exactly one matching package and checksum asset,
streams and verifies the external SHA-256, checks the internal version and
manifest, validates every included managed file, and rejects unmanaged or
undeclared files before scheduling the restart.

The automatic package-download budget is 15 minutes. Both automatic and manual
Admin requests use a 30-minute browser budget because validation and the
pre-update whole-workspace backup run before the response. Set each reverse
proxy hop to 60 minutes so it cannot expire before the browser.

If GitHub is unavailable, download both Release assets through another trusted
machine, verify the `.sha256`, expand **Manual update**, and upload the
`.tar.gz`. Manual and automatic paths use the same internal validation and
installation helper.

The helper retains the previous runtime under `storage/update-rollbacks/`,
replaces only managed runtime files, runs `npm ci --omit=dev`, and attempts to
restore the previous runtime if installation fails. Results and diagnostics
are recorded in `storage/last-update-result.json`,
`storage/update-helper.log`, and, for an incomplete rollback,
`storage/.update-runtime-invalid.json`. It deliberately does not replace
`.env`, the selected database, uploads, or backups.

Before handoff, the helper syntax-checks every managed JavaScript file and
import-preflights the server and launchers. A candidate that passes remains a
trial boot for 30 seconds by default. Only after it stays up for that window is
the boot confirmed. If it fails or exits unexpectedly first, the supplied
launcher restores the previous content-addressed active package or rollback
snapshot and retries. A failed restoration writes
`storage/.update-runtime-invalid.json` and prevents another application worker
from starting. Preserve
`storage/.update-boot-pending.json` and the other update markers for diagnosis;
do not delete them to force a partly updated runtime to start. An intentional
service/container stop releases the trial claim, so the candidate resumes its
trial on the next start instead of being misclassified as a failed boot.

On native deployments, systemd/WinSW restarts the service after the worker's
intentional exit code 75. In Docker, `tools/container-entrypoint.mjs` remains
as PID 1's supervised process, waits for the helper lock to clear, and starts
the server worker again; it never requires the Docker socket. Keep an
independent whole-workspace backup and verify service health after every
update—the helper's rollback directory is not a substitute for an operator
backup.

## Acceptance checks

Verify all of the following before declaring a deployment ready:

- `/api/health` returns success through public HTTPS and the health WebSocket
  upgrades with status 101;
- a fresh installation shows all four `/admin` setup steps, and completion
  changes that route to normal administrator login;
- the selected database passes its connection test and survives a service or
  container restart;
- normal and administrator login work;
- hard refresh works on a deep application route;
- create, edit, delete, upload, download, and JSON/CSV/Excel/PDF export work;
- a whole-workspace backup can be created and a restore has been tested;
- the PWA manifest and service worker load over HTTPS;
- configured SMTP, web-push, and AI integrations pass their own tests.

Reference documentation:
[Node.js release status](https://nodejs.org/en/about/previous-releases),
[Docker Compose production guidance](https://docs.docker.com/compose/how-tos/production/),
[Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html),
[Microsoft IIS ARR reverse proxy](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/reverse-proxy-with-url-rewrite-v2-and-application-request-routing),
and [WinSW](https://github.com/winsw/winsw).
