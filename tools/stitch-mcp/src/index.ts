#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConfig, ENDPOINT } from './config.js';
import { StitchUpstream } from './upstream.js';
import { StitchAdapter, createServer } from './adapter.js';
import { AdapterError, safeError } from './errors.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--check', '--schema', '--help'].includes(args[0]!))) {
    throw new AdapterError('Usage: node dist/index.js [--check | --schema | --help]');
  }
  if (args[0] === '--help') {
    process.stdout.write('Stitch MCP adapter: stdio by default; --check verifies authentication and lists enabled tool names; --schema prints the live enabled tools. Set STITCH_API_KEY. See README.md.\n');
    return;
  }
  let config;
  try { config = readConfig(); }
  catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
    return;
  }
  const adapter = new StitchAdapter(new StitchUpstream(config), config);
  if (args[0]) {
    try {
      const tools = await adapter.listTools();
      process.stdout.write(JSON.stringify(args[0] === '--schema' ? { tools } : { endpoint: ENDPOINT, writesEnabled: config.enableWrites, tools: tools.map(tool => tool.name) }, null, 2) + '\n');
    } finally { await adapter.close(); }
    return;
  }
  const server = createServer(adapter);
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => process.exit(0), 2000);
    deadline.unref();
    await Promise.allSettled([server.close(), adapter.close()]);
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  process.stdin.once('end', () => { void shutdown(); });
  await server.connect(new StdioServerTransport());
}

main().catch(error => {
  process.stderr.write(safeError(error) + '\n');
  process.exitCode = 1;
});
