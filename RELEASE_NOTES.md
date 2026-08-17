# PhD Atlas Release Notes

This is the human-written source for GitHub Release descriptions. Keep one
section per version using the exact heading `## v<package.json version>`.
Automation extracts only the matching section, so older notes remain immutable
history while the next version can be prepared in the same file.

## v0.1.1

**MIT License restored.**

- The source and public distribution now use the standard MIT License again.
- Package metadata and the public English and Chinese README license sections
  are aligned with the license file.

### 中文摘要

- **恢复使用 MIT License。** 源码、公开分发、package 元数据以及公开版中英文
  README 已统一恢复为 MIT License。

## v0.1.0

**First stable public release / 首个公开稳定版。** Back up the complete
workspace before upgrading an existing Beta installation.

> **Upgrade path:** Beta.6, Beta.7, and Beta.8 installations can use the
> automatic or manual update flow in Admin. Beta.5 and earlier installations
> must first complete the documented one-time transition to Beta.6, then update
> to v0.1.0. The first stable release publishes a complete update package; an
> exact-base differential package is not produced from a prerelease channel.
>
> **升级路径：** Beta.6、Beta.7 和 Beta.8 可直接使用管理后台的自动或手动更新。
> Beta.5 及更早版本必须先按文档完成一次性 Beta.6 过渡，再升级到 v0.1.0。
> 首个稳定版会发布完整更新包，不会从预发布通道生成精确基线差异包。

### Highlights

- **A serious non-commercial license boundary.** PhD Atlas now uses the PhD
  Atlas Community License v1.0 instead of MIT. Individuals and non-profit
  entities may use it for personal, academic, research, educational,
  charitable, and other non-commercial purposes. Any use by or for a
  for-profit company or commercial organization requires prior written
  authorization — including internal use, SaaS, paid hosting, consulting,
  resale, and contractor use on its behalf.
- **The stable public product is personal-only.** Team navigation, setup,
  upgrades, administration, APIs, background work, tests, and public export
  paths are archived and fail closed. Existing Team source and stored data are
  retained rather than reassigned or deleted.
- **Admissions research is evidence you can inspect.** A new application-level
  workbench separates outcomes, decision cycles, advisor funding/projects,
  publications, unmatched evidence, bookmarks, and a final source ledger.
  UKRI joins NSF, NIH, and OpenAlex, and every result keeps provenance, fetch
  time, match reasons, and verified-versus-possible status. Advisor grounding
  now rejects FAQ and staff-directory labels as people, while still accepting
  numeric profile URLs and shared lab pages when the page contains real name
  evidence. Princeton neuroscience fallbacks were refreshed across its current
  official hosts, with a bounded per-school crawl budget that still obeys the
  global absolute cap. Maintained official name variants also keep a middle
  initial from splitting one advisor into two apparent identities. Reddit can
  fall back to its official Atom feed without OAuth; mismatched posts remain
  inspectable but never enter admission statistics.
- **Discover reports what it could not prove.** An independent gold set covers
  eight programmes and 24 advisors, and real-provider rounds score evidence
  integrity separately from source coverage. The retained final rows pass the
  implemented integrity gates, but no completed live round passed the full
  coverage gate, so this release does not claim to have found every programme
  or advisor on the internet.
- **Codex and Claude Desktop can work inside your real account boundary.** The
  release includes a Skill, optional local MCP Plugin, and Claude Desktop MCPB
  with checksums, browser authorization, explicit scopes, naming,
  pause/resume, deletion, expiry, inactivity revocation, and server-side
  invalidation after security changes.
- **Mail organization is finally flexible.** Create your own categories, put
  several labels on one incoming message, combine filters, and let AI choose
  one or more existing labels. AI batches exclude sent mail, drafts, and notes,
  and the model cannot invent categories.
- **AI keys have independent routing policy.** Each saved key can be paused,
  weighted, given a visible 1–2,500 concurrency cap, and configured for Auto,
  Responses API, or Chat Completions where the provider supports it. The
  aggregate runtime ceiling remains 2,500.
- **Applications feel continuous instead of rebuilding around every click.**
  Dossier entry, tab changes, Board entry, Board/Table switching, application
  selection, near-bottom table loading, and the page-level batch dock retain
  the outgoing content until the requested destination is ready.
