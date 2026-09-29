// Run from the package directory after building:
// node --env-file=.env examples/export-client.mjs projects/PROJECT/screens/SCREEN html ./downloads
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [name, format = 'html', directory = './downloads'] = process.argv.slice(2);
if (!name || !['html', 'screenshot'].includes(format)) {
  throw new Error('Usage: export-client.mjs projects/PROJECT/screens/SCREEN [html|screenshot] [output-directory]');
}
const env = {};
for (const key of ['STITCH_API_KEY', 'STITCH_ACCESS_TOKEN', 'GOOGLE_CLOUD_PROJECT', 'STITCH_TIMEOUT_MS', 'STITCH_DOWNLOAD_TIMEOUT_MS', 'STITCH_MAX_DOWNLOAD_BYTES', 'NODE_EXTRA_CA_CERTS']) {
  if (process.env[key]) env[key] = process.env[key];
}
env.STITCH_ENABLE_WRITES = 'false';
const client = new Client({ name: 'stitch-export-example', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))], env }));
  const result = await client.callTool({ name: 'export_screen', arguments: { name, format } }, undefined, { timeout: 900000 });
  if (result.isError) throw new Error(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
  const resource = result.content.find(c => c.type === 'resource')?.resource;
  const filename = result.structuredContent?.filename;
  if (!resource || !('blob' in resource) || typeof filename !== 'string' || !/^[A-Za-z0-9_-]+\.(html|png|jpg|gif|webp)$/.test(filename)) {
    throw new Error('The server returned an unexpected export format.');
  }
  await mkdir(directory, { recursive: true });
  const destination = resolve(directory, filename);
  await writeFile(destination, Buffer.from(resource.blob, 'base64'), { flag: 'wx' });
  console.log(`Saved ${destination}`);
} finally { await client.close(); }
