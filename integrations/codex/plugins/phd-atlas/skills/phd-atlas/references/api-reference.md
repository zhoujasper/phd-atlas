# API operation reference

## Discover routes at runtime

Treat `GET /api/codex/capabilities` as the route inventory for the selected credential. Use its `routePrefixes`, methods, unconditional `requiredScopes`, and body-dependent `conditionalRequiredScopes`. Evaluate conditional rules against the logical JSON body before the business request; for multipart upload calls, parse the single `payload` form field first. Refuse old manifests, malformed or non-canonical prefixes, and malformed/duplicate multipart payloads when a condition must be evaluated. Combine every matching entry at the maximum path-segment specificity so duplicate entries or longer parameter names cannot shadow a condition. Do not guess a path from the web UI or this document.

The generic API command accepts only safe relative `/api/...` paths advertised by that manifest:

```text
node scripts/phd-atlas-cli.mjs api GET /api/<advertised-prefix>/<id>
node scripts/phd-atlas-cli.mjs api PATCH /api/<advertised-prefix>/<id> --data '{"field":"value"}'
```

Use `--confirm` only after explicit confirmation when the CLI identifies a high-impact operation. Use `upload` and `download` for binary bodies.

## Known dedicated lifecycle endpoints

Use these only through the dedicated CLI/MCP commands:

| Method and path | Purpose |
| --- | --- |
| `POST /api/codex/device-authorizations` | Start device authorization with snake_case request fields. |
| `POST /api/codex/device-authorizations/token` | Poll/exchange an approved device code exactly once. |
| `GET /api/codex/whoami` | Read the current user and credential identity. |
| `GET /api/codex/capabilities` | Read scope version and allowed business route prefixes. |
| `DELETE /api/codex/authorizations/current` | Revoke the current long-lived credential. |

Never send these routes through the generic API tool.

## Stable identifiers

Use ids returned by a fresh read:

- Use applicationId for /api/applications/:id.
- Use fileId, taskId, assetId, communicationId, notification id, and backup fileName only in their matching route.

Never supply `ownerId`, `teamId`, or `visibleToTeam` to the MCP application-create tool. The server establishes the selected account's personal ownership.

## Applications, deadlines, timelines, and tasks

| Operation | Method and path | Typical minimum body |
| --- | --- | --- |
| List accessible personal applications | GET /api/applications | none |
| Create a personal application | POST /api/applications | {"professor":"Dr Ada","professorEmail":"ada@example.edu","university":"Example University","program":"PhD Computer Science","deadline":"2027-01-15"} |
| Read one canonical application | GET /api/applications/:applicationId | none |
| Replace one complete application | PUT /api/applications/:applicationId | the complete safe ApplicationSchema returned by the immediately preceding GET, with only requested fields changed |
| Move to trash | DELETE /api/applications/:applicationId | none; confirm first |
| List trash | GET /api/applications/trash | none |
| Restore | POST /api/applications/trash/:trashId/restore | none; confirm first |
| Create a task | POST /api/applications/:applicationId/tasks | {"title":"Submit transcript","due":"2027-01-02"} |
| Patch a task | PATCH /api/applications/:applicationId/tasks/:taskId | {"done":true,"status":"Completed"} |

`POST /api/applications` and the guarded application replacement routes return a compact `phd-atlas-application-mutation-ack-v2` receipt rather than the Application resource. The receipt is useful only when `durable` is true and its purpose, submitted-input commitment, baseline commitment, canonical commitment, and resulting hashes validate. The dedicated `phd_atlas_application_create` tool performs those checks, follows the receipt's stable `id` with one focused `GET /api/applications/:applicationId`, and verifies the returned version, authored-content digest, personal ownership receipt, and submitted fields before returning the canonical Application. Generic API callers must likewise treat the write response as a receipt, not a resource, and read/compare the canonical record before reporting success. Never infer success from HTTP 2xx alone, never pass an acknowledgement to code expecting an Application, and never retry a create after an acknowledgement/read-back mismatch without first listing or reading the possible result.

