# Changelog

[简体中文](CHANGELOG.zh-CN.md)

All notable changes to the public edition of PhD Atlas are documented in this
file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.4] - 2026-08-27

### Changed

- Desktop launches now enter the local personal workspace directly. The web
  email/password screen remains a browser-only entry point, while the optional
  opening password is the sole local gate.
- Desktop data is portable beside the Windows executable or macOS app. User
  Data and Cache stay with the package, and legacy local folders are migrated
  without redirecting workspace data into the operating-system profile.

### Fixed

- Hid SMTP/IMAP, mail reminders, share links, calendars, browser push, and
  website upgrade chrome until a desktop installation is explicitly connected
  to a deployed web account; local save failures now use local wording.
- Sharded the HTTP mutation admission gate per account, raised the global
  default from 4 to 16, and queued each account above its six active slots so
  one user's normal save burst no longer reports `SERVER_BUSY` as global load.
- Stabilized the complete Node 24 release suite by disabling Node's shadowing
  experimental web storage, forcing collection around RSS assertions, and
  preventing stale local keep-alive reuse in Web Push route tests while
  batching 200-request client bursts without weakening assertions.
- Updated the mail parsing, IP classification, ID generation, and HTTP client
  dependency paths to patched versions after a same-day audit found six high
  advisories. Both production-only and complete dependency audits now report
  zero vulnerabilities, and the strict tree gate runs the audit on every
  future release.
- Made the source-secret audit qualify both Git checkouts and the Git-free
  public export used by release preflight, with fail-closed link handling.
- Restored the portable-path source/declaration pair to the minimal Docker
  build stage so full TypeScript qualification succeeds without adding desktop
  resources to the server runtime image.
- Build and smoke x64 and ARM64 public containers on native GitHub runners,
  assemble them only after both pass, and make version Releases reuse the
  immutable image qualified for the exact public commit instead of rebuilding
  production dependencies under QEMU.
- Extended the bounded public CI and native container job budgets after an
  otherwise clean uncached Docker build exceeded the former 35-minute limit
  while downloading Alpine build tools; all source, image, and smoke gates
  remain mandatory.
- Removed abandoned route/middleware scaffolds and orphaned investigation
  scripts, restored TypeScript coverage for portable desktop paths, and added
  commit/push guards that reject `Co-authored-by` trailers.

## [0.1.3] - 2026-08-24

### Added

- Added native Windows setup/portable and macOS DMG/ZIP desktop delivery. Every
  package is built on its native runner from the exact successful Release
  commit and is paired with a SHA-256 file before idempotent attachment.
- Added a personal desktop runtime with unlimited local quotas, optional local
  unlock password, complete workspace export/import, and an explicit remote
  account connection for web-backed storage and share links.
- Allowed Discover programmes without an individually verified advisor email
  to enter Applications with explicit evidence warnings instead of fabricated
  contact data or a hard import failure.

### Fixed

- Kept current update packages under the full runtime-file gate while allowing
  an integrity-checked historical Release package to serve as a differential
  base under its original launch contract. This lets the release workflow
  build the optional v0.1.1-to-v0.1.3 delta without weakening validation of the
  v0.1.3 target or reconstructed package.
- Published the complete successor to the tag-only v0.1.2 candidate. The
  Beta.8 direct-upgrade repair, real extracted-runtime preflight, historical
  updater replay, and rollback coverage are all carried forward.
- Preserved first-boot disaster recovery across runtime-schema generations:
  an exact previous-active format-v1 package can be restored after a failed
  current candidate, while ordinary active replay stays on the strict current
  schema.
- Split release qualification into four isolated serial Vitest shards. All
  shards remain mandatory, while each worker has a bounded lifetime instead of
  accumulating the entire source and public-export suites in one process.
- Made local Compose qualification independent of host CLI plugins and
  bind-mountable temporary paths. A digest-pinned official Docker CLI container
  receives the exact Compose and environment files through `docker cp` and
  must validate them before either architecture can be built.
