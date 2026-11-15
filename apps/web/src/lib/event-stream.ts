/**
 * Minimal server-sent-events reader for `fetch` responses (the EventSource API cannot POST or send an
 * Authorization header). Events are handed over the moment their blank-line terminator arrives, so text
 * the server flushes in pieces reaches the caller in pieces.
 */

export interface SseEvent {
  event: string;
  data: unknown;
}

/** Parses one event block ("event: x\ndata: {...}"); null for comments, keep-alives and unreadable data. */
export function parseSseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

export async function readEventStream(body: ReadableStream<Uint8Array>, onEvent: (event: SseEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const parsed = parseSseBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (parsed) onEvent(parsed);
      }
    }
    buffer += decoder.decode();
    const rest = parseSseBlock(buffer.trim());
    if (rest) onEvent(rest);
  } finally {
    // Cancelling an already finished reader is harmless; on an early exit it closes the connection.
    reader.cancel().catch(() => undefined);
  }
}
