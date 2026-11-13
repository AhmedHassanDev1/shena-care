/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { composeOnTemplate } from '../src/platform/storage/product-compositor';

const names = process.argv.slice(2);
if (!names.length) throw new Error('Give authentic local source image paths');
const output = path.resolve(process.env.IMAGE_VALIDATION_OUTPUT ?? '../../output/catalog-blockers-real-2026-11-13/images');
fs.mkdirSync(output, { recursive: true });
const template = fs.readFileSync(path.resolve(__dirname, '../assets/media-templates/catalog-approved-v1.png'));
const rules = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../assets/media-templates/catalog-approved.rules.json'), 'utf8'));
const records: unknown[] = [];
(async () => {
  for (const source of names) {
    const original = fs.readFileSync(source);
    const hash = createHash('sha256').update(original).digest('hex');
    let ticks = 0;
    const heartbeat = setInterval(() => ticks++, 100);
    const started = Date.now();
    try {
      const result = await composeOnTemplate(original, template, rules, { engine: 'neural' });
      const name = path.parse(source).name;
      fs.writeFileSync(path.join(output, `${name}-live.webp`), result.buffer);
      if (createHash('sha256').update(fs.readFileSync(source)).digest('hex') !== hash) throw new Error('ORIGINAL_WAS_MODIFIED');
      const record = { source: path.basename(source), originalSha256: hash, durationMs: Date.now() - started, eventLoopTicks: ticks, report: result.report };
      records.push(record); console.log(JSON.stringify(record));
    } catch (error) {
      records.push({ source: path.basename(source), durationMs: Date.now() - started, eventLoopTicks: ticks, error: error instanceof Error ? error.message : 'FAILED' });
      process.exitCode = 1;
    } finally {
      clearInterval(heartbeat);
      fs.writeFileSync(path.join(output, 'live-image-results.json'), JSON.stringify(records, null, 2));
    }
  }
})();