- Persisted the update-helper SQLite guard schema and added a bounded 250 ms
  scheduler handoff, preventing a transient just-closed handle from making
  both detached helpers lose while preserving exactly-one-winner semantics.
- Serialized SQLite handle replacement behind an exclusive source gate shared
  by encryption transitions, adapter maintenance, shutdown, forced external
  sync, and workspace hot backups. The gate fixes both pre-drain and post-drain
  races; transient remote failures retain the authoritative old handle and exact
  pending payload, and stale tenant stores cannot reverse the active policy.
- Canonicalized the bundled MCP CLI entrypoint before main-module detection so
  Claude Desktop packages launch through macOS path aliases, and prevented a
  popover's delayed initial focus from interrupting recipient-address typing.
- Restored reused Markdown bodies when reopening saved email drafts after a
  composer clear, and prevented delayed new-recommender focus from splitting
  rapid input across the name and email fields.

## [0.1.2] - 2026-08-18

### Fixed

- Repaired direct in-app upgrades from `0.1.0-beta.8` and other legacy update
  clients. The server's eight cross-boundary runtime modules now live inside
  the legacy-compatible `server/` archive root, so the installed server never
  imports a file that the old updater cannot validate, copy, replay, or restore.
- Strengthened the release gate to run the real Node runtime import preflight
  after an offline production dependency installation. A reproducible archive
  with a missing transitive server module can no longer be published merely
  because its manifest and dependency checks pass.
- Made all server-side shared modules explicit required runtime files and added
  a contract that prevents future production imports from escaping the update
  package boundary. Failed upgrades continue to restore the previous runtime.

## [0.1.1] - 2026-08-17

### Changed

- Restored the MIT License for the source and public distribution. The prior
  PhD Atlas Community License v1.0 is no longer the current license.

## [0.1.0] - 2026-08-10

This is the first stable public release. The entries below describe the work
completed since `0.1.0-beta.8`; they intentionally include both visible product
changes and the reliability work required to make the stable release honest.

### Added

- Added a continuous Admissions evidence workbench inside each application.
  Outcomes, decision-cycle distributions, advisor awards, funded projects,
  publications, unmatched evidence, bookmarks, and the final source ledger are
  separated clearly so a public post can never be presented as an official
  acceptance rate.
- Added a credential-free Reddit Atom fallback for historical applicant
  evidence. Query variants fail independently, successful posts keep their
  post-level permanent links, and school/programme mismatches stay visible as
  unmatched evidence without entering any admission statistic.
- Added official UKRI Gateway to Research project evidence alongside NSF, NIH,
  and OpenAlex. Every displayed research record retains its exact source URL,
  fetch time, match reason, and verified-or-possible status.
- Refreshed the independently checked Princeton neuroscience programme and
  advisor gold set with current Graduate School, PNI, QCN, PACM, Computer
  Science, personal, and research-profile URLs. Maintained school adapters may
  now request a larger but still absolutely capped page budget so every
  declared official fallback can be attempted when one university host is
  intermittently unavailable. Gold-set people can also carry official name
  variants, so a middle initial on one university page does not turn the same
  advisor into a false mismatch.
- Added target-bound saved research reports. Changing the school, programme, or
  advisor marks an earlier report stale and hides it until a new lookup
  succeeds, preventing evidence from one application appearing under another.
- Added installable PhD Atlas integrations for Codex and Claude Desktop: a
  direct Skill ZIP, optional local MCP Plugin ZIP, and one-click MCPB package,
  each with a matching checksum and the same account-scoped permission model.
- Added browser-based device authorization for MCP / Skill connections, with
  requested-scope review, connection naming, pause/resume, deletion, expiry,
  inactivity revocation, and immediate invalidation after account-security
  changes or a full restore.
- Added user-managed mail categories, custom category creation, multiple labels
  on one message, combined filtering, and AI classification that can return
  several allowed labels without inventing new ones.
- Added per-key AI routing controls. Saved keys can be enabled or paused,
  weighted independently, assigned a visible maximum concurrency from 1 to
  2,500, and configured for Auto, Responses API, or Chat Completions where
  supported. Weighted admission still obeys one aggregate 2,500 safety ceiling.
