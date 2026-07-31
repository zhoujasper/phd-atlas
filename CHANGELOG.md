# Changelog

[简体中文](CHANGELOG.zh-CN.md)

All notable changes to the public edition of PhD Atlas are documented in this
file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0-beta.8] - 2026-07-31

### Added

- Added one recoverable lazy-module loader across routes, workspace screens,
  dialogs, profile editors, the rich-text editor, and language namespaces,
  with bounded retries, shared in-flight work, and stale-preload recovery.
- Added a localized application-level recovery screen so persistent module or
  render failures retain an explicit reload path instead of leaving a white
  page.
- Added 288 real product captures covering six signed-in workflows across all
  12 languages, light and dark themes, and true desktop and mobile layouts.
- Added an atomic cross-process upload-vault migration lock with live-owner
  waiting, terminated-owner cleanup, and token-checked release.

### Changed

- Replaced the signed-out homepage's hand-built product replicas with the real
  Checklist, Correspondence, Funding, Timeline, Discover, and Profile
  interfaces, while retaining the previous image until the next capture has
  decoded successfully.
- Updated the public English and Chinese READMEs with responsive light/dark
  galleries sourced from the same real product captures.
- Kept `react-simple-code-editor` lazy while normalizing Vite's CommonJS/ESM
  wrapper at one typed runtime boundary.

### Fixed

- Fixed white-page failures when opening an application, creating an
  application, or adding a profile snippet after a stale dynamic chunk or
  wrapped editor export reached React.
- Fixed concurrent watched API processes sharing the upload-vault migration
  journal and destabilizing the development server.
- Fixed signed-out workflow articles that could remain transparent after an
  observer race, along with broken-image flashes during product-scene changes.
- Fixed the signed-out product gallery in browser-like environments that do
  not expose `matchMedia`, retaining a desktop capture instead of crashing.

## [0.1.0-beta.7] - 2026-07-29

### Added

- Added durable authored-mail and system-mail outboxes with stable delivery
  identities, scheduled delivery, retry metadata, stale-claim recovery, startup
  processing, and attachment-vault references.
- Added persisted mailbox-sync jobs, notification and digest recovery, and an
  encrypted browser-push journal so accepted background work survives restarts.
- Added one safe authored-rich-text contract across Markdown/HTML editing,
  GFM rendering, source highlighting, formatting, contextual completion,
  sanitization, immutable sent snapshots, and multipart SMTP delivery.
- Added server-authorized AI email attachment planning across profile,
  Checklist, task, and safe correspondence files without exposing vault
  handles or file bytes to the browser.
- Added AI-only existing-application enrichment with bounded context assembly,
  link auditing, targeted search, public-network crawling, prompt-injection
  quarantine, independent evidence verification, and reviewable idempotent
  additions.
- Added a 120-profile professional research taxonomy, OpenAlex Topic
  validation, affiliation-checked Crossref fallback, and discipline-routed
  Europe PMC lead discovery while keeping official university pages as the
  saved-fact boundary.
- Added a content-unique catalog of 225 provenance-backed school PNG marks,
  directly covering 119 of the 145 built-in Discover school adapters.
- Added personal and Team smart tables, progressive pagination, batch
  selection, inline status editing, retained board/table state, and responsive
  Team student portrait drill-down.
- Added automatic application saving, timestamp-aware offline reconciliation,
  bulk Team invitation validation, recipient management, checklist pointer
  sorting, and shared rich correspondence identities.

### Changed

- Team permissions now use owner-managed role defaults plus sparse personal
  overrides, with capability and usage-limit enforcement remaining
  server-authoritative.
- Immediate and scheduled authored mail now persist before SMTP, share the same
  communication record, and reuse the exact stored HTML/plain-text payload for
  retries.
- Application switching, board/table presentation, Settings loading, large
  tables, Checklist disclosure, and overlay positioning now use bounded,
  interruption-safe motion with fewer layout reads and React commits.
- The signed-out product story now mirrors the real Applications, Discover,
  Profile, Dossier, Checklist, Correspondence, Funding, Timeline, and Inspector
  workflows on desktop and mobile.
