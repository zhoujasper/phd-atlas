# Setup and account lifecycle

## Requirements

- Install Node.js 20 or newer.
- Use HTTPS for remote PhD Atlas deployments. Use plain HTTP only for `localhost`, `127.0.0.0/8`, or `::1`.
- In production, serve the device verification page from the selected PhD Atlas server origin. If the frontend deliberately has a separate origin, configure that exact HTTPS origin as described under account connection; an allowlist does not permit non-loopback HTTP.
- Keep this entire skill directory together so `SKILL.md`, `scripts/`, and `references/` remain adjacent.

## Self-hosted deployments

Pass one path-free origin per login with `--server`, including a custom port when needed:

```text
node scripts/phd-atlas-cli.mjs login start --server https://atlas.example.edu:8443 --name "Lab"
```

Each stored account remains bound to its originating server, and one local configuration may hold accounts from multiple self-hosted deployments and ports. The server value may contain only scheme, host, and optional port. A path-prefixed base URL such as `https://example.edu/phd-atlas` is unsupported.

Production non-loopback servers must use HTTPS. For a private CA, set `NODE_EXTRA_CA_CERTS` to an absolute PEM CA file in the environment that launches Codex/MCP, then restart Codex. A standalone server can set it in `[mcp_servers.phd-atlas.env]` below. Never use `NODE_TLS_REJECT_UNAUTHORIZED=0`.

Configure the API reverse proxy to serve `/api/...` directly from the selected origin. Do not redirect API requests for HTTP-to-HTTPS, a canonical host, a path prefix, or a trailing slash. The client refuses every API redirect because the redirected route has not passed capability and deny-list checks; give `--server` the final HTTPS origin from the start.

For a deliberately separate browser frontend, keep API traffic on the server origin and allow only exact HTTPS verification-page origins in comma-separated `PHD_ATLAS_VERIFICATION_ORIGINS`. This setting never allows API redirects.

## Install the plugin

Prefer the published PhD Atlas Codex marketplace entry when available:

```text
codex plugin marketplace add <publisher-marketplace>
codex plugin add phd-atlas@<marketplace-name>
```

Start a new Codex task after install or update so Codex reloads the Skill and MCP server.

For a local marketplace checkout, point the marketplace at the plugin root containing `.codex-plugin/plugin.json`, `.mcp.json`, and `skills/phd-atlas`. Do not move only the MCP file; its command resolves the shared CLI relative to the plugin root.

The bundled server is named `phd-atlas`. It starts from the Plugin root with:

```text
node ./skills/phd-atlas/scripts/phd-atlas-cli.mjs mcp
```

The Plugin declaration uses a 15-second startup timeout and a 180-second tool timeout. It requires no package installation.

This declaration is a local stdio MCP server for Codex desktop, CLI, and IDE clients. ChatGPT web or public Plugin submission would require a separately deployed public HTTPS Streamable HTTP MCP endpoint; the stdio command is not a remote endpoint.

## Install in Claude Desktop

Open the published `phd-atlas-claude.mcpb` file with Claude Desktop and confirm
the extension installation. The MCPB contains `manifest.json`, the same local
stdio server, and the required Skill files. Install either this MCPB or another
registration of the server on the same client, not both.

### Plugin-scoped MCP policy

Use `codex plugin list` to find the exact installed Plugin id, including the marketplace suffix. The Plugin owns its transport command; user configuration should contain policy only:

```toml
[plugins."phd-atlas@<marketplace-name>".mcp_servers.phd-atlas]
enabled = true
default_tools_approval_mode = "writes"

[plugins."phd-atlas@<marketplace-name>".mcp_servers.phd-atlas.tools.phd_atlas_api]
approval_mode = "prompt"

[plugins."phd-atlas@<marketplace-name>".mcp_servers.phd-atlas.tools.phd_atlas_logout]
approval_mode = "prompt"
```

Do not duplicate the bundled command in `[mcp_servers]`. The server's live tool annotations drive `writes`; PhD Atlas authorization scopes remain authoritative.

Use the purpose-built `phd_atlas_*` workflow tools for normal operations. `phd_atlas_api` is an advanced fallback only when no purpose-built tool covers a business route advertised by the live capability manifest; it is never an authorization bypass.

## Install only the standalone MCP server

Extract the complete Plugin ZIP to a durable private directory and register the CLI using an absolute path. Choose this or Plugin installation, not both:

```text
codex mcp add phd-atlas -- node /absolute/path/phd-atlas/skills/phd-atlas/scripts/phd-atlas-cli.mjs mcp
```

Windows PowerShell accepts a quoted Windows path:

```powershell
codex mcp add phd-atlas -- node "C:\absolute\path\phd-atlas\skills\phd-atlas\scripts\phd-atlas-cli.mjs" mcp
```

Equivalent `~/.codex/config.toml` configuration:

```toml
[mcp_servers.phd-atlas]
command = "node"
args = ["/absolute/path/phd-atlas/skills/phd-atlas/scripts/phd-atlas-cli.mjs", "mcp"]
enabled = true
required = false
startup_timeout_sec = 15
tool_timeout_sec = 180
default_tools_approval_mode = "writes"
```

Use forward slashes for Windows paths in TOML. A trusted repository may use the same table in `.codex/config.toml` for project scope. MCP configuration never contains the PhD Atlas bearer token.

For a standalone server, optional non-secret process policy can be pinned in the same config:

```toml
[mcp_servers.phd-atlas.env]
PHD_ATLAS_TRANSFER_ROOTS = "/trusted/downloads:/trusted/documents"
PHD_ATLAS_VERIFICATION_ORIGINS = "https://accounts.example.edu"
NODE_EXTRA_CA_CERTS = "/absolute/path/private-ca.pem"
```

Use `;` between transfer roots on Windows and `:` on macOS/Linux. For the bundled Plugin, set these variables in the environment that starts Codex, then restart it; Plugin-scoped config controls enablement and approvals rather than duplicating its transport command.

After adding or changing MCP configuration, restart the Codex desktop app or IDE extension, or exit and reopen the CLI, then create a new task. Confirm discovery with:

```text
codex mcp list --json
codex mcp get phd-atlas --json
```

Use `/mcp` in the Codex TUI to inspect the live connection.

## Install only the standalone Skill

Use the public source folder:

```text
https://github.com/zhoujasper/phd-atlas/tree/main/integrations/codex/plugins/phd-atlas/skills/phd-atlas
```

Ask Codex to install that skill URL, or download/copy:

```text
integrations/codex/plugins/phd-atlas/skills/phd-atlas
```

Place it at:

- Windows: `%USERPROFILE%\.codex\skills\phd-atlas`
- macOS/Linux: `~/.codex/skills/phd-atlas`
- Custom Codex home: `$CODEX_HOME/skills/phd-atlas`

Restart Codex or start a new task. The standalone Skill uses:

```text
node scripts/phd-atlas-cli.mjs <command>
```

Run that command from the installed `phd-atlas` skill directory. Installing only the Skill does not register MCP tools; use the CLI workflow in `SKILL.md`.

## Connect an account

1. Start a device authorization:

   ```text
   node scripts/phd-atlas-cli.mjs login start --server https://atlas.example.edu --name "Primary"
   ```

2. Open only the returned verification URL. In production it must share the selected server origin. If an intentionally separate frontend is required, set `PHD_ATLAS_VERIFICATION_ORIGINS` in the Codex/MCP process to a comma-separated list of exact HTTPS origins such as `https://accounts.example.edu,https://accounts-backup.example.edu`, then restart Codex. Entries must be origins only—no path, query, fragment, credentials, or wildcard. HTTP is accepted only for loopback development even when the variable is set.
3. Sign in to PhD Atlas in the browser.
4. Review the authorization name, expiry, and every requested scope.
5. Approve or narrow the request.
6. Finish the exchange:

   ```text
   node scripts/phd-atlas-cli.mjs login finish LOGIN_ID
   ```

7. Verify:

   ```text
   node scripts/phd-atlas-cli.mjs whoami
   node scripts/phd-atlas-cli.mjs capabilities
   ```

Pass repeated `--scope` flags to request a least-privilege subset. Omit them to request the complete finite scope-v1 set. Choose `--expires-in-days 30`, `90`, `180`, or `365`; the default and maximum are 365 days. The approval preview shows the exact expiry, and the server remains authoritative.

PhD Atlas account authorization is an application-level device flow carried by the bundled tools. It is not MCP transport OAuth: do not run `codex mcp login phd-atlas`. Use `phd_atlas_login_start` and `phd_atlas_login_finish`, or the CLI commands in this section.

## Manage multiple accounts

```text
node scripts/phd-atlas-cli.mjs accounts list
node scripts/phd-atlas-cli.mjs accounts use ACCOUNT_ID
node scripts/phd-atlas-cli.mjs whoami --account OTHER_ACCOUNT_ID
```

Every account-bound MCP tool call, read or write, must explicitly pass the exact stable `acct_...` id returned by `phd_atlas_accounts_list`, even when only one account is configured. `phd_atlas_account_use`/`accounts use` changes only the standalone CLI convenience default and does not supply an account to another MCP call. For a one-off CLI command, prefer `--account acct_...`. Each credential remains bound to its original server origin.

## Sign out and revoke

Revoke remotely, then remove locally:

```text
node scripts/phd-atlas-cli.mjs logout --account ACCOUNT_ID --confirm
```

Remove only the local copy:

```text
node scripts/phd-atlas-cli.mjs logout --account ACCOUNT_ID --local-only --confirm
```