- Added an independent eight-programme / 24-advisor Discover gold set and a
  live-provider evaluation ledger. Integrity and coverage are scored
  separately, failed rounds remain in the record, and a model can extract
  evidence but cannot certify its own result.
- Added semantic timeline event types for deadlines, reminders, tasks, mail,
  manual notes, scholarships, tuition, and application fees, including direct
  navigation back to the exact source item.
- Added explicit Preview, Download, and Delete actions for uploaded checklist
  files while retaining double-click filename editing and read-only safety.
- Added a viewport-level application batch-action dock, a sticky real table
  header, progressive near-bottom row loading, and retained selection when the
  resident table is temporarily hidden behind Board.
- Added field-specific multilingual validation and recovery surfaces that name,
  reveal, and focus the exact invalid control instead of showing only a generic
  error.
- Added extreme-scale qualification for 100,000 metadata rows, a real 20,000-row
  encrypted database, 300 resident SSE clients, 300 same-address health
  WebSockets, restart readback, long-running autosave, and bounded memory.
- Added `server/sources/`, a policy-bounded adapter layer for outside admission
  data. Each source declares its own rate limit, cache lifetime, concurrency,
  timeout, retry policy and user agent instead of inheriting one global crawl
  behaviour, and every extracted value carries its source id, exact URL and
  fetch time so the interface can link back and show when data has gone stale.
  Shipped adapters: NSF Award Search and NIH RePORTER (official, keyless, and
  the strongest available signal for whether a professor can currently fund a
  student), OpenAlex works, GradCafe results, and Reddit through its official
  OAuth API or Atom feed rather than page scraping.
- Added `POST /api/interview-prep/ai/mock-turn`. The interview backend already
  produced follow-up questions, scoring, and strengths and improvements from
  resume, advisor homepage and paper signals, but none of it was reachable.
  Mock practice can now request a follow-up, appended to the live session.
- Added a mail action that captures a message into interview preparation,
  creating or restoring a workspace carrying the application, source message,
  subject, school, programme and advisor.
- Added `GET /api/profile/recommenders` with cursor paging and a per-entry
  detail route, so the recommender directory no longer has to arrive whole.
- Added endurance testing under `npm run qa:endurance`: sustained multi-user
  autosave with read-back verification, single-user saving against concurrent
  background jobs, long-lived SSE and WebSocket connections, and process
  liveness monitoring.
- Added event-loop lag, resident memory, memory budget and pressure level to
  `/api/health`, so production behaviour can be read directly instead of
  inferred from response timing.
- Added evaluation harnesses for mail classification and AI output quality,
  with labelled fixtures including a prompt-injection attempt.

### Changed

- Replaced the public MIT license with the PhD Atlas Community License v1.0.
  Individuals and non-profit entities may use the project for personal,
  academic, research, educational, charitable, and other non-commercial
  purposes; any use by or for a for-profit or commercial organization requires
  prior written authorization, including internal use, SaaS, consulting,
  hosted services, resale, and contractor use on its behalf.
- Promoted the public edition from Beta to the first stable `0.1.0` line. Stable
  releases now own the `stable` and `latest` container channels, while Beta
  releases move only `beta`, so a future prerelease cannot pull stable users
  backwards.
- Archived Team collaboration across current runtime, navigation, upgrades,
  administration, default tests, and public exports. The implementation and
  stored Team data remain intact for a future deliberate restoration; current
  releases are personal-only and do not seed or load Team workspaces.
- Rebuilt application-to-Dossier entry around one focused record read. The
  outgoing application remains visible while the destination is prepared, and
  rapid selections are latest-intent-wins without a blank center or stale
  inspector.
- Reworked Board entry and Board/Table switching as interruptible resident
  handoffs. The click updates immediately, heavy trees mount on transition or
  idle lanes, and a previously opened Board is reused after returning from a
  Dossier instead of being rebuilt.
