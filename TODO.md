# PhD Atlas public roadmap

The public edition prioritizes a dependable personal/self-hosted workspace.
Planned work is tracked here in broad delivery order.

## Product

- [ ] Bring the Team/institution collaboration model to the public edition,
      including owner/teacher/student roles, invitation lifecycle, permission
      tests, audit recovery, and safe migration from personal workspaces.
- [ ] Continue the full mobile adaptation pass: smaller-phone layouts,
      touch-first context actions, bottom-sheet replacements for dense menus,
      virtualized long lists, and browser-tested motion at 320-480 px.
- [ ] Improve tablet split-view behavior and installable PWA navigation.

## Data layer

- [ ] Introduce a formal storage-adapter interface around the current SQLite
      repository.
- [ ] Add a production-ready MySQL adapter with migrations, transaction tests,
      backup/restore documentation, and SQLite-to-MySQL import tooling.
- [ ] Evaluate PostgreSQL after the adapter contract and MySQL implementation
      are stable.

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
