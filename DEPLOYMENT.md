# Deploying PhD Atlas

PhD Atlas is one Node.js process: Express serves both `/api` and the built React
application. SQLite, uploads, backups, update packages, and generated push keys
live under `storage/`. Preserve that directory across every upgrade.

## Production requirements

- 64-bit Node.js 24 LTS. Vite 8 technically accepts Node `^20.19.0` or
  `>=22.12.0`, but Node 24 LTS is the recommended production line.
- A persistent local disk for `storage/`. Do not place the live SQLite database
  on NFS, SMB, or another network filesystem.
- HTTPS at a reverse proxy. The production server redirects plain HTTP to HTTPS.
- At least 1 GB RAM for a small personal deployment; allow more during `npm ci`
  and `npm run build`.

## Configuration

Copy `.env.example` to `.env`, replace every `replace-with-...` value, and set
the real public URL:

```bash
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Use different random values for `JWT_SECRET` and `SETTINGS_ENCRYPTION_KEY`.
`.env` is ignored by Git. The public edition does not ship a default account:
after the first start, open `https://your-host/admin` and complete the one-time
administrator and SMTP setup. The server verifies the SMTP connection before
it commits the administrator, then permanently closes the setup route.

The private source edition still supports the `BOOTSTRAP_*` seed values shown
in `.env.example`; the public edition ignores them.

## Docker (recommended)

Install Docker Engine/Desktop with Compose, then:

```bash
cp .env.example .env
# Edit .env before continuing.
docker compose up -d --build --wait
docker compose ps
docker compose logs -f phd-atlas
```

Compose binds the app only to `127.0.0.1:4317`; put Nginx, Caddy, IIS, Traefik,
or a tunnel with HTTPS in front of it. To use a different host port:

```bash
APP_PORT=8080 docker compose up -d --build --wait
```

The named volume `phd-atlas-data` keeps SQLite and uploads when the container is
recreated. Upgrade without deleting the volume:

```bash
git pull --ff-only
docker compose up -d --build --wait
```

Back up the volume:

```bash
docker run --rm \
  -v phd-atlas_phd-atlas-data:/data:ro \
  -v "$PWD:/backup" \
  alpine tar -czf /backup/phd-atlas-storage.tgz -C /data .
```

Never run `docker compose down -v` unless you intentionally want to delete all
application data.

## Ubuntu Server

The commands below target Ubuntu 22.04/24.04 or newer.

1. Install Node.js 24 LTS, Git, build tools, and Nginx. The NodeSource setup
   script is a common packaged installation path:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential python3 nginx