- Deferred dense Dossier tab content while keeping the tab highlight urgent.
  The previous panel stays painted until the next panel commits, including on
  narrow touch layouts and reduced-motion systems.
- Reworked checklist drag-and-drop so the canonical order commits before the
  overlay is removed. Cross-group moves, interrupted drags, slow React commits,
  and reduced motion now share one destination owner without snap-back or a
  second post-drop jump.
- Made checklist rows smaller and clearer: material type, group, and status
  share a desktop row; due dates can be empty; completion marks stay mounted;
  titles are borderless; upload filenames preserve their original extension;
  and legacy custom material types keep their edit/delete actions.
- Flattened the application timeline from nested cards into semantic editorial
  rows. Titles, status, source, dates, notes, money values, and edit controls now
  follow the meaning of each event and wrap safely on phones.
- Simplified Correspondence headers and composers. Message counts sit beside
  the title, filters and bulk AI controls enter and leave as one measured row,
  sent/received direction uses one accessible sliding control, avatars follow
  the actual author, and subject/date controls use quiet underlines.
- Moved the application table's selected-item tools to a compact page-level
  dock and kept row/table geometry stable during selection. Board and Table now
  share one heading line, title help, and control baseline.
- Made application switching, table loading, selection, country disclosures,
  profile shortcuts, checklist completion, and language handoffs use bounded
  transform/opacity motion with explicit reduced-motion behavior.
- Unified compact form geometry across native fields, shared Select controls,
  date pickers, fee fields, status controls, and adjacent actions on desktop,
  while preserving phone touch sizes.
- Changed fee totals and rows to locale-aware currency symbols such as `CA$`;
  paid, outstanding, and waived states are now text-only instead of decorative
  status dots.
- Changed AI mail classification to incoming email only. Sent mail, drafts,
  notes, and manually recorded outgoing messages remain available for ordinary
  organization but are excluded from AI batches on both client and server.
- Removed authored-projection v1 and other retired fallback paths. Browser,
  API, offline queue, settings writes, workspace streaming, Codex CLI, and
  stress tools now share one current acknowledgement and mutation protocol.
- Workspace writes are now sharded per tenant. Each account and team keeps its
  own revision, so two people saving at the same time no longer contend, and a
  revision-only conflict is retried and merged on the server instead of being
  returned to the user. Audit events no longer take part in the
  compare-and-swap at all; they are appended idempotently.
- The libuv thread pool is now sized from the host CPU count at startup. It had
  never been set anywhere, so password hashing, filesystem work and compression
  shared four threads. Password admission is bounded by the pool size and the
  memory budget together, so queueing happens where it can be observed and shed
  rather than inside a library with no timeout or fairness.
- Payloads above 64 KiB are encrypted and serialised on a worker pool, falling
  back to the main thread when a worker is unavailable.
- The default memory budget is 1 GiB, preferring the cgroup value when present.
  The previous 512 MiB put the hard stop below the peak that normal workspace
  hydration legitimately reaches.
- First paint requests list-shaped applications, omitting correspondence
  bodies, detail prose, file version history and comment text. One
  representative record drops from 386,221 to 847 bytes; selecting a record
  loads it in full. The offline snapshot still stores complete records, fetched
  while the browser is idle.
- The recommender directory pages from the server, aggregates in a worker and
  renders in batches. One thousand recommenders across two hundred
  applications now aggregate in roughly 50 ms.
- Advisor discovery collects more candidates. OpenAlex was only ever reading
  the first page of results against institutions holding tens of thousands of
  authors, so the candidate pool was small before any limit applied. It now
  pages with a bounded cursor, Crossref backfill triggers whenever the count
  falls short of target, scholarly evidence per school rose from 36 to 48
  researchers, recent works per researcher from three to five, and crawl
  concurrency from three to six. Four further limits were measured and
  deliberately left unchanged.
- Discover now treats "evidence-exhaustive" as every distinct item in the
  finite evidence it actually fetched, not as an internet-wide completeness
  claim. Programme/advisor display quotas were removed; every retained advisor
  is grounded on an individual official profile before scholarly enrichment,
  and deterministic profile overlap ranks even honest zero-match results.
