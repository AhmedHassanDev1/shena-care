import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

describe('evaluation measurement completion', () => {
  const datasetDirectory = resolve(__dirname, '../../scripts/data/catalog-evaluation-20261115');
  const script = resolve(__dirname, '../../scripts/summarize-catalog-evaluation.cjs');
  const dataset = JSON.parse(readFileSync(join(datasetDirectory, 'dataset.json'), 'utf8'));
  const inputSha256 = createHash('sha256').update(readFileSync(join(datasetDirectory, 'input.csv'))).digest('hex');

  it.each([
    ['PROCESSING', 'PENDING', false], ['PROCESSING', 'DRAFT_CREATED', false], ['COMPLETED', 'PENDING', false], ['COMPLETED', 'UNRESOLVED', true],
  ])('validates job %s with 100 %s rows', (status, outcome, complete) => {
    const directory = mkdtempSync(join(tmpdir(), 'shinacare-evaluation-'));
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !directory.startsWith(join(tmpdir(), 'shinacare-evaluation-'))) throw new Error('Unexpected temporary test directory');
    try {
      writeFileSync(join(directory, 'runtime.json'), JSON.stringify({ inputSha256, job: { status },
        rows: dataset.rows.map((row: { id: string }, index: number) => ({ expectedId: row.id, rowId: String(index), outcome, actual: null })),
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }));
      const result = spawnSync(process.execPath, [script, datasetDirectory, directory], { encoding: 'utf8' });
      if (complete) {
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout).outcomes).toEqual({ UNRESOLVED: 100 });
      } else {
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Evaluation job is incomplete');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
