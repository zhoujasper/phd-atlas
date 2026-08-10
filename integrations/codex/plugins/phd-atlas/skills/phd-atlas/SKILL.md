---
name: phd-atlas
description: Securely operate one or more PhD Atlas accounts from Codex or Claude Desktop through revocable device authorizations and account-scoped API capabilities. Use when the user asks to sign in, switch or sign out of PhD Atlas accounts; or inspect or change personal applications, checklists, timelines, deadlines, profiles, files, communications, discovery records, notifications, settings, exports, backups, or analytics.
---

# PhD Atlas

Operate PhD Atlas through the bundled MCP tools when available. Otherwise run `node scripts/phd-atlas-cli.mjs` from this skill directory. Keep credentials inside the CLI-managed private config; never read, print, paste, return, or request an access token.

## Choose the execution surface

1. Prefer the `phd_atlas_*` MCP tools when the plugin is installed.
2. Use the bundled CLI when only this standalone skill is installed.
3. Run `node scripts/phd-atlas-cli.mjs --help` for exact CLI syntax.
4. Run `node scripts/phd-atlas-cli.mjs doctor` when setup or connectivity is uncertain.
5. Read [setup.md](references/setup.md) for installation, login, configuration paths, and troubleshooting.

## Follow the safe workflow

Apply this sequence to every task:

1. Resolve the account. Call `phd_atlas_accounts_list` or `accounts list`. Every account-bound MCP tool call, read or write, must explicitly pass the returned stable `acct_...` id, even when only one account is configured. Never use the active account, a label, or an email as an MCP target.
2. Work only in the selected account's personal workspace. Team is archived and is outside this integration's capability boundary.
3. Resolve the exact target by stable server id.
4. Call status and capabilities. Treat the returned route manifest and scopes as authoritative.
5. Read the collection or resource immediately before changing it.
6. Compare the current state with the requested result. Preserve fields the user did not ask to change, including fields not described in the current reference.
7. Ask for confirmation immediately before a dangerous operation.
8. Perform the smallest supported write.
9. Read the canonical resource again after success or any ambiguous failure.
10. Report the selected account, workspace, target, changed fields, and resulting state without exposing secrets.

Do not infer an id from a display name when multiple matches exist. Ask the user to choose.

## Manage accounts

Start device login with `phd_atlas_login_start` or:

```text
node scripts/phd-atlas-cli.mjs login start --server https://atlas.example.edu --name "Work"
```

The client opens the returned same-origin verification URL in the user's browser when the platform supports it; if opening fails, show the URL and user code as a fallback. In production the verification page must use the selected PhD Atlas server origin. A deliberately separate HTTPS frontend must be explicitly trusted by the MCP process through comma-separated, exact origins in `PHD_ATLAS_VERIFICATION_ORIGINS`; HTTP remains limited to loopback development and the variable never permits non-loopback HTTP. Let the user sign in and approve the displayed finite scopes in PhD Atlas, then return to the requesting client. Finish after approval:

```text
node scripts/phd-atlas-cli.mjs login finish LOGIN_ID
```

Use `--wait` only when the user wants Codex to poll. Respect pending, slow-down, denial, and expiry responses. Never accelerate polling below the server interval or five seconds.

This application device flow is not MCP transport OAuth. Do not run `codex mcp login phd-atlas`; use `phd_atlas_login_start` and `phd_atlas_login_finish`, or the matching bundled CLI commands above.

List and switch accounts with `accounts list` and `accounts use ACCOUNT`. `accounts use`/`phd_atlas_account_use` changes only the standalone CLI convenience default; it never supplies or authorizes the account for another MCP tool call. Every account-bound MCP call must carry the exact `acct_...` id returned by `phd_atlas_accounts_list`. For a one-off CLI command, prefer `--account acct_...` without changing the convenience default.

For logout, state whether the authorization will be revoked remotely. Prefer ordinary logout, which revokes remotely before deleting locally. Use `--local-only` only when the user explicitly wants to remove the local credential without revoking the server authorization or the server cannot be reached. Require confirmation before either form.

## Connect self-hosted deployments

`--server` accepts one path-free HTTP(S) origin per login, including an explicit port, for example `https://atlas.example.edu:8443`. It does not accept a base URL with a path such as `https://example.edu/phd-atlas`. Each authorization remains bound to its own origin, so the account store may safely contain accounts from multiple self-hosted deployments at once.