- **Checklist and timeline work now match what you see.** Drag order commits to
  the real destination before the overlay disappears; cross-group moves no
  longer snap back. Optional due dates, persistent completion marks, explicit
  file actions, preserved extensions, semantic timeline types, fees, funding,
  mail, reminders, and direct source navigation are all included.
- **Correspondence and everyday controls are calmer.** Direction, authorship,
  filtering, counts, subject/date fields, avatars, fee currency symbols,
  profile shortcuts, headers, country menus, and compact mobile/desktop
  controls were simplified without hiding keyboard, touch, high-contrast, or
  reduced-motion behavior.
- **Saving, deleting, backups, and offline recovery share one truthful order.**
  A stale write cannot resurrect a deleted application; a deletion cannot
  overtake a pending save; automatic backup no longer loops over unchanged
  records; and old server-owned mail/classification fields no longer create a
  permanent single-editor conflict.
- **Short server restarts no longer look like lost connectivity.** A persistent
  API supervisor owns worker recovery, the browser waits for sustained outage
  evidence before entering offline mode, and workspace streams ignore unrelated
  quota, notification, backup, and journal revisions. If an AI provider drops
  the connection while its response body is still being read, the interruption
  is classified as temporary provider unavailability and can use the existing
  bounded retry path instead of terminating the entire Discover batch.
- **Interview Prep cancellation is explicit on Node 24.** A framework-owned
  request signal can no longer turn a fully received save or AI request into a
  false HTTP 499. Only the server's admission-owned AI cancellation signal may
  stop question generation, mock turns, feedback, or durable saves.
- **Extreme load was qualified, not guessed.** The final production-like gate
  served 300 authenticated users, 300 SSE clients, and 300 same-address health
  WebSockets with zero read/login capacity retries, then verified 300 durable
  writes and 300 restart readbacks. The final endurance gate completed
  5,372/5,372 durable autosaves, 70/70 large streams with zero restart, and
  100/100 restart readbacks; all reservations returned to zero.

### 中文摘要

- **商业授权边界已经正式写清楚。** PhD Atlas 不再使用 MIT，而是使用 PhD Atlas
  Community License v1.0。个人以及公益、慈善、非营利机构可用于个人、学术、科研、
  教育、公益和其他非商业目的；任何营利机构、商业组织或企业都必须事先取得书面授权，
  包括企业内部使用、SaaS、付费托管、咨询、转售和承包商代表企业使用。
- **公开稳定版只提供个人工作空间。** Team 导航、首次设置、升级、管理、API、后台任务、
  专属测试和公开导出路径均已归档并失败封闭。原有 Team 源码与历史数据保留，不会被
  偷偷改归个人或删除。
- **Admissions 调研变成可以逐条核查的证据工作台。** 录取结果、申请周期、导师经费/
  项目、论文、未匹配证据、收藏和最终来源清单分开显示；UKRI 与 NSF、NIH、OpenAlex
  一起提供证据，每条记录保留来源、时间、匹配原因和“已核实/可能匹配”状态。FAQ、
  staff directory 等栏目名不会再冒充导师；纯数字个人主页或实验室共享页只有在页面中
  确实找到姓名证据时才会被保留。Princeton 神经科学的当前官方入口与备用域名也已重新
  核对，并使用仍受全局绝对上限约束的学校级有界抓取预算；官网姓名多一个中间名首字母
  时，也会按维护过的姓名变体识别为同一位导师。没有 OAuth 时，Reddit 会使用官方 Atom
  feed；不匹配的帖子仍可检查，但绝不会进入录取统计。
- **Discover 会把没有证明的部分如实说出来。** 独立金标准覆盖 8 个项目和 24 位导师，
  真实服务商实测把“证据是否真实”和“来源是否覆盖完整”分开判定。最终保留行通过现有
  真实性门禁，但没有一轮完整实测通过全部覆盖门槛，因此本版本不会宣称已经找遍互联网
  上的所有项目和导师。
- **Codex 与 Claude Desktop 可以在真实账号权限内工作。** 本版本提供带校验文件的
  Skill、可选 MCP Plugin 和 Claude Desktop MCPB；浏览器授权会显示 scope，并支持
  改名、暂停、恢复、删除、到期、长期未使用失效和服务端安全撤销。
- **邮件分类终于可以按自己的习惯组织。** 可以新建分类、一封来信加多个标签、组合筛选，
  也可以让 AI 从已有分类中选择一个或多个标签。已发送邮件、草稿和笔记不会进入 AI
  批量分类，模型也不能私自发明分类。