Application writers use only the current authored projection: send
`X-PhD-Application-Acknowledgement: v2` together with
`X-PhD-Application-Projection-Version: 2`. Projection v1 is not negotiated;
reload or upgrade the client before retrying an unsupported write.

Treat PUT as a complete replacement across deadline, status, notes, professor, school, dossier cards, recommenders, materials, communications, scholarships, fees, tasks, timeline, versions, and backup settings. Communications are present only with `communications:read`, and a full PUT may change them only when the credential also has `communications:send`. Follow this exact pattern:

1. GET /api/applications/:applicationId.
2. Take only the response data object, not the CLI status wrapper.
3. Preserve every unknown field and every stable id.
4. Change only the requested deadline, status, note, or timeline fields.
5. PUT that complete safe object back once.
6. GET again and compare.

There is currently no independent deadline PATCH or timeline PATCH route. Update deadline or timeline through the guarded full PUT. Never construct a partial PUT. Never return or send share/capability tokens as part of that payload. Shares and review comments are server-owned and are preserved by the guarded PUT; use their dedicated routes instead.

Additional capability-advertised application subresources:

| Operation | Method and path | Guard |
| --- | --- | --- |
| Create a material row | POST /api/applications/:applicationId/materials | Requires both application write and file write because this multipart route can carry a file; read first and use the live schema. |
| Attach a material file | POST /api/applications/:applicationId/materials/:materialId/file | Use upload; resolve both ids first. |
| Rename a material file | PATCH /api/applications/:applicationId/materials/:materialId/files/:fileId | Read the material/file first; send only advertised rename fields. |
| Remove a material file | DELETE /api/applications/:applicationId/materials/:materialId/files/:fileId | Confirm the exact file. |
| Create an application fee | POST /api/applications/:applicationId/fees | Read existing fees; use the advertised fee schema. |
| Change/remove a fee | PATCH or DELETE /api/applications/:applicationId/fees/:feeId | Read first; confirm delete. |
| Create a scholarship | POST /api/applications/:applicationId/scholarships | Read existing scholarships; use the advertised schema. |
| Resolve a school logo | POST /api/applications/:applicationId/school-logo/resolve | Read school identity first; do not guess a different institution. |
| Patch a school logo | PATCH /api/applications/:applicationId/school-logo | Preserve the resolved school identity. |

These routes are discoverability hints, not authorization. If the live manifest omits a method/path, stop instead of falling back to a full PUT or a UI-only route.

## Profiles and recommenders

| Operation | Method and path | Typical minimum body |
| --- | --- | --- |
| List personal profile assets | GET /api/profile-assets | none |
| List personal recommender directory page | GET /api/profile/recommenders?cursor=&limit=50 | none |
| Load one recommender detail | GET /api/profile/recommenders/:recommenderId | none |
| Create an asset | POST /api/profile-assets | {"name":"Research statement","kind":"Research Statement","description":"","notes":""} |
| Patch an asset | PATCH /api/profile-assets/:assetId | {"notes":"Use for 2027 applications"} |
| Delete an asset | DELETE /api/profile-assets/:assetId | none; confirm first |
| List recommenders | GET /api/codex/profile-recommenders | none |
| Create a recommender | POST /api/codex/profile-recommenders | {"name":"Professor Example","email":"professor@example.edu"} |
| Patch a recommender | PATCH /api/codex/profile-recommenders/:recommenderId | {"institution":"Example University"} |
| Delete a recommender | DELETE /api/codex/profile-recommenders/:recommenderId | none; confirm first |
| Resolve an application recommender identity | POST /api/applications/:applicationId/recommenders/:recommenderId/resolve | `recommender`, `decision`, `expectedApplicationUpdatedAt`, and the selected profile version when present |

Prefer the semantic recommender routes. Listing requires `profile:read`; create, patch, and delete require `profile:write` and avoid replacing an entire settings array. Without `profile:read`, a successful create/patch returns only the shared-identity/version write receipt and never reveals saved title, institution, relationship, or notes.