node --version
```

   Confirm `node --version` reports v24 before continuing.
2. Create a service account and install the application:

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

3. Install and start the supplied systemd unit:

```bash
sudo cp /opt/phd-atlas/deploy/linux/phd-atlas.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now phd-atlas
sudo systemctl status phd-atlas
curl -H 'Host: phd.example.com' -H 'X-Forwarded-Proto: https' http://127.0.0.1:4317/api/health
```

4. Copy `deploy/nginx/phd-atlas.conf` into `/etc/nginx/sites-available/`,
   replace `phd.example.com` and the certificate paths, enable the site, run
   `sudo nginx -t`, then reload Nginx. Obtain a valid certificate before
   exposing the service.

## CentOS Stream / RHEL-compatible Linux

Use CentOS Stream 9/10 or another supported RHEL-compatible release. Do not
deploy a new internet-facing system on CentOS Linux 7, which is end-of-life.

1. Install Node.js 24 LTS plus the native build toolchain. For example, with
   NodeSource's RPM repository:

```bash
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs git gcc-c++ make python3 nginx
node --version
```

2. Follow the Ubuntu service-account, clone, `npm ci`, build, environment, and
   systemd steps above. On RHEL-family systems the Nginx file normally goes to
   `/etc/nginx/conf.d/phd-atlas.conf`.
3. Open only HTTPS after the certificate is configured:

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

Install Node.js 24 LTS, Git, Python 3, `make`, a C++ compiler, and a reverse
proxy using the distribution's supported packages. Use the supplied systemd
unit on systemd-based distributions. The invariant deployment sequence is:

```bash
npm ci
npm run build
npm prune --omit=dev
NODE_ENV=production node tools/start-server.mjs
```

Run as a dedicated unprivileged user, persist `storage/`, load the production
environment, and proxy HTTPS to `127.0.0.1:4317`.

## Windows Server

The supported native layout is Node.js 24 LTS + WinSW + IIS with ARR and URL
Rewrite.

1. Install 64-bit Node.js 24 LTS, Git, IIS, URL Rewrite 2, and Application
   Request Routing (ARR).
2. Clone to `C:\PhDAtlas`, then build in an elevated PowerShell:

```powershell
git clone https://github.com/zhoujasper/phd-atlas.git C:\PhDAtlas
Set-Location C:\PhDAtlas
Copy-Item .env.example .env
notepad .env
npm ci
npm run build
npm prune --omit=dev
```

3. Download the current stable WinSW executable from its official GitHub
   releases, save it as `C:\PhDAtlas\PhDAtlas.exe`, and copy
   `deploy\windows\PhDAtlas.xml.example` to `C:\PhDAtlas\PhDAtlas.xml`.
   The service wrapper inherits the project `.env` through
   `tools\start-server.mjs`.
4. Install and verify the service:

```powershell
Set-Location C:\PhDAtlas
.\PhDAtlas.exe install
.\PhDAtlas.exe start
.\PhDAtlas.exe status
```

5. In IIS ARR, enable proxying and preserve the original host header. Add
   `HTTP_X_FORWARDED_PROTO` to the allowed server variables, copy
   `deploy\windows\web.config.example` to the IIS site's `web.config`, bind a
   valid HTTPS certificate, and set the site's physical directory to a small
   dedicated proxy directory containing that file.

```powershell
& $env:windir\System32\inetsrv\appcmd.exe set config `
  /section:system.webServer/proxy /enabled:true /preserveHostHeader:true
```

Set `BASE_URL`, `CORS_ORIGIN`, and `ALLOWED_HOSTS` in `.env` to the IIS HTTPS
hostname and set `TRUST_PROXY=loopback`. Test `/api/health` through the public
HTTPS URL, then test login, upload/download, export, and a server restart.

## Upgrade and rollback

Before every upgrade, create an in-app system backup and take a filesystem copy
of `storage/` while the process is stopped. Then:

```bash
git pull --ff-only
npm ci
npm run build
npm prune --omit=dev
sudo systemctl restart phd-atlas
```

For rollback, stop the service, restore both the previous code revision and its
matching `storage/` snapshot, then start the service. SQLite WAL files belong to
the database state; copy the whole storage directory rather than only the
`.sqlite` file.

## Acceptance checks

```bash
curl -fsS https://phd.example.com/api/health
```

Then verify:

- a fresh deployment shows the one-time `/admin` setup, while refresh after
  completion shows the normal administrator login;
- normal and admin login;
- hard refresh on a deep link such as `/applications/...`;
- create/edit/delete and restart persistence;
- file upload/download and JSON/CSV/Excel/PDF export;
- backup creation and restore;
- PWA manifest/service worker over HTTPS;
- configured mail, web-push, and AI integrations if enabled.

## Updating an existing native deployment

Tagged public releases attach a `phd-atlas-update-*.tar.gz` file and matching
SHA-256 checksum. Create a whole-workspace backup, download the package from the
GitHub Release, then upload it under **Admin → System information → System
update**.

The server verifies the package manifest and every file hash before scheduling
the update. The service exits, the detached updater retains the previous
runtime under `storage/update-rollbacks/`, replaces only managed runtime files,
runs `npm ci --omit=dev`, and releases the startup lock. If installation fails,
it restores the previous runtime before the service starts again. Native
deployments must use `npm start` through the supplied systemd or WinSW template
so restart and update-lock handling remain active.

For Docker, do not mutate a container through the Admin updater: pull/build the
new image and run `docker compose up -d --build --wait`. The persistent
`storage/` volume remains attached.

Reference documentation: [Node.js release status](https://nodejs.org/en/about/previous-releases),
[Docker Compose production guidance](https://docs.docker.com/compose/how-tos/production/),
[Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html),
[Microsoft IIS ARR reverse proxy](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/reverse-proxy-with-url-rewrite-v2-and-application-request-routing),
and [WinSW](https://github.com/winsw/winsw).
