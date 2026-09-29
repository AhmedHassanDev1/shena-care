import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readConfig } from '../dist/config.js';
import { StitchAdapter } from '../dist/adapter.js';
import { StitchUpstream } from '../dist/upstream.js';
import { download, allowedDownloadUrl } from '../dist/download.js';
import { safeError } from '../dist/errors.js';
import { FakeUpstream, screenName, screen, html, png, mockFetch } from './fixtures.mjs';

const config = readConfig({ STITCH_API_KEY: 'test-secret' });

test('configuration requires unambiguous credentials and validates limits', () => {
  assert.throws(() => readConfig({}), /STITCH_API_KEY/);
  assert.throws(() => readConfig({ STITCH_API_KEY: 'a', STITCH_ACCESS_TOKEN: 'b' }), /not both/);
  assert.throws(() => readConfig({ STITCH_ACCESS_TOKEN: 'a' }), /GOOGLE_CLOUD_PROJECT/);
  assert.throws(() => readConfig({ STITCH_API_KEY: 'a\nb' }), /single-line/);
  assert.throws(() => readConfig({ STITCH_API_KEY: 'a', STITCH_ENABLE_WRITES: 'yes' }), /true or false/);
  assert.throws(() => readConfig({ STITCH_API_KEY: 'a', STITCH_TIMEOUT_MS: 'NaN' }), /integer/);
  assert.throws(() => readConfig({ STITCH_API_KEY: 'a', STITCH_MAX_DOWNLOAD_BYTES: '9999999999' }), /between/);
  assert.deepEqual(readConfig({ STITCH_ACCESS_TOKEN: 'token', GOOGLE_CLOUD_PROJECT: 'quota' }).headers, { Authorization: 'Bearer token', 'X-Goog-User-Project': 'quota' });
});

test('read-only catalog excludes writes and unknown future tools, suppresses broken output schemas', async () => {
  const upstream = new FakeUpstream();
  const adapter = new StitchAdapter(upstream, config);
  const tools = await adapter.listTools();
  assert.deepEqual(tools.map(t => t.name), ['list_projects', 'get_project', 'list_screens', 'get_screen', 'get_screen_content', 'export_screen']);
  assert.equal(tools.find(t => t.name === 'get_screen').outputSchema, undefined);
  await assert.rejects(adapter.callTool('create_project', { title: 'X' }), /disabled/);
  await assert.rejects(adapter.callTool('delete_project', { name: 'projects/a' }), /disabled/);
  await assert.rejects(adapter.callTool('get_screen', {}), /inputSchema/);
  assert.equal(upstream.calls.length, 0);
});

test('only discovered writes are enabled, validated and forwarded exactly once', async () => {
  const upstream = new FakeUpstream();
  const adapter = new StitchAdapter(upstream, { ...config, enableWrites: true });
  const args = { projectId: '123', selectedScreenIds: ['screen'], prompt: 'Make it blue' };
  await adapter.callTool('edit_screens', args);
  assert.deepEqual(upstream.calls, [{ name: 'edit_screens', args }]);
  upstream.callTool = async () => { upstream.calls.push('failed'); throw new Error('secret-token'); };
  const result = await adapter.callTool('edit_screens', args);
  assert.equal(result.isError, true);
  assert.equal(upstream.calls.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
  const missing = new FakeUpstream();
  missing.available = missing.available.filter(t => t.name !== 'edit_screens');
  const reduced = new StitchAdapter(missing, { ...config, enableWrites: true });
  await assert.rejects(reduced.callTool('edit_screens', args), /unavailable/);
});

test('content and original HTML/image bytes are fetched from metadata', async () => {
  const upstream = new FakeUpstream();
  const observations = [];
  const adapter = new StitchAdapter(upstream, config, mockFetch(observations));
  const content = await adapter.callTool('get_screen_content', { name: screenName });
  assert.equal(content.structuredContent.html, html);
  upstream.result = { content: [], structuredContent: screen };
  for (const [format, expected, mime] of [['html', Buffer.from(html), 'text/html'], ['screenshot', png, 'image/png']]) {
    const result = await adapter.callTool('export_screen', { name: screenName, format });
    assert.equal(result.isError, undefined);
    const resource = result.content.find(c => c.type === 'resource').resource;
    assert.deepEqual(Buffer.from(resource.blob, 'base64'), expected);
    assert.equal(resource.mimeType, mime);
    assert.equal(result.structuredContent.sha256, createHash('sha256').update(expected).digest('hex'));
  }
  for (const { init } of observations) {
    assert.deepEqual(init.headers, { Accept: '*/*' });
    assert.equal(init.credentials, 'omit');
  }
  assert.deepEqual(upstream.calls[0], { name: 'get_screen', args: { name: screenName } });
});

test('upstream tool errors pass through; missing exports do not fabricate content', async () => {
  const upstream = new FakeUpstream();
  const adapter = new StitchAdapter(upstream, config, () => { throw new Error('must not fetch'); });
  upstream.result = { isError: true, content: [{ type: 'text', text: 'Permission denied' }] };
  assert.deepEqual(await adapter.callTool('get_screen_content', { name: screenName }), upstream.result);
  upstream.result = { content: [], structuredContent: { name: screenName } };
  const result = await adapter.callTool('export_screen', { name: screenName, format: 'html' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /no requested export URL/);
});

test('URL policy blocks private hosts, credential URLs, schemes, suffix lookalikes and ports', () => {
  for (const url of ['http://lh3.googleusercontent.com/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://169.254.169.254/a', 'file:///secret', 'https://googleusercontent.com.evil.example/a', 'https://evilgoogleusercontent.com/a', 'https://user:password@lh3.googleusercontent.com/a', 'https://lh3.googleusercontent.com:8443/a']) {
    assert.throws(() => allowedDownloadUrl(url));
  }
  assert.equal(allowedDownloadUrl('https://storage.googleapis.com/bucket/file').hostname, 'storage.googleapis.com');
  assert.equal(allowedDownloadUrl('https://contribution.usercontent.google.com/download?opaque=fixture').hostname, 'contribution.usercontent.google.com');
  assert.throws(() => allowedDownloadUrl('https://contribution.usercontent.google.com.evil.example/file'));
  assert.throws(() => allowedDownloadUrl('https://unrelated.google.com/file'));
});

test('redirect targets are revalidated and bounded; allowed redirects omit secrets', async () => {
  let calls = 0;
  await assert.rejects(download('https://lh3.googleusercontent.com/a', config, async () => {
    calls++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  }), /blocked/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(download('https://lh3.googleusercontent.com/a', config, async () => {
    calls++; return new Response(null, { status: 302, headers: { location: '/again' } });
  }), /too many/);
  assert.equal(calls, 4);
  calls = 0;
  const bytes = await download('https://lh3.googleusercontent.com/a', config, async (_url, init) => {
    assert.deepEqual(init.headers, { Accept: '*/*' });
    return ++calls === 1 ? new Response(null, { status: 302, headers: { location: 'https://storage.googleapis.com/bucket/file' } }) : new Response('ok');
  });
  assert.equal(bytes.toString(), 'ok');
});

test('both declared and streamed download sizes are bounded', async () => {
  await assert.rejects(download('https://lh3.googleusercontent.com/a', { ...config, maxDownloadBytes: 8 }, async () => new Response('small', { headers: { 'content-length': '100' } })), /exceeds/);
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(9)); }, cancel() { cancelled = true; } });
  await assert.rejects(download('https://lh3.googleusercontent.com/a', { ...config, maxDownloadBytes: 8 }, async () => new Response(stream)), /exceeds/);
  assert.equal(cancelled, true);
});

