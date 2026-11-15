/** @jest-environment node */
process.env.NEXT_PUBLIC_API_URL = 'http://api.test';

import { ApiError } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import { streamGuidanceMessage, streamRetryGuidanceMessage, type GuidanceStreamHandlers } from './shina-api';

jest.mock('@/lib/auth', () => ({ auth: { getToken: jest.fn() } }));

const mockedAuth = auth as jest.Mocked<typeof auth>;
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const FINAL = { id: 'm1', sessionId: 's1', role: 'assistant', content: 'أهلاً بكِ', payload: null, createdAt: '2026-11-15T00:00:00Z' };

function respond(parts: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(status === 200 ? body : JSON.stringify({ message: 'nope' }), { status, headers: { 'Content-Type': status === 200 ? 'text/event-stream' : 'application/json' } });
}

function handlers(): GuidanceStreamHandlers & { log: string[] } {
  const log: string[] = [];
  return { log, onStatus: (s) => log.push(`status:${s}`), onDelta: (t) => log.push(`delta:${t}`), onReset: () => log.push('reset') };
}

describe('streamGuidanceMessage', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    mockedAuth.getToken.mockReturnValue('tok-1');
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('posts to the stream endpoint with the session token and reports progress, then returns the stored message', async () => {
    fetchMock.mockResolvedValue(respond([sse('start', {}), sse('status', { stage: 'understanding' }), sse('status', { stage: 'writing' }),
      sse('delta', { text: 'أهلاً ' }), sse('delta', { text: 'بكِ' }), sse('final', FINAL)]));
    const h = handlers();
    const message = await streamGuidanceMessage('s1', 'عايزة غسول', h, 'ar');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/guidance/sessions/s1/messages/stream');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(init.headers.Accept).toBe('text/event-stream');
    expect(JSON.parse(init.body)).toEqual({ content: 'عايزة غسول', locale: 'ar' });
    expect(h.log).toEqual(['status:understanding', 'status:writing', 'delta:أهلاً ', 'delta:بكِ']);
    expect(message).toMatchObject({ id: 'm1', content: 'أهلاً بكِ' });
  });

  it('forwards reset events', async () => {
    fetchMock.mockResolvedValue(respond([sse('delta', { text: 'half' }), sse('reset', {}), sse('delta', { text: 'whole' }), sse('final', FINAL)]));
    const h = handlers();
    await streamGuidanceMessage('s1', 'hi', h);
    expect(h.log).toEqual(['delta:half', 'reset', 'delta:whole']);
  });

  it('requires a signed-in customer before any request', async () => {
    mockedAuth.getToken.mockReturnValue(null);
    await expect(streamGuidanceMessage('s1', 'hi', handlers())).rejects.toMatchObject({ status: 401, type: 'UNAUTHENTICATED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns an HTTP rejection before streaming into an ApiError', async () => {
    fetchMock.mockResolvedValue(respond([], 429));
    await expect(streamGuidanceMessage('s1', 'hi', handlers())).rejects.toMatchObject({ status: 429, type: 'RATE_LIMITED' });
  });

  it('turns an error event into a typed ApiError', async () => {
    fetchMock.mockResolvedValue(respond([sse('delta', { text: 'partial' }), sse('error', { statusCode: 503, message: 'The consultation failed' })]));
    await expect(streamGuidanceMessage('s1', 'hi', handlers())).rejects.toMatchObject({ status: 503, type: 'SERVER' });
  });

  it('treats a stream that ends without a final message as a retryable network failure', async () => {
    fetchMock.mockResolvedValue(respond([sse('delta', { text: 'cut off' })]));
    const failure = await streamGuidanceMessage('s1', 'hi', handlers()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ type: 'NETWORK', status: 503 });
  });

  it('passes the abort signal to fetch so a stop closes the connection', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const controller = new AbortController();
    const pending = streamGuidanceMessage('s1', 'hi', { ...handlers(), signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('retry uses the retry stream endpoint', async () => {
    fetchMock.mockResolvedValue(respond([sse('final', FINAL)]));
    await streamRetryGuidanceMessage('s1', handlers());
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/guidance/sessions/s1/retry/stream');
  });
});