- Application enrichment extracts more completely. Measured against a live
  provider, usable results rose from roughly half to roughly nine in ten. The
  verifier now separates "evidence exists and must be extracted" from "evidence
  is absent, leave it empty", treats summary fields as required when evidence
  supports them, enumerates requirements across every page rather than the
  first, and keeps a named advisor with a caveat instead of blanking them.
  Anti-fabrication constraints are unchanged, and fabrication counters stayed
  empty before and after.
- Motion was audited and selectively corrected. The Discover slider tracks the
  pointer one-to-one while dragging, indicators animate by transform rather
  than layout properties, Command Palette opens without motion because it is a
  keyboard path used many times a day, mobile dialogs leave along the path they
  arrived on, and toast content and slot timing were unified. Long decorative
  motion was judged correct and left as it was.
- Rate-limited responses carry `Retry-After` on every path, and the bundled
  Nginx template gains authentication-specific limits answering with a
  structured JSON 429.
- Conditional requests now cover applications, the recommender routes and the
  Discover catalogue.

### Fixed

- Fixed shared-directory, administrative-structure, governance, and other
  generic pages being retained as named advisors. FAQ, curriculum-vitae,
  research-staff, directory, organisational-structure, university-leadership,
  and similar labels are rejected as people; declared advisor pages must now
  contain real name evidence in the title, text, or path. Opaque numeric
  profile URLs and approved lab/research-group pages remain supported when
  their page content actually identifies the advisor.
- Fixed an AI provider connection reset after response headers aborting a
  complete multi-program Discover run. Connection, header, body, DNS, timeout,
  and socket interruptions that happen while reading the response are now
  reported as temporary provider unavailability, so the existing bounded retry
  path can recover instead of treating the interruption as an unknown failure.
- Fixed temporary DNS resolution and public-provider connection failures being
  misreported as invalid URLs. They now enter the bounded retry path as
  provider unavailability, while malformed, private-network, and reserved
  destinations remain rejected.
- Fixed Interview Prep requests being cancelled as HTTP 499 on runtimes that
  expose their own framework-level request signal. Interview operations now
  trust only the admission middleware's explicit AI cancellation signal, so
  consuming a normal request body cannot cancel the work that follows.
- Fixed two cross-runtime ownership leaks found by the cloud public-release
  gate: bounded stream output now owns an exact-length backing buffer even when
  the platform allocator rounds allocations up, and deferred UI-settle
  callbacks retain their scheduling Window instead of reading a global that a
  test or host may already have torn down.
- Fixed false post-suite failures when the release gate verifies the private
  and exported public trees back to back. Release qualification now runs the
  complete Vitest suite with one worker and file parallelism disabled; ordinary
  development tests retain their faster two-worker default.
- Fixed a Linux-only false failure in the HTTP admission lifecycle coverage.
  The server still has to prove that it released the partial request and its
  socket immediately; the test now also waits for Node's bounded asynchronous
  client-close notification before checking the mirrored client state.
- Fixed local development and production-like restarts where the API worker
  could exit while Vite remained reachable. A persistent bounded-jitter
  supervisor now owns worker restarts without killing an unknown process that
  happens to own the port.
- Fixed the browser turning one gateway or health failure into a lasting
  offline screen. Connectivity now treats a short restart as provisional,
  probes for recovery, and keeps the resident workspace visible unless the
  outage is sustained.
- Fixed a buffered application search being cleared when a remote logout or
  other safe-reload request was blocked by unsaved work. The search field now
  participates in the shared synchronous flush boundary, and an older delayed
  parent echo cannot overwrite a newer local keystroke under heavy load.
- Fixed recurring single-editor save conflicts caused by an old projection
  version hashing server-owned mail and classification fields differently from
  the current server. Editor-owned and server-owned fields now have one shared
  authority definition across online, offline, delta, and acknowledgement paths.
- Fixed workspace streams restarting after unrelated quota, backup,
  notification, or journal writes. Stream validation now follows the authored
  tenant content instead of a database-wide operational revision.