Use local-only removal intentionally. It leaves the authorization active in PhD Atlas Settings until the user revokes it there.
Both forms require confirmation. If remote revocation fails, the CLI keeps the local credential so the user can retry safely; it never silently falls back to local-only removal.

## Credential locations

The CLI selects an OS-native directory:

- Windows: `%APPDATA%\PhD Atlas\Codex\config.json`
- macOS: `~/Library/Application Support/PhD Atlas/Codex/config.json`
- Linux: `$XDG_CONFIG_HOME/phd-atlas/codex/config.json`, or `~/.config/phd-atlas/codex/config.json`

Set `PHD_ATLAS_CONFIG_DIR` only to an absolute directory for isolated testing or managed deployments. Do not share a config directory between users.

The CLI creates the directory privately, requests file mode 0600, writes through an exclusive lock, recovers stale locks, and atomically replaces the config. On Windows, Node requests private mode while Windows ACLs remain OS-managed.

Never open, print, edit, sync, or commit `config.json`. Use `accounts`, `whoami`, and `logout` instead.

## Local MCP transfer roots

Every MCP tool call that reads a local upload/attachment or writes a local download/export requires `confirm=true`, including creation of a new output file. MCP never overwrites an existing local path, even when `force` is supplied; choose a new output path. Only the standalone CLI may replace an existing output, using both `--force` and `--confirm` after explicit confirmation. The confirmation must identify the stable account, remote resource, and exact local path.

Each MCP local-file upload, attachment, download, or export is limited to 128 MiB (134,217,728 bytes). A larger file must be handled outside this integration rather than split or rerouted around the limit.

MCP accepts local paths only beneath canonical trusted roots. Without an override it uses the current user's existing `Downloads`, `Documents`, and `Desktop` directories. Override the complete list with absolute directories in `PHD_ATLAS_TRANSFER_ROOTS`:

```text
# Windows
PHD_ATLAS_TRANSFER_ROOTS=C:\Users\Alice\Downloads;D:\PhD-Exports

# macOS/Linux
PHD_ATLAS_TRANSFER_ROOTS=/home/alice/Downloads:/srv/phd-exports
```

Windows uses `;`; macOS/Linux uses `:`. The variable replaces the defaults rather than extending them. Set it before Codex starts and restart the app/extension/CLI after changes. Keep roots as narrow as practical; do not approve a repository root, the credential directory, an entire home directory, or an untrusted shared tree.

## Diagnose

```text
node scripts/phd-atlas-cli.mjs doctor
node scripts/phd-atlas-cli.mjs doctor --offline
```

Use offline mode to validate Node, paths, permissions, and local account metadata without contacting the server. Ordinary doctor also verifies whoami and the capability-manifest schema.

For MCP discovery and protocol diagnostics:

1. Run `codex mcp list --json` and `codex mcp get phd-atlas --json` for a standalone registration, or `codex plugin list` for the bundled server.
2. Confirm Node is 64-bit version 20+ and the configured absolute script path exists.
3. Run `node <absolute-cli-path> doctor --offline` before testing account connectivity.
4. Use `/mcp` in Codex or launch `npx @modelcontextprotocol/inspector@latest` and configure the same `node <absolute-cli-path> mcp` stdio command.
5. Restart Codex and create a new task after tool names, descriptions, schemas, annotations, or Plugin files change.

Running `node <absolute-cli-path> mcp` directly appears idle because the stdio server is correctly waiting for JSON-RPC input. Its stdout is reserved for protocol messages. Shell wrappers, banners, and diagnostics must not write to stdout.

If tools appear twice, remove the standalone registration with `codex mcp remove phd-atlas` or disable the Plugin-scoped server. Do not enable both unless two separately named instances are intentional.

If a download/export reports that the output already exists, select a new path. MCP does not have an overwrite mode; `force` cannot change that. Use the standalone CLI with `--force --confirm` only when the user deliberately requires replacement.

`codex mcp login phd-atlas` is not a PhD Atlas login diagnostic and should not be used: the local stdio transport does not authenticate through MCP OAuth. Start a new PhD Atlas device flow instead.

If login reports an unsafe verification URL, fix the deployment to use the server's own origin. Only for a deliberate split-frontend deployment, configure exact comma-separated HTTPS origins in `PHD_ATLAS_VERIFICATION_ORIGINS`, restart Codex, and start a fresh device flow. Never allowlist an unexpected redirect.

If a self-hosted API responds with a redirect, change the reverse proxy to serve `/api/...` directly and use the final path-free HTTPS origin as `--server`. The client intentionally never follows API redirects.

For private-CA failures, point `NODE_EXTRA_CA_CERTS` at the absolute PEM CA file in the MCP process environment and restart Codex. Never disable TLS verification.

If an authorization expires or is revoked, run login start again. Never repair it by copying a browser JWT or another account's token.
