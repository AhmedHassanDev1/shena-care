import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema, ListToolsResultSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { ENDPOINT, type Config } from './config.js';
import { AdapterError } from './errors.js';

export interface Upstream {
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult>;
  close(): Promise<void>;
}

export class StitchUpstream implements Upstream {
  private client?: Client;
  private connecting?: Promise<Client>;
  private closed = false;
  constructor(private readonly config: Config, private readonly fetcher: typeof fetch = fetch) {}

  private async connect(): Promise<Client> {
    if (this.closed) throw new AdapterError('The Stitch connection has been closed. Restart the adapter.');
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = this.open().finally(() => { this.connecting = undefined; });
    }
    return this.connecting;
  }

  private async open(): Promise<Client> {
    const client = new Client({ name: 'stitch-mcp-adapter', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
      requestInit: { headers: this.config.headers, redirect: 'error' },
      fetch: (input, init) => this.fetcher(input, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []),
          AbortSignal.timeout(this.config.timeoutMs)
        ])
      })
    });
    client.onclose = () => { if (this.client === client) this.client = undefined; };
    client.onerror = () => {}; // Never log transport objects or authentication headers.
    try {
      await client.connect(transport, { timeout: this.config.timeoutMs });
      if (this.closed) throw new AdapterError('The Stitch connection has been closed.');
      this.client = client;
      return client;
    } catch (error) {
      await client.close().catch(() => {});
      throw error;
    }
  }

  async listTools(): Promise<Tool[]> {
    const client = await this.connect();
    const tools: Tool[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      // Raw discovery avoids compiling optional upstream output schemas with unresolved references.
      const page = await client.request({ method: 'tools/list', params: cursor ? { cursor } : {} }, ListToolsResultSchema, { timeout: this.config.timeoutMs });
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor && (cursors.has(cursor) || cursors.size >= 100)) {
        throw new AdapterError('Stitch returned invalid or excessive tool pagination.');
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> {
    const client = await this.connect();
    // Exactly one request. Mutations must never be automatically retried.
    return client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema, { timeout: this.config.timeoutMs, signal });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.client?.close();
  }
}
