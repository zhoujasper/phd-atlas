# Changelog

[简体中文](CHANGELOG.zh-CN.md)

All notable changes to the public edition of PhD Atlas are documented in this
file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

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

[0.1.0-beta.2]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.2