Atomic application recommender resolution requires `applications:write` and `profile:write`. `applications:read` controls whether full target/sibling recommender slices are returned, while `profile:read` controls whether the complete directory is returned. Without those read scopes the response is deliberately reduced to the submitted row and a shared-identity/version profile receipt. Treat `directoryRevision` and each compact `{id,updatedAt,recommenders}` application slice as acknowledgements, not as complete Application resources.

If an older deployment does not advertise these routes, report that a server upgrade is required; do not fall back to blind PATCH /api/settings with a complete profileRecommenders array or to a generic application PUT that changes recommender identity.

## Files, shares, and exports

| Operation | Method and path | Tool/body |
| --- | --- | --- |
| Upload profile files | POST /api/profile-assets/:assetId/files | upload tool, field file |
| Upload task files | POST /api/applications/:applicationId/tasks/:taskId/file | upload tool, field file |
| Download an accessible file | GET /api/files/:fileId/download | download tool; access is rechecked against the selected personal account |
| Export a profile asset | GET /api/profile-assets/:assetId/export?format=pdf | download tool; format may be pdf or word |
| Export applications | GET /api/exports?format=pdf&applicationId=:applicationId | download tool; format may be json, csv, excel, or pdf |
| Create an application share | POST /api/applications/:applicationId/share | {"permission":"view","expiresAt":null}; confirm first; reveal only with the separate one-time flag below |
| Update/revoke a share | PATCH or DELETE /api/applications/:applicationId/share/:shareId | advertised share fields; confirm first |

Do not call public /api/share/:token or /api/asset-upload/:token routes. Collection and ordinary GET/PATCH results must never expose share tokens. Share creation remains redacted by default. Only when the user explicitly asks to receive the new link and confirms the exact creation may the caller add CLI `--reveal-created-link` or MCP `revealCreatedLink:true`. The CLI accepts that exception only for a dedicated POST create/rotate path whose live matched capability requires `shares:manage`; it still redacts the token field and emits one validated same-origin URL as `oneTimeCreatedLink`. Show it once, then never copy it into logs, summaries, saved notes, another account, or a later response. Treat a downloaded export as a user-owned file and do not read raw secret-bearing content back into the prompt.

## Communications

Read communications from the canonical application. Use:

| Operation | Method and path | Typical minimum body |
| --- | --- | --- |
| Save a draft/log | POST /api/applications/:applicationId/communications | {"subject":"Draft introduction","channel":"Email","date":"2026-08-02","summary":"Draft body","direction":"outgoing","messageType":"draft","to":"pi@example.edu"} |
| Patch a draft/log | PATCH /api/applications/:applicationId/communications/:communicationId | {"subject":"Revised subject"} |
| Set manual categories | PATCH /api/applications/:applicationId/communications/categories | `{"communicationIds":["communication_123"],"category":"interview_invite"}`; use one stable idempotency key; requires application write and communication read. |
| Classify with AI | POST /api/applications/:applicationId/communications/classify | `{"communicationIds":["communication_123"],"keyId":"key_123","force":false}`; use one stable idempotency key; requires application write, communication read, AI use, and explicit confirmation. |
| Send or schedule | POST /api/applications/:applicationId/communications/send | {"subject":"Introduction","summary":"Message body","date":"2026-08-02","to":"pi@example.edu","idempotencyKey":"stable-unique-key"} |

Prefer `phd_atlas_communications` actions `categorize` and `classify`. Both require `idempotency_key`; reuse the exact key only for an identical retry after an ambiguous timeout. `classify` also requires `confirm=true` after naming the account, application, selected emails, AI provider, provider-quota use, and external processing of mail content. The standalone CLI fallback must pass the same identity with `--idempotency-key KEY`, plus `--confirm` for classification. Re-read the canonical application and compare every returned classification/category delta before reporting success. Never set `mailCategoryOverride` through the generic communication PATCH or a full application replacement.

