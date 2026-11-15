/** @jest-environment node */
import { ReadableStream } from 'stream/web';
import { parseSseBlock, readEventStream, type SseEvent } from './event-stream';

const encoder = new TextEncoder();

function streamOf(parts: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part);
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  await readEventStream(body as unknown as globalThis.ReadableStream<Uint8Array>, (event) => events.push(event));
  return events;
}

describe('parseSseBlock', () => {
  it('reads the event name and JSON data', () => {
    expect(parseSseBlock('event: delta\ndata: {"text":"مرحبا"}')).toEqual({ event: 'delta', data: { text: 'مرحبا' } });
  });

  it('ignores comments, empty blocks and unreadable data', () => {
    expect(parseSseBlock(': keep-alive')).toBeNull();
    expect(parseSseBlock('event: delta')).toBeNull();
    expect(parseSseBlock('event: delta\ndata: {broken')).toBeNull();
  });
});

describe('readEventStream', () => {
  it('delivers events in order', async () => {
    const events = await collect(streamOf(['event: start\ndata: {}\n\nevent: delta\ndata: {"text":"a"}\n\nevent: final\ndata: {"id":"1"}\n\n']));
    expect(events.map((e) => e.event)).toEqual(['start', 'delta', 'final']);
  });

  it('reassembles events and multi-byte Arabic characters split across chunks', async () => {
    const wire = encoder.encode('event: delta\ndata: {"text":"أهلاً بكِ"}\n\nevent: delta\ndata: {"text":" ✨"}\n\n');
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < wire.length; i += 3) chunks.push(wire.slice(i, i + 3)); // cuts inside UTF-8 sequences
    const events = await collect(streamOf(chunks));
    expect(events.map((e) => (e.data as { text: string }).text).join('')).toBe('أهلاً بكِ ✨');
  });

  it('hands events over as they arrive, not when the stream ends', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let controllerRef!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controllerRef = c; } });
    const seen: string[] = [];
    const reading = readEventStream(body as unknown as globalThis.ReadableStream<Uint8Array>, (event) => {
      seen.push(event.event);
      if (event.event === 'delta') release();
    });
    controllerRef.enqueue(encoder.encode('event: delta\ndata: {"text":"first"}\n\n'));
    await gate; // resolves only because the first event was delivered while the stream is still open
    expect(seen).toEqual(['delta']);
    controllerRef.enqueue(encoder.encode('event: final\ndata: {}\n\n'));
    controllerRef.close();
    await reading;
    expect(seen).toEqual(['delta', 'final']);
  });

  it('tolerates CRLF line endings and a trailing block without a terminator', async () => {
    const events = await collect(streamOf(['event: delta\r\ndata: {"text":"x"}\r\n\r\nevent: final\r\ndata: {}']));
    expect(events.map((e) => e.event)).toEqual(['delta', 'final']);
  });
});