- **每把 AI 密钥都有独立路由策略。** 可分别暂停、设置权重和 1–2,500 的可见最大并发，
  并在服务商支持时选择自动、Responses API 或 Chat Completions；运行时全局安全上限
  仍为 2,500。
- **申请切换不再每点一下就重建整块界面。** Dossier 进入、标签切换、看板进入、看板/
  表格切换、申请选择、接近底部加载和页面级批量操作都会保留旧内容，直到目标真正就绪。
- **清单和时间线现在“看到什么就落到什么”。** 拖拽顺序会先提交到真实落点再收起浮层；
  跨分组不再弹回。空截止日期、常驻完成勾、明确文件操作、保留扩展名、语义时间线、
  费用/资助/邮件/提醒事件与精确跳转全部纳入本版。
- **通信和日常控件更安静。** 收发方向、作者身份、筛选、数量、主题/日期、头像、货币
  符号、个人资料快捷入口、页头、国家菜单与紧凑控件都重新整理，同时保留键盘、触摸、
  高对比度和减少动态效果路径。
- **保存、删除、备份和离线恢复只认同一套顺序。** 旧写入不能在删除后把申请复活，删除
  不能越过待保存内容，自动备份不会反复处理没变化的数据，旧邮件/分类字段也不会再让
  单人编辑陷入永远冲突。
- **短暂服务重启不再被误报成彻底断网。** 持久 API 监督器负责 worker 恢复，浏览器只有
  在故障持续存在时才进入离线模式；配额、通知、备份和日志写入也不会再让工作区流重启。
  如果 AI 服务在读取响应正文时突然断开连接，系统会把它视为暂时不可用并走原有的有界
  重试，而不是让整批 Discover 调研直接失败。
- **Node 24 上的 Interview Prep 取消边界已经写死。** 运行环境自带的请求信号不会再把
  已完整接收的保存或 AI 请求误报成 HTTP 499；只有服务端准入层明确创建的 AI 取消信号
  才能停止问题生成、模拟追问、反馈或持久保存。
- **极限负载通过实测，而不是靠猜。** 最终类生产门禁服务 300 个登录用户、300 个 SSE
  和同一地址 300 个健康 WebSocket，读取/登录零容量重试，并完成 300 次写入与重启读回。
  最终耐久门禁完成 5,372/5,372 次自动保存、70/70 个大型流零重启、100/100 次重启
  读回，所有资源预留最终归零。

Full details / 完整记录:
[English changelog](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0/CHANGELOG.md)
·
[简体中文更新日志](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0/CHANGELOG.zh-CN.md)

## v0.1.0-beta.8

**Prerelease - Beta / 预发布版本。** Back up the complete workspace before
upgrading.

> **Upgrade path:** Beta.6 and Beta.7 installations can use the automatic
> update flow in Admin. Beta.5 and earlier installations must first complete
> the documented manual transition to Beta.6, then update to Beta.8.
>
> **升级路径：** Beta.6 与 Beta.7 可直接在管理后台使用自动更新。Beta.5 及更早
> 版本必须先按 Beta.6 Release 中的说明手动过渡到 Beta.6，再升级到 Beta.8。

### Highlights

- **The current release is personal-only.** Team navigation, upgrade surfaces,
  administration, runtime loading, dedicated tests, and public-export content
  are archived. Existing Team source and stored data are retained rather than
  deleted, so a future restoration can be reviewed as one explicit release.
- **Navigation recovers instead of becoming a white page.** Routes, workspace
  screens, dialogs, profile editors, the rich-text editor, and language packs
  now share one bounded lazy-module recovery path. Recognized stale chunk and
  network failures retry safely, and persistent failures retain a localized
  reload surface without exposing raw exceptions.
- **The editor opens reliably in Vite development.** The lazy Markdown source
  editor now normalizes `react-simple-code-editor`'s CommonJS/ESM wrapper at a
  single typed boundary, fixing the application, New application, and profile
  snippet paths that could otherwise pass a module object to React.
- **Concurrent API startup no longer races the upload vault.** Migration uses
  an atomic PID/token lock with live-owner waiting, terminated-owner cleanup,
  owner-checked release, and the existing journal/rollback guarantees.
- **The public homepage shows the real product.** Hand-built replicas have
  been replaced by actual Checklist, Correspondence, Funding, Timeline,
  Discover, and Profile screens. The tour preserves the previous successful
  image while the next source decodes and falls back to Checklist if an asset
  cannot load.
