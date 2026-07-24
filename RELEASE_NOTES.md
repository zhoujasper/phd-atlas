# PhD Atlas Release Notes

This is the human-written source for GitHub Release descriptions. Keep one
section per version using the exact heading `## v<package.json version>`.
Automation extracts only the matching section, so older notes remain immutable
history while the next version can be prepared in the same file.

## v0.1.0-beta.3

**Prerelease — Beta / 预发布版本。** Back up the complete workspace before
upgrading. Docker one-command deployment is now the default path.

### Highlights

- **One-command Docker deployment.** A single `docker run` with `--env DOMAIN=`
  is enough — JWT signing keys and data-encryption keys are auto-generated on
  first boot and persisted to `storage/bootstrap-secrets.json`.
- **Auto-derived URL configuration.** `BASE_URL`, `CORS_ORIGIN`, and
  `ALLOWED_HOSTS` are derived from the single `DOMAIN` environment variable when
  not set explicitly.
- **Security keys step in the `/admin` setup wizard.** Auto-generated keys are
  displayed in the guided flow with a one-click regeneration option, copy
  buttons, and destructive-action confirmation.
- **Drastically simplified documentation.** Installation and deployment guides
  are now ~1/4 of their previous length — focused on the Docker happy path
  with a Vaultwarden-style one-liner.
- **Minimal `.env.example`.** Only `DOMAIN` is required; all other fields are
  optional overrides.

### 中文摘要

- **Docker 一键部署。** 只需 `docker run --env DOMAIN=` 即可启动，JWT 和加密密钥首次启动自动生成并持久化。
- **URL 自动推导。** 从单个 `DOMAIN` 变量自动推导 `BASE_URL`、`CORS_ORIGIN`、`ALLOWED_HOSTS`。
- **Admin 初始化新增安全密钥步骤。** 引导流程中展示自动生成的密钥，支持一键重新生成、复制和确认保护。
- **文档大幅精简。** 安装和部署指南缩减至原来的 1/4，聚焦 Docker 一条命令上线。
- **最小化 `.env.example`。** 仅需 `DOMAIN`，其余均为可选覆盖项。

## v0.1.0-beta.2

**Prerelease — Beta / 预发布版本。** Back up the complete workspace and the
selected external database, if used, before installing or updating. Beta data
formats and update paths may still change before the first stable release.

### Highlights

- Added a guided first-run `/admin` setup for SQLite, MySQL/MariaDB,
  PostgreSQL, and Microsoft SQL Server, including connection tests and guarded
  migration controls.
- Published public multi-architecture Docker images at
  `ghcr.io/zhoujasper/phd-atlas` for `linux/amd64` and `linux/arm64`, with
  immutable `v0.1.0-beta.2` / `0.1.0-beta.2` tags and the rolling `beta`
  channel. Beta intentionally does not move `latest`.
- Added automatic update discovery in Admin and a manual package-upload
  fallback for restricted or offline servers.
- Added durable Docker update replay without Docker-socket access, coordinated
  worker restarts, first-boot confirmation, and rollback to the previous
  runtime when validation fails.
- Added deterministic
  `phd-atlas-update-0.1.0-beta.2-release.tar.gz` packaging with a matching
  SHA-256 sidecar, strict archive validation, reproducibility checks, and
  install/replay/rollback verification.
- Expanded English and Simplified Chinese installation and deployment guides
  for Docker Compose, Linux/systemd, Windows/WinSW, reverse proxies, TLS/private
  CAs, persistent storage, database migration, updates, and Beta rollback.

### 中文摘要

- 新增首次 `/admin` 引导配置，支持 SQLite、MySQL/MariaDB、PostgreSQL 与
  Microsoft SQL Server，并提供连接测试和受控迁移。
- 新增公开的 AMD64/ARM64 Docker 镜像、固定版本标签与滚动 `beta` 通道；
  Beta 阶段不会更新 `latest`。
- 新增 Admin 自动检查更新、手动上传更新包、Docker 持久更新重放、启动确认
  与失败自动回滚。
- Release 更新包现在可复现构建，并在发布前验证 SHA-256、文件边界、安装、
  重放和回滚。

Full details / 完整记录:
[English changelog](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0-beta.2/CHANGELOG.md)
·
[简体中文更新日志](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0-beta.2/CHANGELOG.zh-CN.md)

## v0.1.0-beta.1

**Initial public Beta / 首个公开测试版。** This release established the
self-hosted, privacy-first, single-workspace edition of PhD Atlas. Back up data
before testing Beta updates; compatibility guarantees begin with the first
stable release.

### Highlights

- Introduced the application command center with application CRUD, search,
  filters, list/Kanban views, dashboard analytics, deadlines, priorities, and
  progress tracking.
- Added complete application dossiers for schools, supervisors, research fit,
  materials, recommendation letters, scholarships, tasks, fees, submission
  readiness, and a unified timeline.
- Added program/supervisor discovery and comparison, reusable profile
  materials, correspondence history, SMTP sending, scoped IMAP collection, and
  attachment handling.
- Added expiring share links, JSON/CSV/Excel/PDF exports, calendar feeds,
  browser notifications, whole-workspace backups, account administration, and
  encrypted integration settings.
- Shipped responsive desktop/tablet/mobile layouts, PWA/offline support,
  light/dark and accessibility preferences, plus twelve language packs.
- Published the first verified GitHub Release update archive and SHA-256
  sidecar for the public Beta.

### 中文摘要

- 首次公开单工作空间版本，覆盖申请管理、材料清单、导师与项目发现、任务与
  时间线、奖学金、通信记录和个人资料库。
- 支持分享链接、多格式导出、日历与通知、完整工作空间备份、后台账户管理和
  集成密钥加密。
- 提供桌面、平板和手机响应式布局、PWA/离线能力、亮暗主题、无障碍偏好及
  12 种语言。
- 发布首个公开 Beta 更新包及 SHA-256 校验文件。
