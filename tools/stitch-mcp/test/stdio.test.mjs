import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { screenName, html } from './fixtures.mjs';

const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const preload = new URL('./mock-fetch.mjs', import.meta.url).href;

test('packaged CLI works over real stdio with mocked Stitch, including export and write gating', { timeout: 15000 }, async () => {
  for (const writes of ['false', 'true']) {
    const client = new Client({ name: 'test-mcp-client', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', preload, entry], env: { STITCH_API_KEY: 'test-key', STITCH_ENABLE_WRITES: writes }, stderr: 'pipe' });
    let stderr = '';
    transport.stderr?.on('data', chunk => { stderr += chunk; });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.equal(tools.length, writes === 'true' ? 9 : 6);
      assert.equal(tools.some(t => t.name === 'create_project'), writes === 'true');
      const content = await client.callTool({ name: 'get_screen_content', arguments: { name: screenName } });
      assert.equal(content.structuredContent.html, html);
      const exported = await client.callTool({ name: 'export_screen', arguments: { name: screenName, format: 'html' } });
      assert.equal(Buffer.from(exported.content[1].resource.blob, 'base64').toString(), html);
      if (writes === 'false') {
        await assert.rejects(client.callTool({ name: 'create_project', arguments: { title: 'test' } }), /disabled/);
      } else {
        const result = await client.callTool({ name: 'create_project', arguments: { title: 'test' } });
        assert.equal(JSON.parse(result.content[0].text).received.name, 'create_project');
      }
      assert.equal(stderr, '');
    } finally { await client.close(); }
  }
});

test('missing credentials exit cleanly and never write non-protocol stdout', () => {
  const env = { ...process.env, STITCH_API_KEY: '', STITCH_ACCESS_TOKEN: '', GOOGLE_CLOUD_PROJECT: '' };
  const result = spawnSync(process.execPath, [entry], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /STITCH_API_KEY/);
});

test('check and schema commands produce parseable JSON against synthetic upstream', () => {
  for (const mode of ['--check', '--schema']) {
    const result = spawnSync(process.execPath, ['--import', preload, entry, mode], { env: { ...process.env, STITCH_API_KEY: 'test-key', STITCH_ACCESS_TOKEN: '', STITCH_ENABLE_WRITES: 'false' }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).tools.length, 6);
  }
});