test('download deadline aborts a slow response and upstream HTTP failures stay sanitized', async () => {
  await assert.rejects(download('https://lh3.googleusercontent.com/a', { ...config, downloadTimeoutMs: 10 }, (_url, init) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('deadline failed')), 500);
    init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason); });
  })), /timeout/i);
  assert.match(safeError({ code: 403, secret: 'abc' }), /authentication/);
  assert.match(safeError({ code: 429 }), /rate limit/);
  assert.doesNotMatch(safeError(new Error('secret-key')), /secret-key/);
  assert.match(safeError(new TypeError('fetch failed', { cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' } })), /NODE_EXTRA_CA_CERTS/);
});

test('HTML export supports the Google download host observed in the live Stitch response', async () => {
  const upstream = new FakeUpstream();
  upstream.result = { content: [], structuredContent: { ...screen, htmlCode: { downloadUrl: 'https://contribution.usercontent.google.com/download?opaque=fixture' } } };
  const adapter = new StitchAdapter(upstream, config, async (url, init) => {
    assert.equal(new URL(url).hostname, 'contribution.usercontent.google.com');
    assert.deepEqual(init.headers, { Accept: '*/*' });
    return new Response(html);
  });
  const result = await adapter.callTool('get_screen_content', { name: screenName });
  assert.equal(result.structuredContent.html, html);
});

test('real HTTP transport initializes, follows discovery cursors and passes API key only to Stitch', async () => {
  const observations = [];
  const upstream = new StitchUpstream(config, mockFetch(observations));
  try {
    const tools = await upstream.listTools();
    assert.equal(tools.length, 8);
    const result = await upstream.callTool('list_screens', { projectId: '123' });
    assert.deepEqual(JSON.parse(result.content[0].text).received, { name: 'list_screens', arguments: { projectId: '123' } });
    const posts = observations.filter(o => o.init.method === 'POST');
    assert.ok(posts.length >= 5);
    for (const { init } of posts) {
      assert.equal(new Headers(init.headers).get('X-Goog-Api-Key'), 'test-secret');
      assert.equal(init.redirect, 'error');
    }
  } finally { await upstream.close(); }
});

test('HTTP 429 on a write is not retried', async () => {
  let calls = 0;
  const base = mockFetch();
  const upstream = new StitchUpstream(config, async (input, init) => {
    if (init?.body && JSON.parse(init.body).method === 'tools/call') {
      calls++; return new Response('private upstream detail', { status: 429 });
    }
    return base(input, init);
  });
  try {
    const adapter = new StitchAdapter(upstream, { ...config, enableWrites: true });
    const result = await adapter.callTool('create_project', { title: 'test' });
    assert.equal(calls, 1);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /rate limit/);
    assert.doesNotMatch(result.content[0].text, /private upstream/);
  } finally { await upstream.close(); }
});