- Source authorization, AI attachment selection, outgoing attachment editing,
  temporary recipients, and attachment-omission confirmation now have one
  coherent draft-email ownership path.

### Fixed

- Fixed stale API failures reopening recovered connectivity, repeated health
  WebSocket handshakes, startup fallback fan-out during transport faults, and
  development restarts waiting behind resident WebSocket/SSE streams.
- Fixed application-selection overshoot, board/table handoff jank, append-time
  full-table scans, mobile navigation handoff coverage, picker gutter drift,
  clipped compact actions, and numerous narrow-screen localization wraps.
- Fixed mailbox folder discovery and per-message failure isolation, exact
  counterparty avatars, multi-recipient classification, imported-message
  safety boundaries, and AI access to unsafe correspondence.
- Fixed settings export behavior for empty personal workspaces, automatic-save
  conflict recovery, Team concurrent-edit resolution, and stale manual draft
  paths.

### Security

- Added DNS-pinned outbound HTTPS connections, exact production Host policy,
  safe request-target logging, bounded password-verifier work, and private-mail
  destination allowlisting.
- Added exact-signature upload validation, image and ZIP/OOXML resource bounds,
  active-content rejection, imported-mail threat analysis, and download-only
  handling for unknown inbound formats.
- Added a repository source-secret/runtime-data audit and documented the
  cross-surface security model. High-severity npm dependency audit remains
  clean.

### Performance

- Centralized browser request coalescing and the global API circuit, retained
  attempt-scoped realtime ownership, and made server recurring tasks
  non-overlapping and startup-owned.
- Preheated progressive table batches and board/table presentations, memoized
  heavy resident views, and limited high-frequency motion to scoped refs,
  CSS variables, and compositor transforms.

## [0.1.0-beta.6] - 2026-07-28

### Added

- Added `npm run verify:published-update -- --from <version> --tag <tag>` as a
  repeatable post-publication canary. It downloads through the production
  updater and then replays package validation, installation, active-package
  metadata, and rollback safety.
- Added Release-bundled, integrity-pinned archives for the complete production
  dependency graph, including a real empty-cache offline `npm ci` publication
  gate.

### Changed

- Release transport now has independent bounded waits for response headers and
  for every no-progress interval while streaming the package. Continuously
  advancing slow downloads remain valid.
- Mirror probing remains delayed until the official attempt is unreachable or
  stalls. A failed official attempt is cancelled and its partial file removed
  before the fastest gzip-signature-verified HTTPS mirror is selected.
- Production dependencies are derived automatically from standard manifest and
  lockfile fields instead of a handwritten runtime allowlist. Publishing and
  legacy recovery use bounded original-source, npmjs, npmmirror, Yarn, and
  applicable GitHub mirror fallback without weakening lockfile integrity.
- Frontend libraries compiled into `dist/` are classified as build
  dependencies, while every newly declared server dependency enters future
  update packages automatically.

### Fixed

- Fixed a successful two-byte official gzip probe being treated as proof that
  the complete package body would keep arriving. An official response that
  later stops producing bytes now falls back instead of waiting for the much
  longer whole-download timeout and ending without trying mirrors.
- Fixed backup-list cache invalidation after another process creates or removes
  an archive on a Windows volume whose directory timestamp does not advance.
  Concurrent readers still share one directory scan and cached file metadata.
- Fixed dependency installation being able to wait forever: source attempts
  now emit durable heartbeats, have finite no-progress/attempt/total bounds,
  terminate stuck process trees, and retain verified rollback.

### Added

- Added durable server-side update jobs whose download, validation, backup,
  dependency installation, restart, and first-boot handoff continue after the
  administrator closes the browser.
- Added a privacy-redacted, size-bounded update journal with persisted phase,
  progress, failure details, npm output, boot rollback diagnostics, and an
  administrator log viewer that survives page and server restarts.

### Changed

- Release update packages now contain only the dependency graph required by
  the server runtime. Frontend-only packages already bundled into `dist/`,
  including the external SheetJS archive, are no longer downloaded during an
  in-place server update.
