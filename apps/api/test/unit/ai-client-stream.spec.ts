import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { HttpAiClient } from '../../src/platform/ai/http-ai.client';
import { AiClientError, AiErrorKind, ConsultRespondRequest } from '../../src/platform/ai/ai-client.contract';

/** A real HTTP server standing in for services/ai: the stream is chunked on the wire, not faked in memory. */

const REQUEST = { customerId: '343f1cb1-0b53-4876-90e8-07e1bf1f8d42', locale: 'ar', intent: 'recommend_products' } as unknown as ConsultRespondRequest;
const FINAL = { schemaVersion: '1', message: 'أهلاً بكِ، ده غسول لطيف', followUpQuestion: null, quickReplies: [], recommendations: [], routine: null, citations: [], providerMetadata: { model: 'x:free' } };

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('HttpAiClient.consultRespondStream', () => {
  let server: Server;
  let baseUrl: string;
  let onRequest: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  let lastBody: Record<string, unknown>;
  let lastHeaders: IncomingMessage['headers'];

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      lastBody = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      lastHeaders = req.headers;
      await onRequest(req, res);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }));

  const client = (timeoutMs = 5000) => new HttpAiClient(baseUrl, timeoutMs, 'service-token', 'pseudonym-secret');
  const sseHead = (res: ServerResponse) => res.writeHead(200, { 'Content-Type': 'text/event-stream' });

  it('delivers the answer text progressively, then the result, and authenticates with the service token', async () => {
    onRequest = async (_req, res) => {
      sseHead(res);
      res.write(sse('delta', { text: 'أهلاً ' }));
      await sleep(80);
      res.write(sse('delta', { text: 'بكِ، ' }));
      await sleep(80);
      res.write(sse('delta', { text: 'ده غسول لطيف' }));
      await sleep(80);
      res.write(sse('final', FINAL));
      res.end();
    };
    const seen: Array<{ text: string; at: number }> = [];
    const started = Date.now();
    const result = await client().consultRespondStream(REQUEST, { onDelta: text => seen.push({ text, at: Date.now() - started }), onReset: () => undefined });

    expect(seen.map(s => s.text).join('')).toBe(FINAL.message);
    expect(seen.length).toBe(3);
    // Progressive on the wire: the first piece is handed over long before the last one exists.
    expect(seen[2].at - seen[0].at).toBeGreaterThanOrEqual(120);
    expect(result.message).toBe(FINAL.message);
    expect(lastHeaders.authorization).toBe('Bearer service-token');
    expect(lastHeaders.accept).toBe('text/event-stream');
    expect(String(lastBody.subject)).not.toContain('343f1cb1'); // the model sees a pseudonym, never the customer id
  });

  it('parses events split at arbitrary byte boundaries', async () => {
    onRequest = async (_req, res) => {
      sseHead(res);
      const wire = sse('delta', { text: 'مرحبا' }) + sse('final', FINAL);
      const bytes = Buffer.from(wire);
      for (let i = 0; i < bytes.length; i += 5) {
        res.write(bytes.subarray(i, i + 5));
        await sleep(2);
      }
      res.end();
    };
    const text: string[] = [];
    const result = await client().consultRespondStream(REQUEST, { onDelta: t => text.push(t), onReset: () => undefined });
    expect(text.join('')).toBe('مرحبا');
    expect(result.message).toBe(FINAL.message);
  });

  it('forwards reset events', async () => {
    onRequest = (_req, res) => {
      sseHead(res);
      res.write(sse('delta', { text: 'half' }) + sse('reset', {}) + sse('delta', { text: 'full' }) + sse('final', FINAL));
      res.end();
    };
    const log: string[] = [];
    await client().consultRespondStream(REQUEST, { onDelta: t => log.push(`d:${t}`), onReset: () => log.push('reset') });
    expect(log).toEqual(['d:half', 'reset', 'd:full']);
  });

  it('maps an error event to a typed error', async () => {
    onRequest = (_req, res) => {
      sseHead(res);
      res.write(sse('delta', { text: 'partial' }) + sse('error', { status: 503, detail: 'AI provider unavailable' }));
      res.end();
    };
    await expect(client().consultRespondStream(REQUEST, { onDelta: () => undefined, onReset: () => undefined }))
      .rejects.toMatchObject({ kind: AiErrorKind.UNAVAILABLE });
  });

  it.each([[429, AiErrorKind.LIMITED], [503, AiErrorKind.UNAVAILABLE], [500, AiErrorKind.INVALID_RESPONSE]])('maps HTTP %i before streaming', async (status, kind) => {
    onRequest = (_req, res) => { res.writeHead(status).end(); };
    await expect(client().consultRespondStream(REQUEST, { onDelta: () => undefined, onReset: () => undefined })).rejects.toMatchObject({ kind });
  });

  it('fails when the stream ends without a result', async () => {
    onRequest = (_req, res) => { sseHead(res); res.write(sse('delta', { text: 'cut off' })); res.end(); };
    await expect(client().consultRespondStream(REQUEST, { onDelta: () => undefined, onReset: () => undefined }))
      .rejects.toMatchObject({ kind: AiErrorKind.INVALID_RESPONSE });
  });

  it('rejects a result that breaks the contract', async () => {
    onRequest = (_req, res) => { sseHead(res); res.write(sse('final', { ...FINAL, message: '   ' })); res.end(); };
    await expect(client().consultRespondStream(REQUEST, { onDelta: () => undefined, onReset: () => undefined }))
      .rejects.toBeInstanceOf(AiClientError);
  });

  it('cancels: aborting closes the upstream connection and reports CANCELLED', async () => {
    let upstreamClosed = false;
    onRequest = (_req, res) => {
      sseHead(res);
      res.write(sse('delta', { text: 'start ' }));
      res.on('close', () => { upstreamClosed = true; });
      // never finishes: the model is still writing
    };
    const abort = new AbortController();
    const pending = client().consultRespondStream(REQUEST, { onDelta: () => abort.abort(), onReset: () => undefined, signal: abort.signal });
    await expect(pending).rejects.toMatchObject({ kind: AiErrorKind.CANCELLED });
    await sleep(100);
    expect(upstreamClosed).toBe(true);
  });

  it('times out only when the stream goes silent (idle timeout), not on a long answer', async () => {
    onRequest = async (_req, res) => {
      sseHead(res);
      for (let i = 0; i < 6; i += 1) { res.write(sse('delta', { text: `${i}` })); await sleep(60); }
      res.write(sse('final', FINAL));
      res.end();
    };
    // idle limit is 2 x 100 ms = 200 ms; the whole answer takes ~360 ms but never goes quiet that long
    const result = await client(100).consultRespondStream(REQUEST, { onDelta: () => undefined, onReset: () => undefined });
    expect(result.message).toBe(FINAL.message);

    onRequest = (_req, res) => { sseHead(res); res.write(sse('delta', { text: 'then silence' })); };
    await expect(client(100).consultRespondStream(REQUEST, { onDelta: () => undefined, onReset: () => undefined }))
      .rejects.toMatchObject({ kind: AiErrorKind.TIMEOUT });
  });

  it('reports UNAVAILABLE when the AI service is unreachable', async () => {
    const dead = new HttpAiClient('http://127.0.0.1:1', 1000, 'service-token', 'pseudonym-secret');
    await expect(dead.consultRespondStream(REQUEST, { onDelta: () => undefined, onReset: () => undefined }))
      .rejects.toMatchObject({ kind: AiErrorKind.UNAVAILABLE });
  });
});
