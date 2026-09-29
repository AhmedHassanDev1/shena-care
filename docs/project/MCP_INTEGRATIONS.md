# Linear and Stitch MCP connections

Codex loads the project connections from [`.codex/config.toml`](../../.codex/config.toml). Linear uses its hosted read-only MCP endpoint and OAuth. Stitch uses Google's hosted MCP service through the local adapter in [`tools/stitch-mcp`](../../tools/stitch-mcp), which exposes project/screen reads and bounded HTML/screenshot exports. Stitch writes are disabled by default.

## This Windows workstation

1. From the project root, install and build the adapter:

   ```powershell
   npm ci --prefix tools/stitch-mcp
   npm run build --prefix tools/stitch-mcp
   ```

2. Keep the Stitch key outside Git at `C:/Users/Administrator/.codex/secrets/shena-stitch.env` with `STITCH_API_KEY=<your key>`. Keep `STITCH_ENABLE_WRITES=false` or omit it. The project config points to that file. On this workstation, Node also needs the local trusted CA bundle at `C:/Users/Administrator/.codex/certs/windows-trusted-roots.pem`.
3. Run `codex mcp login linear` from the project root and complete Linear's browser authorization. OAuth credentials are managed by Codex, not the repository.
4. Restart the Codex task/app to load the newly configured tools. Check registration with `codex mcp list`.

To verify Stitch independently of Codex:

```powershell
$env:NODE_EXTRA_CA_CERTS = 'C:/Users/Administrator/.codex/certs/windows-trusted-roots.pem'
node --env-file=C:/Users/Administrator/.codex/secrets/shena-stitch.env tools/stitch-mcp/dist/index.js --check
```

The check lists enabled tool names and should report `writesEnabled: false`. It does not modify a Stitch project. The adapter's credential-free suite is `npm test --prefix tools/stitch-mcp`.

The checked-in Codex config contains this workstation's absolute paths. On another machine, update the Node executable, adapter entry point, secret path, and CA bundle path; omit the CA setting if Node already trusts the connection. Never put the key or OAuth tokens in the config or commit a `.env` file.

## Why these connections

- [Linear's MCP server](https://linear.app/docs/mcp) already provides the hosted Linear integration, so maintaining a second Linear server in this repository would add work without improving access. The standard `/mcp` endpoint's protected-resource metadata returned malformed chunked HTTP on this workstation during setup, so this config uses Linear's documented `/mcp/readonly` endpoint while that is unresolved.
- [Google's Stitch MCP endpoint](https://stitch.withgoogle.com/docs/mcp/setup) is the upstream source. The local adapter limits exposed operations and adds export helpers needed for design implementation. Its [README](../../tools/stitch-mcp/README.md) describes its tools and other MCP clients.
- [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp) supports project-level connections for trusted projects.

For current work, read Linear issue `GLO-114` and the project's Stitch screens after both connections are available. Treat Linear as the task record and Stitch as the design source; do not infer issue status from code alone.
