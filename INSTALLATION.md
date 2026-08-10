# Install and use PhD Atlas

[English](INSTALLATION.md) | [简体中文](INSTALLATION.zh-CN.md)

PhD Atlas is a full-stack PhD application management system covering
applications, materials, supervisor tracking, reminders, exports, backups, and
more. Production uses the repository's complete Docker Compose contract.

## Docker Compose (recommended for production)

Clone the repository and create a protected environment file:

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
cp .env.example .env
chmod 600 .env
# Edit .env and set DOMAIN=https://phd.example.com, then generate the required
# 32–512-byte first-run operator token directly into the protected file.
{ printf 'PHD_ATLAS_BOOTSTRAP_TOKEN='; openssl rand -base64 48 | tr -d '\n'; printf '\n'; } >> .env
docker compose pull
docker compose up -d --wait
```

Do not print, commit, paste into chat, or place the bootstrap token in shell
history. Open `.env` only in a trusted local editor when entering it into the
first-run `/admin` claim screen. Rotate it after a rejected or abandoned claim.
To use the NJU mirror, set `PHD_ATLAS_IMAGE` in `.env`; do not replace the
Compose service with a reduced `docker run` command.

`DOMAIN` and `PHD_ATLAS_BOOTSTRAP_TOKEN` are required for a new production
workspace. The remaining base settings are handled automatically:

- 🔐 **JWT signing key** — auto-generated on first boot, persisted in the storage volume
- 🔑 **Data encryption key** — same, used to encrypt database credentials, AI keys, etc.
- 🌐 **BASE_URL / CORS / hostname** — auto-derived from DOMAIN

The Compose service listens on host `127.0.0.1:4317`. Put exactly one Nginx, Caddy, or
Traefik reverse-proxy hop in front with HTTPS. `TRUST_PROXY=1` is safe here only
because the published port is host-loopback-only; never expose that port while
trusting forwarded headers.

The Compose file creates a named volume to persist all data.

### Reverse proxy (Nginx)

Use the supplied production template at
[`deploy/nginx/phd-atlas.conf`](deploy/nginx/phd-atlas.conf), replace its
hostname and certificate paths, and enable the site. With the Compose deployment
above, keep the template upstream at `127.0.0.1:4317`.

The full template is intentional: ordinary API bodies stay at 2 MiB, only the
nine audited multipart endpoints receive narrow larger limits, and the four
streaming endpoints retain their protocol-specific buffering rules. Do not
restore a server-wide 500+ MiB body limit; concurrent rejected uploads would
otherwise consume unnecessary proxy temporary storage and I/O.

## First-time /admin setup

Open `https://your-host/admin` and enter the required bootstrap token from the
protected `.env` file. Once the browser claim is accepted, the five-step wizard
walks you through:

1. **Administrator** — create the first admin account
2. **Security keys** — review auto-generated keys (optionally regenerate)
3. **Data store** — default SQLite with zero config, or pick MySQL/PostgreSQL/SQL Server
4. **System mail** — configure the outgoing SMTP server
5. **Review** — confirm and create the workspace

The setup route closes permanently after the first active administrator is
created.

### Database options

| Engine | Notes |
| --- | --- |
| SQLite (default) | Zero config, file stored under `/app/storage/` |
| MySQL / MariaDB | Provide a dedicated database and credentials |
| PostgreSQL | Provide a dedicated database/schema and credentials |
| Microsoft SQL Server | Provide a dedicated database/schema and credentials |

> **Important:** The `/app/storage` volume is required even with an external
> database — it holds uploads, backups, encrypted connection metadata, and the
> auto-generated security keys.

## Routine operations

```bash
# Status
docker compose ps

# Logs
docker compose logs -f phd-atlas

# Restart (preserves data)
docker compose restart phd-atlas

# Update to the latest beta image
docker compose pull
docker compose up -d --wait
```

## Backups

1. **In-app backup:** Admin → System info → Backups → Create whole-workspace backup
2. **Volume backup (stopped):**
```bash
docker compose stop phd-atlas
docker compose run --rm --no-deps --entrypoint sh -v "$(pwd):/backup" phd-atlas \
  -c 'tar -czf /backup/phd-atlas-backup.tgz -C /app/storage .'
docker compose start phd-atlas
```

> ⚠️ Always keep the `storage/` volume snapshot, the external database snapshot
> (if any), and the keys from `storage/bootstrap-secrets.json` together.

## Native deployment

For native Node.js deployments (systemd / WinSW), see
[DEPLOYMENT.md](DEPLOYMENT.md).

## Development

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
npm ci
npm run dev
```

Open `http://localhost:5173` — API requests proxy to `localhost:4317`.

## Troubleshooting

- **Port conflict:** change the first port in `--publish`, e.g. `-p 127.0.0.1:9000:4317`
- **Container unhealthy:** inspect `docker logs phd-atlas`
- **Database unreachable from Docker:** use `host.docker.internal`, never `localhost`
- **Browser shows offline behind proxy:** ensure WebSocket Upgrade headers reach `/api/health/ws`
- **Lost encryption keys:** restore `storage/bootstrap-secrets.json` — it's created on first boot
- **Post-update issues:** see the rollback procedure in [DEPLOYMENT.md](DEPLOYMENT.md)