Confirm the exact recipient, subject, account, and send/schedule time immediately before send. Reuse the same idempotencyKey after an ambiguous timeout and re-read the application before retrying. Use upload with field files only when adding a local attachment to the send request. The live send capability declares `attachments[*].fileId` as a `json-body` conditional requirement for `files:read`; this applies equally to JSON calls and to the JSON `payload` of multipart calls. A new local attachment represented only by `uploadIndex` does not require `files:read` or `files:write` beyond the send capability. Never use sending as an alternate way to retrieve a file that the selected credential cannot download.

## Discover and AI

| Operation | Method and path | Typical body/query |
| --- | --- | --- |
| Read catalog/state/source evidence | GET /api/discover/catalog, /api/discover/state, or /api/discover/source-index | none |
| Update notes/intake/ranker | PUT /api/discover/state | {"programNotes":{"program_123":"Strong fit"}} |
| Start research | POST /api/discover/research/start | {"useAi":false} |
| Delete saved programs | POST /api/discover/programs/delete | Read the exact ids/state first; confirm the removal and use the advertised body. |
| Personal Discover import | POST /api/discover/import | {"programId":"program_123","piId":"pi_123","includeNotes":true} |
| List AI provider metadata | GET /api/ai/keys | none; secrets are never returned |
| Create an AI provider | POST /api/ai/keys | {"provider":"openai","label":"Primary","model":"model-name","apiKey":"secret"} |
| Change an AI provider | PATCH /api/ai/keys/:keyId | Read metadata first; use protected secret input for any replacement key; confirm. |
| Delete an AI provider | DELETE /api/ai/keys/:keyId | Re-read the exact provider; confirm. |
| Test an AI provider | POST /api/ai/keys/:keyId/test | Confirm the external provider call; never echo the key. |
| Use AI drafting | POST /api/ai/draft | {"keyId":"key_123","applicationId":"app_123","mode":"compose","instructions":"Draft a concise introduction","grants":{"dossier":true}} |

`/api/workspace/bootstrap` and `/api/workspace/bootstrap/stream` are explicitly unavailable to MCP clients. The workspace bootstrap endpoints aggregate independently scoped browser data and must never replace focused application, profile, or Discover reads.

Scope version 2 exposes the finite Interview Prep routes below through capabilities for the selected personal account:

| Operation | Route | Required scopes |
| --- | --- | --- |
| Read Interview Prep workspace | GET /api/interview-prep/workspace | `interview:read` |
| Save Interview Prep workspace | PUT /api/interview-prep/workspace | `interview:write` |
| Generate interview questions | POST /api/interview-prep/ai/questions | `interview:use`, `ai:use` |
| Generate a next mock-turn question | POST /api/interview-prep/ai/mock-turn | `interview:use`, `ai:use` |
| Generate mock feedback | POST /api/interview-prep/ai/feedback | `interview:use`, `ai:use` |

Do not approximate Interview Prep through application PUT, AI draft, or another user's workspace. Re-read the current workspace and preserve durable revisions before a write; AI operations must use the exact eligible `gpt-5.6-luna` key and should never be assumed durable until the server returns an acknowledged artifact.

Never put an AI provider key in --data because command arguments are process-visible. Prefer the MCP tool so data stays on local stdio, or have the user provide JSON through --data-file - on standard input. The CLI rejects AI-key routes and protected secret fields when they come from `--data` or a named data file. Never echo the secret after submission.

## Settings, mail, notifications, backups, and analytics

Read the Codex-safe projection with GET /api/codex/settings before a settings write. PATCH /api/settings only with advertised fields and scopes:

- Basic preferences: {"language":"en","highContrast":false} with settings write.
- Mail configuration: SMTP/IMAP/receive-email/sync fields with mail manage.
- AI profile settings: only advertised AI/profile fields with their mapped scope.
- Backup preferences: only advertised backup fields with backups manage.

