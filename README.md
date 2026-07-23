# PhD Atlas

[English](README.md) | [简体中文](README.zh-CN.md)

> A self-hosted, privacy-first workspace for planning and managing the complete
> PhD application journey.

[![CI](https://github.com/zhoujasper/phd-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/zhoujasper/phd-atlas/actions/workflows/ci.yml)
[![Status: Beta](https://img.shields.io/badge/status-beta-f59e0b.svg)](TODO.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 24 LTS](https://img.shields.io/badge/Node.js-24%20LTS-339933.svg)](https://nodejs.org/)

> [!WARNING]
> **PhD Atlas is currently Beta.** Until the first stable
> public release, database schemas, stored data, and update paths may change
> without backward-compatibility guarantees. Use backups and test Beta updates
> before applying them to important data. The current prerelease version and
> published assets are listed on the
> [Releases page](https://github.com/zhoujasper/phd-atlas/releases).

PhD Atlas brings applications, prospective supervisors, documents, deadlines,
correspondence, funding, reusable profile material, exports, and backups into a
single calm workspace. It is designed for self-hosting: the default SQLite
database or selected MySQL/MariaDB, PostgreSQL, or Microsoft SQL Server data
store, plus uploads, backups, credentials, and integration settings, remain on
infrastructure you control.

This repository is the **public, single-workspace edition**. Team and
institution collaboration is intentionally not distributed here, and no Team
enablement material is included in the public package. Future public support
will be announced through the [roadmap](TODO.md) once permissions, migrations,
and mobile workflows are ready for general use.

## Product tour

### Application command center

- Create, edit, duplicate, archive, restore, and permanently delete application
  records.
- Track university, program, department, country, portal URL, prospective
  supervisor, lab, research fit, deadline, status, priority, and progress.
- Search instantly and filter by status, country, tags, deadline, and other
  application metadata.
- Switch between dense list and Kanban views with stable deep links for every
  application and dossier tab.
- Use an interactive dashboard for status distribution, approaching deadlines,
  recent activity, priority applications, and next actions.
- Select and manage records with desktop-style keyboard, context-menu, and
  multi-select interactions.

### Discover and compare programs

- Capture research interests, target regions, degree background, funding needs,
  and other discovery criteria.
- Browse and rank a curated program and principal-investigator catalog.
- Weight match factors, compare cost-of-living-adjusted stipends, hide or watch
  candidates, and keep decision notes.
- Import a discovery result directly into the application workspace with school,
  supervisor, research, funding, and timeline context.

### Complete application dossier

- Maintain bilingual school and supervisor details, contact channels, homepage,
  lab, research direction, and fit notes.
- Use a structured checklist for CV, transcripts, recommendation letters,
  personal statement, research proposal, language scores, portal registration,
  statement of purpose, and final submission.
- Configure recommendation-letter counts and recommender contact information.
- Add reminders, statuses, groups, and detailed notes to material items.
- Upload and download files with version history and rollback-friendly metadata.
- Track scholarships and funding windows.
- Manage tasks with due dates, smooth completion states, and a unified visual
  timeline of application events.
- Review fees, submission readiness, and application-level progress.

### Correspondence and mail

- Record outgoing and incoming email, chat/message exchanges, meetings, portal
  activity, and private notes in a conversation-style timeline.
- Compose supervisor email with attachment handling and optional AI drafting.
- Connect IMAP for narrowly scoped mailbox collection: only addresses belonging
  to supervisors in your own application records are considered.
- Import sent and received history with folder-aware cursors and duplicate
  prevention.
- Configure SMTP for outbound mail and receive in-app/email notifications for
  relevant events.

### Personal profile library

- Keep reusable CV, transcript, statement, proposal, credential, and writing
  assets in one profile library.
- Build reusable personal presets with localized names, descriptions, icons,
  colors, and content.
- Insert or copy profile material into application work without re-entering the
  same information.
- Share controlled upload links for collecting files without sharing the whole
  workspace.

### Sharing, exports, and calendar

- Create expiring, revocable share links with section-level permissions.
- Export application data as JSON, CSV, Excel, and polished PDF.
- Generate calendar feeds and deadline/task reminders.
- Receive browser notifications and optional web-push alerts.
- Use a unified notification center with read state and duplicate suppression.

### Backups and administration

- Create and restore per-application backups and whole-workspace system backups.
- Manage retention and inspect storage use.
- Administer registration, accounts, quotas, sessions, system events, mail
  settings, encryption policy, and update packages through `/admin`.
- Complete a polished one-time `/admin` setup on a fresh deployment: create the
  first administrator, choose and verify SQLite, MySQL/MariaDB, PostgreSQL, or
  SQL Server, configure SMTP, verify the connections, and permanently close
  the initialization route.
- Test and migrate the active workspace to another supported database later
  from **Admin → System configuration → Database connection**.
- Check the public GitHub Releases feed and install an available update from
  Admin, or expand the manual fallback and upload a trusted Release package.
  The supplied Docker, systemd, and WinSW launchers use the same guarded update
  helper.
- Use request IDs, rate limits, Zod validation, Helmet security headers,
  host/origin allowlists, and privacy-safe audit events.
- Encrypt stored integration secrets; optional SQLite sealing and encryption
  controls are available from administration settings.

### Installable, responsive, and accessible

- Install PhD Atlas as a PWA from compatible Chrome/Edge browsers.
- Open cached workspace snapshots offline and queue supported personal edits for
  conflict-aware replay when connectivity returns.
- Use desktop, tablet, and phone layouts with a four-panel desktop workspace,
  compact tablet composition, and mobile bottom navigation.
- Choose light/dark mode, accent color, high-contrast mode, and reduced motion.
- Use custom keyboard-accessible date and select controls.
- Switch among English, Simplified Chinese, German, Spanish, French, Italian,
  Japanese, Korean, Portuguese, Russian, Thai, and Vietnamese.

## Public edition boundary

The public build sets a deterministic edition flag that:

- removes Team navigation and workspace switching;
- rejects Team API routes;
- omits Team invite handling and Team plan presentation;
- starts with blank login fields instead of private demo shortcuts.

Team collaboration is planned as a future public feature after its permissions,
data migration, and mobile interaction model are ready for general use.

## Stack

- React 19 + TypeScript 6 + Vite 8
- Express 5
- SQLite through `better-sqlite3`, with selectable MySQL/MariaDB, PostgreSQL,
  and Microsoft SQL Server durable stores
- Zod contracts
- Vitest + Testing Library + Playwright
- Vanilla CSS with design tokens; no CSS framework

The frontend and API are served by the same Node.js process in production.
Persistent operational files live under `storage/`; the selected database
holds the durable workspace snapshot.

## Quick start

Requirements: 64-bit Node.js 24 LTS and Git.

```bash
git clone https://github.com/zhoujasper/phd-atlas.git
cd phd-atlas
npm ci
npm run dev
```

Open `http://localhost:5173/admin`. On a new database, the one-time setup guide
asks for:

- the first administrator's name, login email, and a password of at least 12
  characters;
- SQLite or an external MySQL/MariaDB, PostgreSQL, or SQL Server connection;
- the system SMTP host, port, login, app password, TLS preference, and
  notification recipient.

PhD Atlas verifies the database and SMTP connections before saving. Once the
administrator is created, the setup API closes and `/admin` becomes the normal
login page. No default public password is shipped.

For a guided first install, database permissions, migration safety, everyday
operation, backup, and troubleshooting, read
[INSTALLATION.md](INSTALLATION.md).

## Production deployment

Docker is the shortest supported path:

```bash
cp .env.example .env
# Set the HTTPS URL and two independent secrets; public builds ignore BOOTSTRAP_*.
docker compose pull
docker compose up -d --wait
```

The Compose service binds to `127.0.0.1:4317` and persists all application data
in a named volume. Put an HTTPS reverse proxy in front of it.

For complete Docker, Ubuntu, generic Linux, CentOS Stream/RHEL-compatible, and
Windows Server + IIS instructions, read [DEPLOYMENT.md](DEPLOYMENT.md).

## Configuration

Production requires:

- `BASE_URL`, `CORS_ORIGIN`, and `ALLOWED_HOSTS` for the public HTTPS hostname;
- `TRUST_PROXY=loopback` when the reverse proxy runs on the same host;
- independent random `JWT_SECRET` and `SETTINGS_ENCRYPTION_KEY` values.

After the service starts, open `https://your-host/admin` once to create the
administrator, select the database, and configure system mail.

Optional variables configure VAPID web-push keys and PDF fonts. See
[.env.example](.env.example) for the complete list.

## Commands

```bash
npm run dev          # Express + Vite development servers
npm run dev:web      # Vite only; proxies /api to :4317
npm run dev:api      # Express only
npm run build        # TypeScript + production frontend + service-worker stamp
npm run build:update-package # Build an Admin-compatible .tar.gz update
npm start            # Serve API and dist; loads .env when present
npm run lint         # oxlint
npm run i18n:check   # locale completeness and UI literal checks
npm test             # Vitest unit/integration suite
npm run test:e2e     # Playwright end-to-end suite
```

## Data and backup safety

Never commit or casually delete `storage/`. It contains:

- `phd-atlas.sqlite` and its WAL/SHM files;
- `database-connection.json`, whose external-database password is encrypted
  with `SETTINGS_ENCRYPTION_KEY`;
- uploaded materials and message attachments;
- application and system backups;
- generated update packages and persisted integration material.

Before an upgrade, create an in-app system backup and copy the entire `storage/`
directory or Docker volume while the process is stopped. If an external
database is selected, take its matching snapshot at the same time. Do not copy
only the main `.sqlite` file while WAL mode is active. External databases do
not replace the volume: uploads, backups, connection metadata with an encrypted
password, and the compatibility cache still live there. Moving servers also
requires the original `SETTINGS_ENCRYPTION_KEY`.

## Releases and in-app updates

Every `vMAJOR.MINOR.PATCH` or SemVer prerelease tag runs the public Release
workflow. It validates the source, builds the production frontend, generates a
manifest containing a SHA-256 hash for every managed runtime file, exercises
both install and rollback paths, and attaches the `.tar.gz` package plus
checksum to a GitHub Release.
Tagged package and container publication are also gated by an isolated
Microsoft SQL Server 2022 adapter smoke test before either artifact is
published.

Beta release packages exercise the same runtime install and rollback checks,
but they do not promise database-schema or stored-data compatibility between
Beta versions. Back up the whole workspace before every Beta update.

For Docker, native Windows, or native Linux deployments already running
`v0.1.0-beta.2` or later:

1. Create a whole-workspace backup in Admin and a stopped `storage/` snapshot.
2. Open **Admin → System information → System update**, select
   **Check for updates**, review the public Release, and choose **Install vX**.
3. If the server cannot reach GitHub, expand **Manual update**, download the
   `.tar.gz` plus `.sha256` through a trusted machine, verify the checksum, and
   upload the package.
4. Wait for the service to restart, then sign in and confirm the displayed
   version, health, and a representative read/write operation.

The already-published `v0.1.0-beta.1` predates this guarded path. Docker
operators must pin or select the published beta.2 image, then run
`docker compose pull` and `docker compose up -d --wait`. Native beta.1
operators must **not** upload beta.2 through the old Admin card: its original
systemd sandbox cannot keep the helper alive or let it replace the runtime.
Instead, perform the one-time stopped-service bootstrap in
[DEPLOYMENT.md](DEPLOYMENT.md#one-time-native-beta1-to-beta2-bootstrap), which
uses only the verified beta.2 Release package. Admin automatic and manual
updates are supported after that bootstrap.

The updater never replaces `.env`, the selected database, uploads, or backups.
Docker also persists the verified active Release package under `storage/` so a
container recreated from an older base image can reapply it. See
[INSTALLATION.md](INSTALLATION.md) and [DEPLOYMENT.md](DEPLOYMENT.md) for the
trust boundary, backup, first-boot, and rollback details.

## Project layout

```text
src/                 React application, typed API client, i18n, and styles
server/              Express routes, multi-engine persistence, mail, push, AI, exports
public/              PWA manifest, icons, service worker, boot assets
tests/e2e/            Playwright user-flow coverage
deploy/               systemd, Nginx, WinSW, and IIS templates
tools/                build, validation, stress, and startup utilities
Dockerfile            reproducible production image
compose.yaml          single-host production Compose service
INSTALLATION.md       first install, database selection, use, and troubleshooting
DEPLOYMENT.md         platform-specific deployment guide
```

## Roadmap and contributing

See [TODO.md](TODO.md) for the public roadmap. Issues and focused pull requests
are welcome. Before submitting a change, run:

```bash
npm run lint
npm run i18n:check
npx tsc --noEmit
npm test
npm run build
```

## License

[MIT](LICENSE)
