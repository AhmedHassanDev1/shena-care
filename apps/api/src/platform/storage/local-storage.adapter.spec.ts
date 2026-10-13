import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { LocalStorageAdapter } from './local-storage.adapter';

describe('Local storage failure and retry', () => {
  let root: string;
  let previous: string | undefined;
  let storage: LocalStorageAdapter;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'shina-storage-'));
    previous = process.env.STORAGE_LOCAL_PATH;
    process.env.STORAGE_LOCAL_PATH = root;
    storage = new LocalStorageAdapter();
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.STORAGE_LOCAL_PATH; else process.env.STORAGE_LOCAL_PATH = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects an interrupted upload without leaving a partial object, then retries successfully', async () => {
    const source = Readable.from((async function* () { yield Buffer.from('partial'); throw new Error('Fixture read failure'); })());
    await expect(storage.put('public/media/retry.png', source)).rejects.toThrow('Fixture read failure');
    expect(await storage.exists('public/media/retry.png')).toBe(false);
    expect(fs.readdirSync(path.join(root, 'public/media'))).toEqual([]);
    await storage.put('public/media/retry.png', Buffer.from('complete'));
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.readStream('public/media/retry.png')) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('complete');
  });
});