Production non-loopback origins must use HTTPS. Plain HTTP is allowed only for loopback development. For a private CA, set `NODE_EXTRA_CA_CERTS` to an absolute PEM CA file in the environment that starts the MCP/CLI process, then restart Codex. Never set or recommend `NODE_TLS_REJECT_UNAUTHORIZED=0`.

The API reverse proxy must serve `/api/...` directly on the selected server origin. Do not redirect API requests for HTTP-to-HTTPS upgrades, a prefixed base path, a canonical host, or a trailing slash: the client refuses every API redirect because the redirected route has not passed its capability and deny-list checks. Configure the final HTTPS origin in `--server` from the start.

If the browser frontend uses another origin, keep the API on the selected server origin and allow only the exact HTTPS verification frontend through comma-separated `PHD_ATLAS_VERIFICATION_ORIGINS` as described above. This exception applies only to the device verification page, never to API requests.

## Read data

Call status, then capabilities. Prefer the purpose-built `phd_atlas_*` workflow tool for the requested business operation. Use `phd_atlas_api` only as an advanced fallback when no purpose-built tool covers a route that the selected credential's live capability manifest advertises. The standalone CLI equivalent is:

```text
node scripts/phd-atlas-cli.mjs api GET /api/<advertised-business-path> --account ACCOUNT
```

Use repeated `--query key=value` flags for filters. Use `references/api-reference.md` to choose a functional category, then rely on the live capability manifest for actual route prefixes and methods.

Summarize large results instead of flattening every record. Preserve stable ids in working notes so later writes target the same resource.

## Change data

Use POST to create, PATCH for a partial update, PUT only when the endpoint defines full replacement, and DELETE only after confirmation. Pass JSON with `--data` or `--data-file`. Before every full-resource PUT, GET the canonical resource, change only requested fields in that complete payload, preserve unknown fields, and re-read after the write to avoid silent concurrent-field loss.

Application create and replacement routes return a compact `phd-atlas-application-mutation-ack-v2` durable acknowledgement, not an Application object. The purpose-built create tool validates the protocol, submitted-input and baseline commitments, uses the acknowledged stable id for one focused GET, then verifies the canonical authored-content digest, personal ownership receipt, and submitted fields before it returns an Application. A 2xx response or `durable=true` by itself is never proof that user-visible fields were saved. When the generic API fallback is used, treat the write body only as a receipt, perform a focused canonical GET, and compare every requested field before reporting success. On any mismatch, report `WRITE_NOT_ACKNOWLEDGED`; never present the acknowledgement as an Application and never retry a create blindly.

Settings PATCH calls automatically negotiate `phd-atlas-settings-ack-v1`. Report success only after the CLI validates the exact mutation id, selected user, durability and settings version, every submitted non-secret field, and exactly the requested SMTP/IMAP secret receipts. Treat `SETTINGS_WRITE_NOT_ACKNOWLEDGED` as an ambiguous write and inspect the canonical settings before any retry.

Use `phd_atlas_communications` action `categorize` for manual categories and `classify` for AI classification. Both require one stable `idempotency_key`; classification also requires explicit confirmation. Never put `mailCategoryOverride` or `mailClassification` into create/update or a full application replacement: those fields are server-owned and the dedicated routes own their scopes and acknowledgements.

Never put SMTP/IMAP passwords, AI provider keys, or other secrets in `--data`; process arguments are visible to other local tooling. Prefer MCP in-memory data. For standalone CLI use, have the user supply JSON on standard input with `--data-file -`. The CLI rejects protected fields and AI-key writes from `--data` or a named data file. Never echo the secret or read it back after submission.

Treat a normal, clearly requested application/profile/checklist edit as authorization to make that scoped change after the required read. Ask a new question only when the account, target, desired value, or material impact remains ambiguous.

Require explicit confirmation for:

- deleting, bulk-changing, restoring, replacing, or permanently exporting data;
- sending or scheduling external communications;
- creating, changing, or revoking shares;
- reading an upload/attachment from, or writing a download/export to, the local filesystem through MCP;
- managing backups or replacing an existing downloaded file through the standalone CLI;
- changing mail credentials/synchronization or AI provider secrets;
- sending selected email content to an external AI provider for classification;
- revoking an authorization or removing a local credential.

Name the account, workspace, target, action, and irreversible or external effect in the confirmation. Set `confirm=true` in MCP, or `--confirm` in the CLI, only after the user confirms.