- Update dependency installs reuse a persistent npm cache and prefer cached
  packages while retaining exact lockfile installation, runtime preflight,
  first-boot confirmation, and automatic rollback.
- The public/private release workflow pins Draft and final Release metadata to
  the canonical version tag and tagged public commit.
- Public main container publication now waits for the exact matching successful
  CI run instead of repeating the full tree gate. The MSSQL release gate and
  final publication also share one runner and one dependency install, avoiding
  a second runner queue after the gate has passed.

### Fixed

- Fixed automatic-update status, log, and Release-check reads incorrectly
  consuming the 80-per-hour authenticated upload budget. The old 650 ms status
  poll could otherwise receive repeated `429` responses in under a minute and
  make a successful update appear stuck.
- Fixed Beta-to-Beta updates failing during post-download `npm ci` when a
  deployment could reach GitHub or a configured mirror but could not reach a
  frontend-only package CDN.
- Fixed update failures exposing only a generic error after the old server had
  stopped; dependency, helper-spawn, runtime-preflight, and first-boot rollback
  failures now leave actionable durable diagnostics.
- Fixed delayed anchored-popover focus restoration surviving owner unmount and
  touching a destroyed browser/test window.

### Added

- Added privacy-preserving registration, login, recovery, and setup challenges
  with one-time opaque records, bounded attempts, expiry, persistent
  network/account/domain/subnet/global budgets, optional Turnstile, and
  enumeration-safe registration responses.
- Added granular Team student and teacher capabilities for applications,
  Discover, invitations, sharing, transfers, and optional active/lifetime
  limits, with server-authoritative assignment and quota enforcement.
- Added secure personal-only offline snapshot/queue v3, a maximum 72-hour
  authorization lease, an offline launch surface, and server-authoritative
  conflict/ownership validation during replay.
- Added durable administrator system-log pagination, search, sorting, streaming
  CSV/JSON export, and configurable forever-or-bounded retention.
- Added an interactive signed-out product workspace, a matching Pro capacity
  demo, in-flow project identity footers, and an accessible support dialog.
- Added account-scoped custom application statuses, laboratory/project dossier
  links, application-targeted deep-link cues, and global clipped-text reveal
  and copy interactions.

### Changed

- New passwords now use stronger contextual/blocklist checks, optional HIBP
  k-anonymity screening, and Argon2id storage; successful legacy bcrypt logins
  migrate in place.
- Team Discover now uses only the selected organization's administrator-managed
  key, teacher audit access is limited to assigned students, and public/private
  builds retain one shared Team authorization model.
- Offline mode now reduces the already-mounted workspace immediately; the
  production service worker caches only the shell and explicit static assets,
  never API, cookie-bearing, private, no-store, or arbitrary JSON responses.
- The automatic updater now reports resolving, probing, downloading,
  verification, preparation, restart, and retryable failure states. Official
  GitHub metadata and SHA-256 remain authoritative when bounded HTTPS mirrors
  are used for package transport.
- School logos now prefer compact official marks and content-addressed assets;
  Team boards, portrait libraries, application handoffs, anchored popovers, and
  mobile controls received scoped reduced-motion-safe interaction refinements.
- Release validation now shares strict source/public tree gates, forced
  TypeScript build-mode checks, independent public installs, deterministic
  update packages, Compose validation, and real amd64/arm64 production smoke.

### Fixed

- Fixed indefinite application-transfer checking, stale jump-intent replay,
  clipped-value access, card/list bounce, Team masonry gaps, popover
  re-anchoring/exit flashes, local fixed-port startup timing, and several PWA
  passkey/push failure states.
- Fixed public setup and Team test/runtime boundaries so production starts from
  the one-time administrator flow while development and tests retain
  deterministic fixtures.

### Security

- CAPTCHA answers, email/setup codes, reset links, and SMTP verification codes
  are no longer exposed through browser-readable JWT claims or mail audit
  bodies; security and SMTP audit metadata is privacy-safe.
- Password, role, and disabled-state changes revoke sessions through
  `authVersion`; JWT algorithms/issuer/audience are pinned, unsafe cross-site
  Fetch Metadata writes are rejected, and unsafe blanket proxy trust fails
  closed in production.
