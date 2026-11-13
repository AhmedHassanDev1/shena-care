import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { cutOutProduct } from '../../src/platform/storage/product-compositor';

jest.mock('child_process', () => ({ execFileSync: jest.fn(), execFile: jest.fn() }));

describe('neural cutout authenticity', () => {
  afterEach(() => jest.resetAllMocks());

  it('refuses a failed enhancement so the caller keeps the authentic white original', async () => {
    jest.mocked(childProcess.execFile).mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error) => void;
      queueMicrotask(() => callback(new Error('MODEL_PROCESS_FAILED')));
      return {} as childProcess.ChildProcess;
    });
    const environment = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const source = fs.readFileSync(path.join(__dirname, '../fixtures/media/capixy-hydrating-conditioner-250ml.png'));
      await expect(cutOutProduct(source, { engine: 'auto' })).rejects.toThrow('NEURAL_SEGMENTATION_FAILED');
      expect(childProcess.execFileSync).not.toHaveBeenCalled();
      expect(childProcess.execFile).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ timeout: 60000 }), expect.any(Function));
    } finally {
      process.env.NODE_ENV = environment;
    }
  });

  it('admits one neural process at a time so concurrent requests cannot multiply model memory', async () => {
    let started!: () => void;
    let finish!: (error: Error) => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    jest.mocked(childProcess.execFile).mockImplementation((...args: unknown[]) => {
      finish = args.at(-1) as (error: Error) => void;
      started();
      return {} as childProcess.ChildProcess;
    });
    const input = fs.readFileSync(path.join(__dirname, '../fixtures/media/capixy-hydrating-conditioner-250ml.png'));
    const first = expect(cutOutProduct(input, { engine: 'neural' })).rejects.toThrow('NEURAL_SEGMENTATION_FAILED');
    await running;
    await expect(cutOutProduct(input, { engine: 'neural' })).rejects.toThrow('NEURAL_SEGMENTATION_FAILED');
    expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    finish(new Error('MODEL_TIMEOUT'));
    await first;
  });
  it.each([255, 60])('uses only neural alpha, preserving original packaging RGB on background %s', async background => {
    const width = 400; const height = 400;
    const source = Buffer.alloc(width * height * 4);
    const prediction = Buffer.alloc(source.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const pack = x >= 120 && x < 280 && y >= 50 && y < 350;
      source[i] = pack ? 247 : background; source[i + 1] = pack ? 242 : background; source[i + 2] = pack ? 239 : background; source[i + 3] = 255;
      prediction[i] = 10; prediction[i + 1] = 20; prediction[i + 2] = 30; prediction[i + 3] = pack ? 255 : 0;
    }
    const png = await sharp(prediction, { raw: { width, height, channels: 4 } }).png().toBuffer();
    jest.mocked(childProcess.execFile).mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
      queueMicrotask(() => { fs.writeFileSync((args[1] as string[])[2], png); callback(null, '', ''); });
      return {} as childProcess.ChildProcess;
    });
    const input = await sharp(source, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const cut = await cutOutProduct(input, { engine: 'neural' });
    expect([cut.width, cut.height]).toEqual([160, 300]);
    const middle = (150 * cut.width + 80) * 4;
    expect([...cut.rgba.subarray(middle, middle + 4)]).toEqual([247, 242, 239, 255]);
  });
});


