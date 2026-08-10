# Authorization and permission model

## Scope version 2

Request only these finite scopes:

| Scope | Permitted resource action |
| --- | --- |
| `applications:read` | Read accessible application records, checklists, timelines, deadlines, and related metadata. |
| `applications:write` | Create and update accessible application records and their nested workflow data. |
| `profile:read` | Read personal profile assets and reusable profile data. |
| `profile:write` | Create and update accessible profile assets and reusable profile data. |
| `files:read` | Read, download, or reference accessible stored files through advertised business routes. |
| `files:write` | Upload, rename, or remove accessible files through advertised business routes. |
| `communications:read` | Read accessible communications and drafts. |
| `communications:send` | Create drafts and send or schedule communications where the server permits. |
| `discover:read` | Read accessible discovery, research, intake, and ranking data. |
| `discover:write` | Change accessible discovery notes, decisions, and supported research data. |
| `notifications:read` | Read accessible notifications and notification state. |
| `notifications:write` | Change supported notification state and preferences. |
| `settings:read` | Read basic user settings exposed to Codex. |
| `settings:write` | Change basic user preferences; exclude mail credentials and synchronization. |
| `ai:read` | List the user's AI provider metadata without secrets. |
| `ai:use` | Use authorized AI drafting, research, and confirmed mail-classification operations. |
| `ai:manage` | Create, change, delete, or test the user's own AI provider configuration and secrets. |
| `exports:read` | Generate or download supported exports. |
| `backups:manage` | Create, inspect, restore, or remove supported user backups. |
| `analytics:read` | Read accessible dashboard and workspace analytics. |
| `shares:manage` | Create, update, inspect, or revoke supported shares. |
| `mail:manage` | Manage SMTP/IMAP, receive-email, and mail synchronization settings. |
| `interview:read` | Read the selected account's personal Interview Prep workspace. |
| `interview:write` | Save the selected account's personal Interview Prep workspace and workflow edits. |
| `interview:use` | Run Interview Prep AI question, mock-turn, and feedback operations with an eligible AI provider. |

Treat `scopeVersion: 2` as numeric. Reject wildcard, `all`, `full-access`, or invented scope names.

Never grant or seek MCP scopes for authentication internals, passkeys, passwords, account deletion, impersonation, administrator functions, setup, Team, or system maintenance. Scope version 2 exposes only the finite Interview Prep routes advertised by `GET /api/codex/capabilities`. Browser `/api/workspace/bootstrap...` aggregation is likewise denied; use focused advertised resources.

## Least privilege and upgrades

- Request a subset when the user's intended workflow is narrower than the complete set.
- Show every requested scope in the browser approval screen.
- Let the server reduce scopes or expiry.
- Treat the credential's returned `grantedScopes` as authoritative.
- Require a new authorization when additional scopes are needed.
- Never let an existing authorization inherit scopes introduced by a later scope version.

## Capability manifest

Read `GET /api/codex/capabilities` before business API calls. Require:

```json
{
  "schemaVersion": 2,
  "scopeVersion": 2,
  "credential": {
    "id": "…",
    "name": "…",
    "grantedScopes": ["applications:read"],
    "createdAt": "…",
    "lastUsedAt": "…",
    "expiresAt": "…"
  },
  "routePrefixes": [
    {
      "prefix": "/api/example",
      "methods": ["GET"],
      "requiredScopes": ["applications:read"],
      "conditionalRequiredScopes": []
    },
    {
      "prefix": "/api/applications/:applicationId/communications/send",
      "methods": ["POST"],
      "requiredScopes": ["applications:read", "communications:send"],
      "conditionalRequiredScopes": [
        {
          "source": "json-body",
          "path": ["attachments", "*", "fileId"],
          "operator": "non-empty-string",
          "requiredScopes": ["files:read"]
        }
      ]
    }
  ],
  "deniedPrefixes": []
}
```

Match path prefixes on segment boundaries and match the exact HTTP method. Treat parameterized `deniedPrefixes` as segment templates and reject them before considering broader advertised entries. Evaluate every `conditionalRequiredScopes` rule against the logical JSON body before sending the business request. For multipart calls, `json-body` means the JSON object carried in the single `payload` form field; malformed or duplicate payload fields cannot bypass the check. A conditional scope does not have to be granted for the route to appear because the route may remain usable when the condition is false. If the condition is true and a listed scope is absent, stop before the business request and ask the user to authorize that scope.

Fail closed when the manifest is absent, malformed, uses the old schema, has a non-canonical prefix or unsupported condition source/operator/path, or does not advertise the route. If more than one entry with the same maximum path-segment specificity matches a method and path, combine all of their unconditional and conditional requirements; never let ordering, a longer parameter name, or a duplicate entry hide a condition. The server remains authoritative and may still apply resource- and content-specific checks beyond the manifest.

## Personal workspaces

Operate only resources returned to the authenticated account. Do not add owner ids from another account or infer broader access from a missing owner field. Let the server establish ownership on creates.

Team routes and application Team-transfer/visibility routes are always listed in `deniedPrefixes` and rejected by the server. Do not attempt them through a broader application/profile prefix or a generic API fallback.

## Confirmation boundary

Ask for confirmation when an operation can delete data, contact another person, change access, expose data, send selected mail content to an external AI provider, consume AI-provider quota, change credentials, restore/replace state, or revoke authorization. Normal requested field edits still require read-before-write but need no redundant confirmation when account, target, value, and impact are already clear.