- Offline replay restores server-owned capability fields from the current
  record, and browser-local integrity data is never treated as authorization or
  confidentiality against a compromised device.

### Performance

- High-frequency selection, pan, zoom, and layout motion now uses scoped refs,
  CSS variables, batched geometry reads, bounded compositor transitions, and
  cleanup of temporary layers without React render churn.
- Updated mail parsing, spreadsheet handling, and development tooling; the
  dependency audit is clean.

## [0.1.0-beta.5] - 2026-07-26

### Added

- Full Team collaboration is now available in the public Beta, including
  organization roles, invitations, scoped workspaces, shared application
  workflows, audit history, and Team AI access.
- First-run SMTP setup now verifies a six-digit code sent from the configured
  sender to the configured notification mailbox before creating the first
  administrator.

### Changed

- The public exporter preserves the Team runtime, language packs, and the same
  server-authoritative permissions used by the private source build.
- Recipient-group CSV import is now a focused animated flow with a template,
  drag/drop upload, file picker, and preview.

### Fixed

- Bootstrap security-key copy now preserves the complete value; verification
  email markup is rendered as HTML rather than visible source text.
- Discover preserves the current research draft before opening AI-key setup;
  device-notification operations fail with a bounded error instead of spinning
  indefinitely after deployment.
- Improved responsive admin navigation, touch selection feedback, paired field
  dimensions, helper text hierarchy, and localized public-facing copy.

## [0.1.0-beta.4] - 2026-07-24

### Added

- Theme toggle and language switching (12 languages) on the first-time `/admin`
  setup page, matching the controls already available on the admin login screen.
- Comprehensive three-platform Docker deployment scripts (Windows
  CMD/PowerShell, Linux/Ubuntu, and BT Panel with three methods: GUI, terminal,
  and Docker Compose). Each platform gets a self-contained, color-coded,
  copy-paste script with management commands.

### Changed

- Deployment documentation (`DEPLOYMENT.md` and `DEPLOYMENT.zh-CN.md`) now
  leads with the three deployment plans and includes step-by-step BT Panel
  configuration tables.

### Fixed

- `fileURLToPath` used instead of `__filename` in `bootstrapSecrets.js` for ESM
  compatibility.
- JWT length check now enforced only in production mode.
- Security i18n keys and `CONFIRMATION_REQUIRED` error available in all 12
  languages.

### Performance

- Docker image shrunk from 1.14 GB to 826 MB (multi-stage Alpine build with
  esbuild-bundled entrypoint, stripped dev dependencies and non-Linux binaries).
- NJU mirror (`ghcr.nju.edu.cn`) documented as an alternative pull source for
  users in regions with slow GitHub Container Registry access.

## [0.1.0-beta.3] - 2026-07-24

### Added

- One-command Docker deployment: a single `docker run` with `--env DOMAIN=`
  is enough — JWT signing keys and data-encryption keys are auto-generated on
  first boot and persisted to `storage/bootstrap-secrets.json`.
- Auto-derived URL configuration: `BASE_URL`, `CORS_ORIGIN`, and
  `ALLOWED_HOSTS` are derived from the single `DOMAIN` environment variable
  when not set explicitly.
- Security keys step in the `/admin` setup wizard: auto-generated keys are
  displayed in the guided flow with a one-click regeneration option, copy
  buttons, and destructive-action confirmation.

### Changed

- Installation and deployment guides are now ~1/4 of their previous length —
  focused on the Docker happy path with a Vaultwarden-style one-liner.
- Minimal `.env.example`: only `DOMAIN` is required; all other fields are
  optional overrides.
- `latest` Docker tag now published alongside `beta`, pointing to the same
  latest Beta release.

## [0.1.0-beta.2] - 2026-07-23

**Prerelease — Beta.** Database schemas, stored data, and update paths may
change before the first stable release without backward-compatibility
guarantees. Before installing or updating, create a whole-workspace backup,
copy the complete stopped `storage/` directory or Docker volume, and snapshot
the selected external database when applicable.

### Added

