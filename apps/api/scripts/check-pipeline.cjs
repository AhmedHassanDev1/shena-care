const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const envPath = process.env.PIPELINE_ENV_FILE;
if (!envPath) throw new Error('PIPELINE_ENV_FILE must point to the existing API configuration');
const configured = dotenv.parse(fs.readFileSync(envPath));
const sourceUrl = configured.DATABASE_URL;
if (!sourceUrl) throw new Error('DATABASE_URL missing');
const env = { ...configured, ...process.env, NODE_ENV: 'test', TEST_BYPASS_AUTH: 'false' };
const mode = process.argv[2];
if (mode !== 'pilot') {
  const url = new URL(sourceUrl);
  const databaseName = process.env.PIPELINE_TEST_DATABASE || 'shenacare_pipeline_test';
  if (!/^[a-z][a-z0-9_]*_test$/.test(databaseName)) throw new Error('Dedicated *_test database required');
  url.pathname = '/' + databaseName;
  env.DATABASE_URL = url.toString();
  env.STORAGE_LOCAL_PATH = path.resolve('scratch/pipeline-test-storage');
  env.AI_ENABLED = 'false';
} else {
  env.DATABASE_URL = sourceUrl;
  env.STORAGE_LOCAL_PATH = path.join(path.dirname(envPath), 'uploads');
}
let args;
if (mode === 'test') args = [require.resolve('jest/bin/jest'), '--runInBand', '--runTestsByPath', ...(process.argv.slice(3).length ? process.argv.slice(3) : ['test/integration/glo-123-media-upload.e2e-spec.ts'])];
else if (mode === 'migrations') args = [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'];
else if (mode === 'status') args = [require.resolve('prisma/build/index.js'), 'migrate', 'status'];
else if (mode === 'migration-verification') args = ['scripts/verify-pipeline-migrations.cjs'];
else if (mode === 'pilot') args = ['-r', 'ts-node/register', 'scripts/verify-glo78.ts', ...process.argv.slice(3)];
else throw new Error('Unsupported pipeline check');
if (env.PIPELINE_PRISMA_CLIENT) args.unshift('-r', path.resolve('scripts/prisma-test-client.cjs'));
const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
// Keep configured secrets out of process errors and third-party CLI output.
let output = (result.stdout || '') + (result.stderr || '');
for (const [key, value] of Object.entries(configured)) {
  if (/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(key) && value) output = output.split(value).join('[redacted]');
}
const dbUrl = new URL(sourceUrl);
for (const value of [dbUrl.password, decodeURIComponent(dbUrl.password)]) if (value) output = output.split(value).join('[redacted]');
process.stdout.write(output);
process.exit(result.status ?? 1);
