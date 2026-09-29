# Stitch MCP adapter

A small Node.js/TypeScript server connecting local MCP clients to **Google's public Stitch MCP endpoint**. It speaks stdio to Claude Desktop, Claude Code, Antigravity and other clients, and Streamable HTTP to `https://stitch.googleapis.com/mcp`.

**Verified on 2026-09-29:** Google lists Stitch's hosted MCP service as Beta. An export/scraping workaround is unnecessary. See [interface verification and sources](docs/interface-verification.md).

This package adds a restricted tool set, read-only defaults and bounded HTML/screenshot downloads. Clients that already support remote MCP can also use Google directly; examples are included below. This adapter is independent software, not a Google product.

## Setup

1. Install Node.js **20.19 or later**; use a currently supported Node.js release for ongoing use. The delivery was tested on Windows with Node 20.19.
2. In this directory, run:

   ```text
   npm ci
   npm run build
   npm test
   ```

3. Copy `.env.example` to `.env`. In Stitch, open your profile → **Stitch settings → API key → Create key**, and put the key in `.env`. Do not send your key in a chat or commit `.env`. The key flow is documented in [Google's codelab](https://codelabs.developers.google.com/design-to-code-with-antigravity-stitch).
4. Check the connection:

   ```text
   node --env-file=.env dist/index.js --check
   ```

   Success prints the endpoint, write setting and available tool names. This checks authentication and tool discovery, not access to a particular project.

5. Add one of the stdio configurations below to your client and reload its MCP servers.

The server reads process environment variables. It does **not** automatically load `.env`. Node's `--env-file` explicitly loads it; values already present in the process environment take precedence. `npm start` is a terminal convenience; MCP client configurations should launch `node` directly so npm banners cannot enter the protocol stream.

## Client configuration

Replace the absolute paths in [examples/stdio-client.json](examples/stdio-client.json). This form works for Claude Desktop, Claude Code and Antigravity:

```json
{
  "mcpServers": {
    "stitch": {
      "command": "node",
      "args": [
        "--env-file=/ABSOLUTE/PATH/stitch-mcp/.env",
        "/ABSOLUTE/PATH/stitch-mcp/dist/index.js"
      ]
    }
  }
}
```

Use an absolute Node executable path if a desktop client cannot find `node`. The [Windows example](examples/stdio-windows.json) uses forward slashes, which are valid in Windows paths and avoid JSON backslash escaping. Adjust the example Node installation path to your installation.

- **Claude Desktop:** merge the `stitch` entry into `mcpServers` in its local MCP configuration, then restart the app.
- **Claude Code:** use the configuration in your project's `.mcp.json`, or add the server with `claude mcp add --transport stdio stitch -- node --env-file=/ABSOLUTE/PATH/stitch-mcp/.env /ABSOLUTE/PATH/stitch-mcp/dist/index.js`. Check it with `/mcp`. [Claude Code documentation](https://code.claude.com/docs/en/mcp)
- **Antigravity:** MCP Servers → Manage MCP Servers → View raw config; merge the entry into `mcpServers` and reload. [Antigravity documentation](https://antigravity.google/docs/mcp)
- **Other clients:** select stdio transport, command `node`, the two absolute-path arguments above, and optionally provide environment variables in the client's `env` object instead of using `.env`.

For long generations, set the client's own tool-call timeout above `STITCH_TIMEOUT_MS` where supported. A client can otherwise cancel earlier than this adapter.

### Direct hosted connection

Use [examples/claude-code-direct.json](examples/claude-code-direct.json) or [examples/antigravity-direct.json](examples/antigravity-direct.json) if you only need Google's native tools. Claude Code's HTTP field is `url` with `type: "http"`; Antigravity uses `serverUrl`. Both send `X-Goog-Api-Key`. Claude Code supports `${STITCH_API_KEY}` expansion; the Antigravity example uses a literal placeholder to replace in its private local config.

Direct connections do not run this adapter's write restrictions or its two download helpers. They expose Google's available tools according to the client's own permissions. Choose either the direct entry or the local entry to avoid duplicate tools.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `STITCH_API_KEY` | Required with API-key auth | Key created in Stitch settings; sent only to the fixed Google MCP endpoint. |
| `STITCH_ACCESS_TOKEN` | Unset | Alternative OAuth bearer token. Do not set alongside the API key. |
| `GOOGLE_CLOUD_PROJECT` | Required with token auth | Google Cloud quota project, **not** a numeric Stitch project ID. |
| `STITCH_ENABLE_WRITES` | `false` | Set exactly `true` to expose the three supported write tools. Restart the server after changing it. |
| `STITCH_TIMEOUT_MS` | `300000` | Per upstream request/connection timeout, 1,000–900,000 ms. |
| `STITCH_DOWNLOAD_TIMEOUT_MS` | `30000` | Total asset download deadline, including redirects, 1,000–120,000 ms. |
| `STITCH_MAX_DOWNLOAD_BYTES` | `5242880` | Per downloaded file limit, 1,024–20,971,520 bytes. Base64 export results are roughly one-third larger. |

OAuth setup is covered by [Stitch's authentication guide](https://stitch.withgoogle.com/docs/mcp/setup). This minimal adapter accepts an existing token; it does not run a login flow, load ADC, or refresh expired tokens. After refreshing a token, update the environment and restart the server. API-key authentication is the simpler setup here.

## Tools and schemas

The adapter discovers Google's current schemas with `tools/list`, follows discovery pagination, and exposes only the following allowlist. Arguments are validated against the discovered schema and forwarded unchanged. No arbitrary tool-call escape hatch is exposed.

| Tool | Inputs at verification time | Result |
| --- | --- | --- |
| `list_projects` | Optional `filter`: `view=owned` or `view=shared` | Project listing. Google's default is owned projects; list shared separately. |
| `get_project` | `name`: `projects/PROJECT_ID` | Project metadata. |
| `list_screens` | `projectId`: bare string ID | Screens in that project. |
| `get_screen` | `name`: `projects/PROJECT_ID/screens/SCREEN_ID` | Screen metadata and available export URLs. |
| `get_screen_content` | `name`: full screen resource name | Metadata plus downloaded UTF-8 HTML. Local helper. |
| `export_screen` | `name`, `format`: `html` or `screenshot` | Embedded MCP resource containing base64 file bytes, plus filename, MIME type, byte count and SHA-256. Local helper. |
| `create_project` | Optional `title` | Create a project. Writes must be enabled. |
| `generate_screen_from_text` | `projectId`, `prompt`; optional fields per live schema | Generate a screen. Writes must be enabled. |
| `edit_screens` | `projectId`, `selectedScreenIds`, `prompt`; optional fields per live schema | Request screen edits. Writes must be enabled. |

Every ID is a **string**; large project IDs exceed JavaScript's safe integer precision. Refer to returned screen identifiers after an edit; do not assume the original ID was overwritten.

The two local helpers are advertised only if Google advertises `get_screen`. Writes require both `STITCH_ENABLE_WRITES=true` **and** discovery of the exact Google tool. Unknown future tools remain hidden. Schemas are cached for the process lifetime; restart to refresh them. Optional device/model fields follow Google's live schema, so the adapter does not pin a model name.

- [docs/tools-schema.snapshot.json](docs/tools-schema.snapshot.json): authenticated schema snapshot from Google's hosted service plus the local tools, including opt-in writes. It is documentation, not a hardcoded runtime contract.
- Retrieve your actual enabled schemas:

  ```text
  node --env-file=.env dist/index.js --schema
  ```

Native tool results preserve MCP content, structured content and `isError`. The adapter omits optional upstream **output** schemas because the published Stitch client documents unresolved output references in some responses. It does not invent missing input schemas: discovery fails if an enabled input schema cannot be compiled.

### Try your referenced project

After connecting, ask your MCP client to call these tools:

```json
{"name":"get_project","arguments":{"name":"projects/7772806486169068023"}}
```

```json
{"name":"list_screens","arguments":{"projectId":"7772806486169068023"}}
```

```json
{"name":"get_screen_content","arguments":{"name":"projects/7772806486169068023/screens/2baae6cfdbb84c50b91c44ebaf4de91e"}}
```

These are `tools/call` parameters, not shell commands. Access depends on the account behind your key. Read access to this project and its seven screens was verified with the supplied key during delivery.

### Export a file to disk

`export_screen` returns a self-contained embedded resource. It does not write files on the server or publish a URL. A client can decode `resource.blob` from base64 and save it. Its `stitch-export:` URI is an identifier, not a remotely hosted download or a `resources/read` endpoint.

The included example client does the saving and refuses to overwrite an existing file:

```text
node --env-file=.env examples/export-client.mjs projects/7772806486169068023/screens/2baae6cfdbb84c50b91c44ebaf4de91e html ./downloads
node --env-file=.env examples/export-client.mjs projects/7772806486169068023/screens/2baae6cfdbb84c50b91c44ebaf4de91e screenshot ./downloads
```

HTML is Stitch's generated source; it can contain inline CSS and references to external assets. This minimal export downloads the HTML or screenshot itself. It does not recursively collect images/fonts, create a ZIP, convert to React, or promise Figma export. Missing or unfinished exports produce a tool error.

## Behavior and limitations

- Uses the official MCP endpoint only. No browser cookies, private web RPCs, DOM scraping or undocumented REST calls.
- No automatic retry, especially for generation/edit requests. After a timeout, inspect `list_screens` before requesting the same write again; cancellation cannot guarantee a remote generation stopped.
- Downloads only URLs found in a fresh `get_screen` response. HTTPS is required; allowed hosts are `googleusercontent.com` and its subdomains, `gstatic.com` and its subdomains, and exactly `storage.googleapis.com` or `contribution.usercontent.google.com`. The latter was verified in a real Stitch HTML export response. Every redirect is checked, at most three are followed, and asset requests never carry API credentials.
- HTML is returned as data and never executed. Download size is enforced both before reading, when a length is provided, and while streaming.
- stdout contains only MCP messages in server mode; diagnostics go to stderr. Transport errors are sanitized. Project metadata and signed download links returned by native tools can be sensitive, so they inherit the client's conversation/log handling.
- If an export moves to another host, inspect the current official response before updating the allowlist. Native `get_screen` remains available for its metadata.
- This is a local stdio server, not a network service. It does not provide multi-user hosting, token refresh, project deletion, arbitrary asset upload, or offline export indexing.

## Verification

Run `npm test` for the credential-free suite. It covers real MCP stdio subprocesses, the Streamable HTTP handshake and pagination against a simulated service, input validation, read/write restrictions, returned HTML/image bytes, redirect and size limits, deadlines, credential isolation and error behavior.

Tests use explicitly synthetic screens. Authenticated tool discovery, project/screen reads and exports were also checked after the user supplied a key; see [verification results](docs/verification-results.md). Generation and edits were not executed, and GUI integration in Claude/Antigravity was not run. The key is stored outside this deliverable and is excluded from the archive.

### TLS on managed Windows installations

If Node reports a certificate verification error while Windows trusts the connection, configure `NODE_EXTRA_CA_CERTS` with a PEM bundle of your system/organization's trusted public CA certificates. Provide it in the MCP client's `env` object before Node starts. This machine required that setting for Node 20; the supplied machine-specific configuration points to a local bundle outside the delivery. Keep TLS verification enabled; do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

Files: `src/` implementation, `dist/` compiled server, `test/` test suite, `examples/` client configurations and export client, `docs/` verification evidence and schemas. Dependencies are pinned in `package-lock.json`.
