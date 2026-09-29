# Interface verification — 2026-09-29

## Finding

An official public **remote MCP interface exists** at `https://stitch.googleapis.com/mcp`. Google Cloud lists Stitch as **Beta** in its remote MCP product catalog. Google also describes its MCP server, SDK and export integrations in its product announcement. Therefore this implementation uses the official MCP service rather than building a browser or manual-export adapter.

- [Google Cloud supported MCP products](https://docs.cloud.google.com/mcp/supported-products)
- [Google's Stitch product announcement](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design/)
- [Stitch MCP setup](https://stitch.withgoogle.com/docs/mcp/setup)
- [Stitch MCP reference](https://stitch.withgoogle.com/docs/mcp/reference/)

The Stitch documentation pages returned client-rendered shells in the research environment. Their contents were not treated as inspected reference text. The endpoint and authentication flow were corroborated by Google's catalog, codelab and published repositories, then verified through authenticated calls after the user supplied an API key.

## Capability evidence

| Capability | Public evidence | Adapter decision |
| --- | --- | --- |
| List/get projects; list/get screens | Google's generated MCP tool manifest | Expose the four read tools when discovered. |
| Screen metadata | `get_screen` schema and generated Screen implementation | Preserve the upstream result. Do not promise every field shown in the web UI. |
| HTML and screenshot export | Screen implementation reads `htmlCode.downloadUrl` and `screenshot.downloadUrl` | Add bounded download helpers around those URLs. |
| Create projects, generate screens, edit screens | `create_project`, `generate_screen_from_text`, `edit_screens` in the manifest | Support only when advertised by the service and explicitly enabled locally. |
| Other write tools, uploads or REST endpoints | Outside this minimal implementation | No undocumented operations, broad passthrough or claims of support. |
| Full project bundle, asset crawling, Figma export | Not established as part of this implemented contract | Not exposed. |

Detailed primary sources:

- [Google Labs SDK tool manifest at inspected revision](https://github.com/google-labs-code/stitch-sdk/blob/edc0e5a5d124ea700123c2555507fe90d6205d37/packages/sdk/generated/tools-manifest.json)
- [Generated screen export handling](https://github.com/google-labs-code/stitch-sdk/blob/edc0e5a5d124ea700123c2555507fe90d6205d37/packages/sdk/generated/src/screen.ts)
- [Google Labs SDK authentication headers](https://github.com/google-labs-code/stitch-sdk/blob/edc0e5a5d124ea700123c2555507fe90d6205d37/packages/sdk/src/auth.ts)
- [Google's Gemini CLI Stitch extension configuration](https://github.com/gemini-cli-extensions/stitch/blob/main/gemini-extension.json)
- [Google Codelab: Antigravity and Stitch](https://codelabs.developers.google.com/design-to-code-with-antigravity-stitch)

The Google Labs SDK repository is published by Google but explicitly says it is not an officially supported Google product. That is distinct from the public service's availability. This adapter depends on the MCP TypeScript SDK, not on the Stitch SDK package; the repository supplies corroborating protocol/schema evidence. Runtime discovery remains authoritative for a particular account and deployment.

## Design decisions

The local server terminates stdio MCP and acts as an authenticated Streamable HTTP MCP client upstream. It keeps native input schemas and results, limits tool names to a fixed allowlist, and obtains schemas at runtime to avoid stale model enums. The public SDK notes that upstream output schemas can contain unresolved references, so optional output schemas are omitted locally without altering result payloads. Invalid input schemas fail closed.

Exports are downloaded from service-returned URLs using separate credential-free requests. Host checks, bounded redirects, deadlines and byte limits apply. No export is executed, rendered or recursively crawled by the server.

## Validation boundary

Public documentation and repository source were inspected. Local protocol and behavior tests use a synthetic upstream. After the user supplied an API key, authenticated discovery and read/export operations were checked on the referenced project. The schema snapshot was captured from the service itself, including discovery of supported write tools without invoking them. Actual generation/edit outcomes and GUI integrations remain unverified. See [verification-results.md](verification-results.md) for the completed checks.

Client and protocol references:

- [Official MCP TypeScript SDK v1 documentation](https://ts.sdk.modelcontextprotocol.io/)
- [Claude Code MCP setup](https://code.claude.com/docs/en/mcp)
- [Antigravity MCP setup](https://antigravity.google/docs/mcp)
