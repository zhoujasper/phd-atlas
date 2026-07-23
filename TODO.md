# PhD Atlas public roadmap

[English](TODO.md) | [简体中文](TODO.zh-CN.md)

The public edition prioritizes a dependable personal/self-hosted workspace.
Planned work is tracked here in broad delivery order.

## Beta exit criteria

- [ ] Freeze the first stable public database schema and migration contract.
- [ ] Add versioned, tested database migrations and documented compatibility
      guarantees for upgrades between stable public releases.
- [ ] Publish a stable-release data support policy. Beta versions intentionally
      do not guarantee database or stored-data compatibility.

## Product

- [ ] Bring the Team/institution collaboration model to the public edition,
      including owner/teacher/student roles, invitation lifecycle, permission
      tests, audit recovery, and safe migration from personal workspaces.
- [ ] Continue the full mobile adaptation pass: smaller-phone layouts,
      touch-first context actions, bottom-sheet replacements for dense menus,
      virtualized long lists, and browser-tested motion at 320-480 px.
- [ ] Improve tablet split-view behavior and installable PWA navigation.

## Data layer

- [x] Add first-run `/admin` data-store selection, connection testing, and
      review for SQLite, MySQL/MariaDB, PostgreSQL, and Microsoft SQL Server.
- [x] Implement durable external-database state adapters, encrypted saved
      passwords, controlled **Save and migrate**, and engine-aware workspace
      backup/restore.
- [ ] Stabilize the versioned cross-engine migration contract, expand the live
      compatibility matrix across supported server versions, and document
      long-term import, recovery, and support guarantees.

## Operations

- [ ] Publish signed container images for tagged releases.
- [x] Generate manifest-verified GitHub Release update packages and exercise
      both install and rollback paths before publication.
- [ ] Expand native update smoke tests to hosted Ubuntu, CentOS
      Stream/RHEL-compatible Linux, and Windows Server runners.
- [ ] Add optional object-storage support for uploads and backups.

## Integrations and quality

- [ ] Expand provider-neutral AI configuration and local-model documentation.
- [ ] Add more calendar and mail-provider setup recipes.
- [ ] Maintain keyboard, screen-reader, reduced-motion, high-contrast, and
      multilingual regression coverage as each public feature lands.