- Fixed automatic backups repeatedly walking stable records every minute.
  Backup passes are bounded, skip unchanged records, and prioritize the oldest
  missing coverage without starving later applications.
- Fixed request floods in shared source and logo lookup paths by sharing
  in-flight work, negative results, cooldowns, and bounded caches across
  callers instead of multiplying identical external requests.
- Fixed a large-stream memory spike where the next encrypted workspace could
  decode before compression and socket callbacks released the previous one.
  Large leases now end only after the response transport actually settles.
- Fixed the shared heavy-work queue rejecting many honest first-attempt
  workspace bootstraps at once. A bounded account-fair feeder keeps one noisy
  account from creating a retry wave while retaining existing global limits.
- Fixed password reconnect and double-submit storms by sharing only identical
  in-flight password/hash verification work; no settled authentication result
  is cached and Argon2, rate limits, and admission rules remain unchanged.
- Fixed application deletion overtaking an in-flight save or being followed by
  a stale full write that resurrected the record. Save, atomic edits, and delete
  now share per-application ordering and the trash keeps the delete-owned
  snapshot.
- Fixed a retention restore race in which cached scan data could decide to
  remove a record restored after the scan. Destructive cleanup now rechecks
  live ownership and current timestamps before deletion.
- Fixed AI drafts that completed successfully but were shown as failed because
  a later best-effort audit write failed. Stream failures now keep their
  specific cause, and the successful terminal response is sent first.
- Fixed timeline icon clipping, Dossier title descenders, partial checkbox
  ticks, empty disclosure tails, merged version-row backgrounds, and toolbar
  controls that disappeared at compact desktop widths.
- Fixed uploaded files losing their extension after a user renamed them without
  typing a suffix, and fixed share-upload handoff so the exact checklist target
  and upload permission remain selected.
- Fixed stale callback captures in guidance drafts, notification publishing,
  and async message sends so an older continuation cannot clear or overwrite
  newer user text.
- Fixed a deadlock in the sharded write path. Re-entrancy had been established
  by a module-level owner, which a second tenant taking a lane would overwrite,
  so the inner acquisition stopped being recognised and blocked on the lane its
  own caller already held.
- Fixed a crash that ended the server process. A payload worker timeout called
  a binding that did not exist in the timer scope, and Node terminates on an
  uncaught exception there, so one slow payload became a restart.
- Fixed a permanent loading screen for any account that had never added a
  recommender. The absent setting produced a fresh array on every render, which
  the aggregation effect depended on, so it re-ran, set state and re-rendered
  without end and the application never reached a settled paint.
- Fixed pagination metadata missing from the streamed workspace bootstrap,
  which would have left streaming clients with a directory silently truncated
  to its first page and no cursor to continue.
- Fixed deployment templates pinning values that defeated the runtime sizing: a
  hardcoded thread pool size held every host at the formula floor, and a
  512 MiB budget reintroduced the pressure ceiling on Linux.
- Fixed a service worker update reloading the page on its own. Updates now
  raise a non-blocking banner, and activation runs the safe-reload guard first,
  so a dirty editor keeps its content and the prompt returns once it is clean.
- Fixed two Discover paths reporting "saved" without any acknowledgement that
  the write had been durably stored; they now report "submitted".
- Fixed source-scanning contract tests failing on line endings rather than on
  the ordering they exist to protect.

### Security

- Team runtime entry points, setup, upgrades, administration, notifications,
  background work, APIs, and public exports now fail closed in the personal-only
  release. Existing Team source and stored data remain archived rather than
  being silently reassigned or deleted.
- MCP / Skill access is bound to a real signed-in account, explicit scopes, a
  current authorization version, expiry, and server-side revocation. Installing
  a client never creates administrator access or bypasses application ownership.
- External admission sources retain per-adapter rate, timeout, cache, retry,
  user-agent, and provenance policy. Changed envelopes, fuzzy identity matches,
  private-network targets, and missing evidence fail closed.