- **A complete responsive product gallery.** The release includes 288 sharp
  captures: six workflows across 12 languages, light and dark themes, and
  native 1600x900 desktop plus 390x844 phone layouts at DPR 2. The public
  English and Chinese READMEs use the same responsive image set. Environments
  without `matchMedia` safely retain the desktop capture.
- **Smaller downloads and safe differential updates.** High-quality WebP
  encoding preserves every DPR-2 capture while reducing the capture set from
  66.16 MB to 22.81 MB and the same-tree full update package by 25.6%.
  Compatible future updates can publish an exact-base file delta; the server
  reconstructs and validates a complete local package and falls back to the
  full asset on any mismatch or failure.

### 中文摘要

- **当前版本只提供个人版。** Team 导航、升级界面、管理后台、运行时加载、专属测试
  与公开导出内容均已归档。现有 Team 源码和已存数据保留而不删除，未来如需恢复，
  必须作为一次明确版本变更统一评审。
- **页面异常可恢复，不再直接白屏。** 路由、工作区页面、弹窗、个人资料
  编辑器、富文本编辑器和语言包共用一套有界懒加载恢复机制；可识别的旧资源或网络
  失败会安全重试，持续失败则保留本地化重新加载页面，不向界面暴露原始异常。
- **Vite 开发环境中的编辑器可稳定打开。** Markdown 源码编辑器仍按需加载，并在
  单一带类型边界处理 `react-simple-code-editor` 的 CommonJS/ESM 包装，修复打开
  申请、新建申请和新增资料片段时把模块对象传给 React 的问题。
- **多个 API 进程启动时不再争用上传保险库。** 迁移使用带 PID 与令牌的原子锁，
  等待存活所有者、清理已终止所有者，并保留原有迁移日志和回滚保障。
- **公开首页展示真实产品。** 手工产品替身已替换为真实 Checklist、通信、Funding、
  Timeline、Discover 和 Profile 界面；下一张截图完成解码前保留上一张成功图片，
  资源失败时回退到对应 Checklist 截图。
- **完整响应式产品图集。** 本版本包含 288 张清晰截图：6 个工作流 x 12 种语言 x
  亮色/暗色 x 桌面/手机。桌面为 1600x900、手机为真实 390x844 布局，均以 DPR 2
  采集；公开版中英文 README 使用同一套响应式图片。未提供 `matchMedia` 的环境会安全
  保留桌面截图。
- **下载更小，并为安全差异更新做好准备。** 高质量 WebP 编码保留全部 DPR 2 截图，
  截图集从 66.16 MB 降至 22.81 MB，同一源码树的完整更新包缩小 25.6%。后续兼容版本
  可发布仅含变化文件的精确基线差异包；服务端会重建并校验完整本地包，任何不匹配或
  失败都会回退到完整资产。

Full details / 完整记录:
[English changelog](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0-beta.8/CHANGELOG.md)
·
[简体中文更新日志](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0-beta.8/CHANGELOG.zh-CN.md)

## v0.1.0-beta.7

**Prerelease — Beta / 预发布版本。** Back up the complete workspace before
upgrading.

> **Upgrade path:** Beta.6 installations can use the automatic update flow in
> Admin. Beta.5 and earlier installations must first complete the documented
> manual transition to Beta.6, then update to Beta.7.
>
> **升级路径：** Beta.6 可直接在管理后台使用自动更新。Beta.5 及更早版本必须先按
> Beta.6 Release 中的说明手动过渡到 Beta.6，再升级到 Beta.7。

### Highlights

- **Durable correspondence from draft to delivery.** Immediate and scheduled
  email now share one persisted outbox, stable delivery identity, crash
  recovery, attachment-vault references, startup retry, and exact sent-time
  ownership. System mail, mailbox sync, notifications, digests, and browser
  push use the same durable, non-overlapping background-work discipline.
- **Rich email that arrives as composed.** The shared editor supports safe
  Markdown and HTML, GFM structures, syntax highlighting, formatting, and
  context-aware source completion. Authored mail is sanitized once, stored as
  immutable HTML plus plain text, and reused unchanged for immediate,
  scheduled, and retried SMTP delivery.
- **AI drafting with bounded file authority.** Draft source switches authorize
  encrypted-vault context without exposing file handles to the browser. The
  model can return only server-issued readable attachment ids and safe
  recipient-facing filenames; its exact plan remains editable before sending.