Keep share collection and ordinary results token-free. Reveal a newly created share URL only when the user explicitly asks to receive that link and separately confirms the exact share creation. Then set MCP `revealCreatedLink=true` or CLI `--reveal-created-link` together with confirmation. This exception works only for a dedicated share POST whose live capability requires `shares:manage`; token fields remain redacted. Show `oneTimeCreatedLink` once and never include it in a summary, log, saved note, another account's operation, or a later response.

## Transfer files

Upload only a regular, non-symlink local file with `phd_atlas_file_transfer`, `phd_atlas_upload`, or `upload`. Use only a capability-advertised multipart endpoint. Every MCP operation that reads a local upload or attachment must receive `confirm=true` after the user confirms the selected account, resource, and exact local file.

Download with `phd_atlas_file_transfer`, `phd_atlas_download`, or `download --output FILE`. Every MCP operation that writes a local download/export must receive `confirm=true`, even for a new output. MCP never overwrites an existing local path, even if a caller supplies `force`; choose a new path instead. Only the standalone CLI may replace an existing output, and only with both `--force` and `--confirm` after explicit user confirmation.

Every MCP local-file upload, attachment, download, or export is limited to 128 MiB (134,217,728 bytes). Do not split or reroute a larger transfer to evade the limit.

MCP local paths are accepted only beneath canonical trusted transfer roots. With no override, these are the current user's `Downloads`, `Documents`, and `Desktop` directories when they exist. To use narrower or different roots, set `PHD_ATLAS_TRANSFER_ROOTS` to absolute directories before starting Codex, separated by `;` on Windows or `:` on macOS/Linux, then restart Codex. Supplying the variable replaces the defaults; never add a repository root, credential directory, whole home directory, or shared untrusted tree merely to make a transfer succeed.

Do not use generic API calls for binary responses; use the download command so time and size limits cover the full body.

## Handle failures

- On 401, stop. If the server returns `CODEX_AUTHORIZATION_REAUTHORIZATION_REQUIRED`, tell the user to start a new device authorization because the scope policy changed. Never request a token in chat.
- On 403, report the missing permission or scope. Do not use impersonation or another credential unless the user selects that account.
- On 404, re-read the parent collection and resolve the target again.
- On 409 or 412, re-read the canonical resource, compare concurrent changes, and ask before overwriting conflicting fields.
- On 429, honor `retryAfterSeconds`; never busy-loop.
- On timeout or 5xx after a write, assume the result is unknown. Re-read before retrying.
- On validation errors, correct only the rejected fields and preserve the resident draft.

Always perform the post-failure re-read before a retry that could duplicate a create, send, upload, or destructive action.

## Enforce hard boundaries

Never call `/api/auth/impersonate` or any impersonation route.

Never use generic API access for auth, admin, setup, PhD Atlas account/access credentials, public share tokens, raw asset-upload tokens, Team routes, calendar feed tokens, passkeys, passwords, MCP authorization-management endpoints, or browser workspace bootstrap/stream routes. Use only the dedicated login, status, capabilities, and logout tools for authorization lifecycle operations. Manage a user's own AI provider key only through a capability-advertised ai-manage business route and the protected input workflow above. Interview Prep is available only on capability-advertised routes when the authorization includes the matching interview scopes; never approximate it through application PUT, AI draft, or another user's workspace.

Allow capability-advertised Codex business endpoints such as semantic profile-recommender or safe-settings routes, but keep device/login/authorization lifecycle endpoints on their dedicated tools.

Never invent or request wildcard scopes. Use only finite scope version 2. Treat future scope versions as unsupported until this skill is updated. Existing scope-v1 authorizations must be reauthorized and never gain newly introduced scopes automatically.

Never bypass a server denial, edit the credential config manually, put tokens in environment variables or command arguments, follow any API redirect, or send a credential to a different origin. `PHD_ATLAS_VERIFICATION_ORIGINS` is an exact HTTPS-origin trust list for an intentionally separate authorization frontend, not an API redirect or wildcard bypass.

## Load references selectively

- Read [setup.md](references/setup.md) for installation, standalone use, login, config locations, and diagnostics.
- Read [permissions.md](references/permissions.md) for scope v2 and personal-workspace authorization rules.
- Read [api-reference.md](references/api-reference.md) for operation categories, generic CLI/MCP shapes, and route-discovery rules.