Sensitive passwords are write-only. Never use --data for SMTP, IMAP, or AI secrets. Prefer MCP in-memory arguments or user-provided standard input with --data-file -. The CLI enforces this source boundary for protected input. Never read a secret back or infer that an omitted secret was cleared. Storage quota, session duration, account deletion, calendar-feed tokens, passwords/passkeys, and auth fields remain unavailable.

The CLI/MCP automatically negotiates `phd-atlas-settings-ack-v1` for every settings PATCH. It validates the protocol, unique mutation identity, durable flag, selected-account user id, positive settings version, every submitted non-secret canonical field, and exactly the requested SMTP/IMAP secret receipts before returning the `codex-safe-user` PublicUser projection. Missing, stale, malformed, or extra receipts fail closed as `SETTINGS_WRITE_NOT_ACKNOWLEDGED`; do not retry blindly after an ambiguous result. Older servers that return only PublicUser remain readable but cannot acknowledge a Codex settings write.

Other executable routes:

| Operation | Method and path | Typical body/query |
| --- | --- | --- |
| List notifications | GET /api/notifications | optional server-advertised filters |
| Mark read | POST /api/notifications/:notificationId/read | none |
| Mark unread | POST /api/notifications/:notificationId/unread | none |
| Archive | POST /api/notifications/:notificationId/archive | re-read notification first |
| Bulk notification update | POST /api/notifications/bulk | {"action":"mark_read","ids":["notification_1"]}; confirm first |
| Read analytics | GET /api/analytics | none |
| List backups | GET /api/backups?applicationId=:applicationId | none |
| Create backup | POST /api/backups | {"applicationId":"app_123"}; requires backup manage plus application read; confirm first |
| Restore backup | POST /api/backups/:fileName/restore | requires backup manage plus application write; confirm first |
| Delete backup | DELETE /api/backups/:fileName | none; confirm first |

Do not assume every deployment or credential exposes every route above. The live capability manifest wins. Report an upgrade requirement for a missing semantic route instead of guessing an alternate or broader endpoint.

## Generic MCP shape

```json
{
  "method": "PATCH",
  "path": "/api/<advertised-prefix>/<stable-id>",
  "data": {
    "field": "new value"
  },
  "query": {
    "include": "summary"
  },
  "account": "acct_…",
  "confirm": false,
  "revealCreatedLink": false
}
```

Leave `revealCreatedLink` false for every ordinary operation. It is not a general secret-output switch.

The tool fetches capabilities first, matches the method and path on a segment boundary, injects the selected credential internally, rejects every API redirect, and bounds the complete response.

## Upload shape

```json
{
  "path": "/api/<advertised-upload-prefix>",
  "file": "/absolute/local/file.pdf",
  "field": "file",
  "form": {
    "resourceId": "stable-id"
  },
  "account": "acct_…"
}
```

Upload a regular non-symlink file. Keep size limits enabled. Never upload credential configs, browser storage, cookies, or unrelated private files.

## Download shape

```json
{
  "path": "/api/<advertised-download-prefix>/<stable-id>",
  "output": "/absolute/local/export.pdf",
  "account": "acct_…",
  "force": false,
  "confirm": false
}
```

Create a new file by default. Set both `force` and `confirm` only after the user approves replacing the exact existing path.

## Failure envelopes

Expect:

```json
{"ok":true,"data":{}}
```

or:

```json
{"ok":false,"error":{"code":"ERROR_CODE","message":"Safe explanation"}}
```

Treat device polling specially. Its token endpoint uses an RFC-style HTTP 400 OAuth envelope such as `{"error":"authorization_pending","error_description":"…","interval":5}` rather than the business envelope above:

- `authorization_pending`: wait at least the current interval.
- `slow_down`: honor `Retry-After` when present, otherwise the returned interval, and increase the delay.
- `expired_token`: remove the pending login and restart.
- `access_denied`: remove the pending login and stop.
- `invalid_request` or `invalid_grant`: stop; never retry an exchanged or malformed device code.

For business writes, re-read after timeout, 409, 412, or 5xx before retrying.