- **Evidence-gated application research.** Existing-application enrichment is
  now AI-key-required and verifies every proposed fact against a URL fetched
  locally in the same run. Discover adds a six-domain professional taxonomy,
  OpenAlex Topic validation, affiliation-checked Crossref and discipline-routed
  Europe PMC leads while preserving official university pages as the saved-fact
  boundary.
- **Stronger application and Team workflows.** Automatic application saving,
  conflict-aware offline recovery, role-default Team permissions with sparse
  overrides, bulk invitation validation, smart tables, board/table state
  retention, mobile student drill-down, and one-step checklist sorting reduce
  manual recovery and repeated work.
- **A more complete self-hosted product surface.** The signed-out product demo,
  Dossier tabs, Correspondence, Funding, Timeline, Profile, Settings, Team, and
  mobile navigation now share the same responsive information hierarchy,
  compact controls, keyboard behavior, dark tokens, and reduced-motion paths.
- **225 curated school marks.** The built-in catalog contains distinct,
  provenance-backed PNG identities and directly covers 119 of the 145 bundled
  Discover school adapters before any bounded website fallback is needed.

### Security and reliability

- Added DNS-pinned outbound HTTPS policy, exact production Host validation,
  bounded upload/container parsing, imported-mail threat analysis, safe request
  logging, password-verifier limits, and a documented cross-surface threat
  model.
- Replaced component-local outage handling with one application-wide API
  circuit and coordinated server drain for health WebSockets, realtime SSE,
  push work, and recurring jobs. Stale responses can no longer reopen a
  recovered or retiring connection generation.
- Expanded release and source audits while retaining zero high-severity npm
  vulnerabilities, immutable version tags, deterministic update assets, public
  CI, MSSQL verification, and amd64/arm64 container gates.

### 中文摘要

- **邮件从草稿到投递全程持久化。** 立即发送与定时发送共用一个服务端 outbox，
  保留稳定投递标识、附件保险库引用、崩溃恢复、启动重试和权威发送时间；系统邮件、
  邮箱同步、通知、摘要和浏览器推送也使用不重叠的持久后台任务。
- **富文本邮件按编辑结果送达。** 共享编辑器支持安全 Markdown/HTML、GFM 结构、
  语法高亮、格式化和上下文源码补全。邮件在入队前只清理一次，随后以不可变 HTML
  和纯文本快照用于立即、定时及重试投递。
- **AI 附件权限有明确边界。** 来源开关只授权读取已保存的加密材料；模型只能选择
  服务端签发且当前可读的文件 ID，并返回经过扩展名和路径清理的收件人文件名。
  用户发送前仍可重命名或删除附件。
- **申请调研必须有本地核验的证据。** 现有申请增强改为必须配置 AI 密钥，任何建议
  只有在同一次运行中由服务端实际抓取并验证其精确 URL 后才能进入审核。Discover
  新增六大领域专业分类、OpenAlex Topic 校验、带机构核验的 Crossref 和按学科启用
  的 Europe PMC 线索，同时继续只把学校官方页面作为可保存事实边界。
- **申请与 Team 流程更可靠。** 新增自动保存、冲突感知离线恢复、角色默认权限与
  稀疏个人覆盖、批量邀请校验、智能表格、保留状态的看板/表格切换、移动端学生
  钻取和清单拖拽排序，减少手动恢复和重复操作。
- **公开自托管体验更完整。** 未登录产品演示、Dossier 各页、通信、Funding、
  Timeline、Profile、Settings、Team 与移动导航统一为同一套响应式信息层级、
  紧凑控件、键盘路径、暗色令牌和减少动态效果路径。
- **内置 225 个学校标识。** 目录中的 PNG 内容互不重复且保留来源与许可信息，
  在网站回退前可直接覆盖 145 个 Discover 学校适配器中的 119 个。
- **安全与可恢复性增强。** 新增 DNS 固定的出站 HTTPS、严格 Host 校验、上传格式
  边界、来信威胁分析、安全请求日志、密码校验资源上限和完整威胁模型；全局 API
  熔断与协调停机也避免旧响应或长连接干扰恢复。

Full details / 完整记录:
[English changelog](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0-beta.7/CHANGELOG.md)
·
[简体中文更新日志](https://github.com/zhoujasper/phd-atlas/blob/v0.1.0-beta.7/CHANGELOG.zh-CN.md)

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