- Source-distribution audits now exclude only files Git explicitly reports as
  deleted. Any other unreadable source remains a release-blocking failure, and
  the public exporter continues to reject private paths and runtime data.
- Strict-Transport-Security is emitted exactly once. The application keeps
  sending it so deployments behind a different proxy, a cloud load balancer or
  a direct TLS listener remain covered, and the bundled Nginx template hides
  the upstream copy before adding its own.
- Added owner isolation tests for the recommender routes, covering both
  cross-account reads and non-member access to the team route.
- Confirmed that mail classification resists prompt injection: a message
  instructing the model to return a fixed category and echo the system prompt
  was classified as irrelevant and leaked nothing.

### Performance and scale

- Final production-like qualification served 300 authenticated users, 300
  resident SSE clients, and 300 same-address health WebSockets with zero
  read/login capacity retries, then verified 300 durable writes and 300
  post-restart readbacks.
- Final endurance qualification completed 5,372 of 5,372 durable autosaves,
  52 background autosaves, 180 background tasks, 100 SSE clients, 100 health
  WebSockets, and 11,500 connection reads with 248.5 ms connection-read P95.
- The same run completed all 70 large workspace streams with zero restart and
  all 100 restart readbacks. Health, read, login, and mixed P95 were 217.9 ms,
  592.2 ms, 500.6 ms, and 1,196.2 ms respectively, with reservations released.
- Keyset validation now scans compact metadata in bounded batches rather than
  materializing all identifiers or issuing one native query per record. The
  real 20,000-row encrypted-store gate streams one payload at a time and keeps
  event-loop progress and memory bounded.
- Large workspace responses, encryption/decryption, compression, login work,
  ordinary requests, health traffic, and background jobs now use explicit
  size-aware lanes so one expensive operation cannot silently consume the
  capacity reserved for another.
- Build-time entry budgets keep signed-out pages and conditional feature styles
  out of the authenticated workspace startup graph; the final production build
  contains 1,231 modules and passed the current JS/CSS budgets.

### Verification

- Final whole-system interaction coverage passed 9 files / 144 tests; motion
  and workspace contracts passed 7 files / 34 tests.
- TypeScript, the production build, release contracts, source-security audit,
  targeted lint, Node syntax checks, and scoped diff validation passed on the
  final qualification state.
- Internationalization structure and key coverage passed 12 languages across
  18 namespaces, and the final shared UI/error audit reported zero findings.
- The public exporter, personal-only runtime boundary, update-package
  reproducibility, rollback verification, Microsoft SQL Server gate, and
  amd64/arm64 container smoke paths remain release-blocking checks.

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
- Added integrity-checked file-level differential Release packages. Exact-base
  installations download only added or changed runtime files and a deletion
  list, reconstruct a complete local package, and automatically fall back to
  the full package when the delta cannot be trusted or is not smaller.

### Changed

- Replaced the signed-out homepage's hand-built product replicas with the real
  Checklist, Correspondence, Funding, Timeline, Discover, and Profile
  interfaces, while retaining the previous image until the next capture has
  decoded successfully.
- Updated the public English and Chinese READMEs with responsive light/dark
  galleries sourced from the same real product captures, with all six views
  visible by default and still collapsible.
- Kept `react-simple-code-editor` lazy while normalizing Vite's CommonJS/ESM
  wrapper at one typed runtime boundary.
- Re-encoded the 288 DPR-2 product captures at a visually high-quality WebP
  setting while preserving every language, theme, layout, and pixel dimension;
  the capture set fell from 66.16 MB to 22.81 MB and the generated full update
  package fell by 25.6% in the local controlled build (72.46 MB to 53.94 MB),
  even after adding the differential-update runtime.

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

[0.1.3]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.3
[0.1.2]: https://github.com/zhoujasper/phd-atlas/tree/v0.1.2
[0.1.1]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.1
[0.1.0]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0
[0.1.0-beta.8]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.8
[0.1.0-beta.7]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.7
[0.1.0-beta.6]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.6
[0.1.0-beta.5]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.5
[0.1.0-beta.4]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.4
[0.1.0-beta.3]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.1
