# Install and use PhD Atlas

[English](INSTALLATION.md) | [简体中文](INSTALLATION.zh-CN.md)

One command, five minutes to production. PhD Atlas is a full-stack PhD
application management system covering applications, materials, supervisor
tracking, reminders, exports, backups, and more.

## Docker (recommended)

```bash
docker run --detach --name phd-atlas \
  --env DOMAIN="https://phd.example.com" \
  --volume phd-atlas-data:/app/storage \
  --restart unless-stopped \
  --publish 127.0.0.1:8000:4317 \
  ghcr.io/zhoujasper/phd-atlas:latest
```

That's it. Replace `DOMAIN` with your own HTTPS domain. Everything else is
handled automatically:

- 🔐 **JWT signing key** — auto-generated on first boot, persisted in the storage volume
- 🔑 **Data encryption key** — same, used to encrypt database credentials, AI keys, etc.
- 🌐 **BASE_URL / CORS / hostname** — auto-derived from DOMAIN

The service listens on `127.0.0.1:8000`. Put an Nginx, Caddy, or Traefik
reverse proxy in front with HTTPS.

### With Docker Compose

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
# Edit .env — set DOMAIN to your hostname (everything else is optional)
vim .env
docker compose up -d --wait
```

The Compose file creates a named volume to persist all data.

### Reverse proxy example (Nginx)

```nginx
server {
    listen 443 ssl;
    server_name phd.example.com;

    ssl_certificate     /etc/letsencrypt/live/phd.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/phd.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        client_max_body_size 550m;
    }
}
```

## First-time /admin setup

Open `https://your-host/admin`. The five-step wizard walks you through:

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
docker ps --filter name=phd-atlas

# Logs
docker logs -f phd-atlas

# Restart (preserves data)
docker restart phd-atlas

# Update to the latest beta image
docker pull ghcr.io/zhoujasper/phd-atlas:latest
docker stop phd-atlas && docker rm phd-atlas
# Then re-run the same docker run command
```

## Backups

1. **In-app backup:** Admin → System info → Backups → Create whole-workspace backup
2. **Volume backup (stopped):**
```bash
docker stop phd-atlas
docker run --rm -v phd-atlas-data:/data:ro -v $(pwd):/backup \
  alpine tar -czf /backup/phd-atlas-backup.tgz -C /data .
docker start phd-atlas
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
