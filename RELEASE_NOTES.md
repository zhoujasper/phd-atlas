# PhD Atlas Release Notes

This is the human-written source for GitHub Release descriptions. Keep one
section per version using the exact heading `## v<package.json version>`.
Automation extracts only the matching section, so older notes remain immutable
history while the next version can be prepared in the same file.

## v0.1.0-beta.6

**Prerelease — Beta / 预发布版本。** Back up the complete workspace before
upgrading.

> **Required migration for Beta.5 and earlier:** do not rely on the old
> **Check for updates → Install** path for this one transition. Download
> `phd-atlas-update-0.1.0-beta.6-release.tar.gz` from this Release and upload it
> through **Admin → System information → System update → Manual update**.
> Once Beta.6 is running, later Release updates can complete automatically.
>
> **Beta.5 及更早版本必须手动过渡：** 本次不要依赖旧版的“检查更新 → 安装”流程。
> 请从本 Release 下载 `phd-atlas-update-0.1.0-beta.6-release.tar.gz`，然后在
> **管理后台 → 系统信息 → 系统更新 → 手动更新**中上传。成功运行 Beta.6 后，
> 后续 Release 可恢复全自动更新。

### Highlights

- **Future server dependencies are automatic.** The update builder derives the
  complete production graph directly from standard `dependencies`,
  `optionalDependencies`, and lockfile metadata. A new server extension no
  longer needs a second handwritten allowlist.
- **Every production package travels with the Release.** Exact dependency
  archives are downloaded during publishing, checked against
  `package-lock.json` integrity, embedded below the legacy-compatible `tools/`
  boundary, and proven with a real offline `npm ci`. Compiled frontend
  libraries remain development/build dependencies and are not reinstalled on
  the server.
- **International and mainland source fallback.** Publishing and legacy
  recovery may use the original third-party URL, npmjs, npmmirror, Yarn's
  compatible registry, and fixed GitHub mirrors where applicable. Every mirror
  result must match the lockfile integrity; source fallback never weakens
  verification.
- **No unbounded dependency spinner.** npm output, source changes, and
  heartbeats are stored in the durable update journal. Per-attempt no-progress
  and total deadlines terminate a stuck process tree, try the next source when
  possible, and then use the existing verified rollback path.
- **The whole update is server-owned.** Download, checksum verification,
  backup, dependency installation, restart, and first-boot recovery continue
  after the browser closes. Reopening Admin restores persisted status and
  privacy-redacted diagnostics; polling reads no longer exhaust the upload
  limiter.
- **Transport stalls recover safely.** GitHub Release downloads have separate
  response-header and streamed no-progress bounds. A progressing official
  transfer may finish; only a stalled attempt is cancelled before fixed HTTPS
  mirrors are probed, and every payload must still match GitHub's exact size
  and SHA-256 sidecar.

### 中文摘要

- **后续服务端依赖自动进入更新。** 构建器直接读取标准 `dependencies`、
  `optionalDependencies` 和 lockfile，不再要求维护第二份手写白名单；新增服务扩展
  不会因为漏填清单而缺失。
- **生产依赖随 Release 一起交付。** 发布时下载精确依赖归档，逐个校验
  `package-lock.json` 完整性，放入旧版也允许的 `tools/` 边界，并执行一次真实离线
  `npm ci`。已编译进网页包的前端库仍属于开发/构建依赖，不会在服务器重复安装。
- **国内、国际多源回退。** 发布和旧运行时恢复可依次使用原始第三方地址、npmjs、
  npmmirror、Yarn 兼容源，以及适用时的固定 GitHub 镜像；任何来源都必须匹配
  lockfile 完整性，切换镜像不会降低校验标准。
- **依赖安装不再无限转圈。** npm 输出、来源切换和心跳会写入持久更新日志；单次
  无进展与总时限会终止卡住的进程树，在可行时继续尝试下一来源，最终仍走已验证的
  自动回滚。
- **整次更新由服务端持久接管。** 关闭浏览器后，下载、校验、备份、依赖安装、
  重启和首次启动恢复仍会继续；重新打开后台可恢复状态和脱敏日志，只读轮询也不会
  再耗尽上传限流。
- **Release 正文停滞可安全恢复。** GitHub 下载分别限制响应头等待和流式无进展时间；
  持续产生字节的官方传输可正常结束，只有真正停滞时才取消并探测固定 HTTPS 镜像，
  所有文件仍必须匹配 GitHub 精确大小和官方 SHA-256 sidecar。