- Added a one-time `/admin` setup flow for new servers. Administrators can
  choose SQLite, MySQL/MariaDB, PostgreSQL, or Microsoft SQL Server, test the
  connection, and complete setup only against a suitable empty target.
- Added later database connection testing and workspace migration controls in
  Admin, with encrypted storage for the external-database password.
- Added public Docker images at `ghcr.io/zhoujasper/phd-atlas`, including the
  rolling `beta` channel and version-specific prerelease tags. The Beta
  publishing workflow builds for both `linux/amd64` and `linux/arm64` and
  intentionally does not publish a `latest` tag.
- Added automatic update checks in Admin against the fixed public
  `zhoujasper/phd-atlas` GitHub Releases feed. When a newer compatible release
  is available, an administrator can review its Release page and install it
  with one action.
- Added a manual Release-package upload fallback for offline or restricted
  servers. Docker, systemd, and WinSW deployments use the same verified
  package and guarded restart path.
- Added durable Docker update replay: a verified active Release package is
  retained in `storage/active-update/` and re-applied when an older base image
  recreates the container, without requiring access to the Docker socket.

### Changed

- Release updates now create a pre-update whole-workspace backup, preserve
  `.env`, the selected database, uploads, and existing backups, and replace
  only the managed runtime files.
- Docker and native launchers now coordinate update locks, restart the
  application worker after installation, confirm the candidate runtime during
  startup, and restore the previous runtime and active-package pointer when
  startup validation fails.
- Public Release automation now builds a deterministic
  `phd-atlas-update-<version>-release.tar.gz` package and matching
  `.sha256` sidecar, tests installation and rollback, and attaches the verified
  assets to the GitHub prerelease.
- Multi-architecture container smoke tests now clear Docker's local
  manifest-list cache between `linux/amd64` and `linux/arm64`, so both variants
  are independently pulled and exercised before any public tag is promoted.
  Anonymous GHCR digest checks also use a bounded retry window after promotion
  so registry propagation cannot create a false-negative release failure.

### Security

- Release discovery accepts only canonical SemVer tags and the expected single
  package/checksum pair from the fixed public repository.
- Update-package content fingerprints now use locale-independent archive-path
  ordering, so the same deterministic package verifies consistently on Windows
  and Linux.
- Release downloads are HTTPS-only, redirect-, time-, and size-bounded, and
  verify the SHA-256 checksum, package manifest, declared version, file set,
  extraction paths, entry types, and extraction limits before activation.
- Interrupted or incomplete updates fail closed. Diagnostic markers and logs
  are retained, and an incomplete rollback prevents a partially updated
  runtime from starting.

### Documentation

- Added detailed English and Simplified Chinese installation guides covering
  Docker, first-time Admin setup, all four database choices, routine use,
  backups, updates, and troubleshooting.
- Expanded the deployment guides for Docker Compose, Ubuntu and generic Linux,
  CentOS Stream/RHEL-compatible systems, Windows with WinSW, reverse proxies,
  TLS/private CAs, persistent storage, database migration, and Beta rollback.
- Updated the public READMEs with the supported database matrix, public GHCR
  image and tag policy, manual and automatic Release-update paths, and the
  one-time upgrade instructions for existing `0.1.0-beta.1` installations.

## [0.1.0-beta.1] - 2026-07-20

### Added

- Published the first self-hosted, privacy-first, single-workspace public Beta.
- Added application CRUD, dashboard analytics, list/Kanban navigation,
  dossiers, materials, recommendation letters, scholarships, tasks, fees,
  progress, and a unified application timeline.
- Added program and supervisor discovery, profile material reuse,
  correspondence history, scoped IMAP/SMTP support, attachments, controlled
  share links, multi-format exports, calendars, and notifications.
- Added whole-workspace backups, administration, encrypted integration
  settings, PWA/offline support, responsive layouts, accessibility preferences,
  light/dark themes, and twelve language packs.
- Published the first GitHub Release update archive and SHA-256 sidecar.

[0.1.0-beta.7]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.7
[0.1.0-beta.6]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.6
[0.1.0-beta.5]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.5
[0.1.0-beta.4]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.4
[0.1.0-beta.3]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.1