Full details / 完整记录:
[English changelog](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0-beta.6/CHANGELOG.md)
·
[简体中文更新日志](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0-beta.6/CHANGELOG.zh-CN.md)

## v0.1.0-beta.5

**Prerelease — Beta / 预发布版本。** Back up the complete workspace before
upgrading. This release enables the full Team collaboration workspace in the
public self-hosted edition, alongside a refined first-run mail and security
setup flow.

### Highlights

- **Public Team collaboration.** The public repository now ships the same
  owner, teacher, and student roles, invitations, scoped workspaces, shared
  application workflows, audit history, and server-authoritative Team
  permissions as the private source build.
- **Verified first-run mail.** Initial `/admin` setup now sends a six-digit
  code through the configured SMTP account and requires verification at the
  configured notification mailbox before administrator creation can finish.
- **Reliable setup and notifications.** Complete bootstrap secrets copy
  correctly, HTML is rendered safely in verification emails, and device-push
  operations time out cleanly instead of leaving a permanent spinner.
- **Polished research and administration.** Discover saves its draft before
  handing users to AI-key setup; public UI improvements cover CSV imports,
  responsive admin navigation, touch selection, consistent field sizing, and
  localized helper copy.

### 中文摘要

- **公共版 Team 协作。** 公开仓现已提供与私有源码一致的所有者、教师、学生角色，
  邀请、范围受控的工作空间、申请协作、审计历史和服务端权限校验。
- **验证式首次邮件配置。** `/admin` 首次配置会通过已填写的 SMTP 邮箱发送六码验证码，
  并要求在通知收件箱验证成功后才能完成管理员创建。
- **更可靠的初始化与通知。** 完整安全密钥可正确复制，验证邮件安全渲染 HTML，
  设备通知操作不会再因部署异常永久转圈。
- **调研与管理端优化。** Discover 跳转 AI 密钥配置前会保存草稿；CSV 导入、后台窄屏、
  触控选中态、字段尺寸和辅助文字均已完成优化。

Full details / 完整记录:
[English changelog](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0-beta.5/CHANGELOG.md)
·
[简体中文更新日志](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0-beta.5/CHANGELOG.zh-CN.md)

## v0.1.0-beta.4

**Prerelease — Beta / 预发布版本。** Back up the complete workspace before
upgrading. This release adds theme toggle and language switching to the
first-time setup wizard, comprehensive three-platform deployment scripts, and
ships a streamlined 826 MB Docker image.

### Highlights

- **Theme & language on setup page.** The first-time `/admin` initialization
  wizard now includes a light/dark theme toggle and a language switcher (12
  languages), matching the controls on the admin login page.
- **Three-platform deployment docs.** Self-contained, color-coded deployment
  scripts for Windows CMD/PowerShell, Linux/Ubuntu, and BT Panel (three
  methods: GUI, terminal, Docker Compose), each with management commands.
- **Slim Docker image.** Multi-stage Alpine build with esbuild-bundled
  entrypoint cuts the image from 1.14 GB to 826 MB.
- **NJU mirror.** `ghcr.nju.edu.cn` documented as an alternative pull source.
- **ESM compat fix.** `bootstrapSecrets.js` uses `fileURLToPath` instead of
  `__filename`.
- **Team features enabled.** Private source build includes the full team
  command center.

### 中文摘要

- **初始化页面的主题和语言切换。** 首次 `/admin` 引导配置现在支持亮色/暗色
  主题切换和 12 种语言切换。
- **三平台部署文档。** 独立、带颜色标注的部署脚本，覆盖 Windows、Linux 和
  宝塔面板三种环境。
- **Docker 镜像瘦身。** 多阶段 Alpine 构建将镜像从 1.14 GB 缩减至 826 MB。
- **NJU 镜像站文档**，方便国内用户加速拉取。
- **ESM 兼容修复**，`bootstrapSecrets.js` 改用 `fileURLToPath`。
- **Team 功能已启用**，私有源码构建包含完整团队协作中心。

Full details / 完整记录:
[English changelog](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0-beta.4/CHANGELOG.md)
·
[简体中文更新日志](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0-beta.4/CHANGELOG.zh-CN.md)

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
