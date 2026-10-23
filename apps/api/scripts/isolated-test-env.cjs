#!/usr/bin/env node
// Runs a command (jest, prisma migrate, ...) against an isolated local *_test database only.
// Usage: node scripts/isolated-test-env.cjs npx jest --runInBand test/integration/sg01-canonical-intake.spec.ts
// Reads apps/api/.env.test.local (git-ignored); see .env.test.example. Values there win over apps/api/.env,
// which is never trusted for tests because it points at the shared Supabase project.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parse } = require('dotenv');

const envFile = path.join(__dirname, '../.env.test.local');
if (!fs.existsSync(envFile)) {
  console.error(`Missing ${envFile}; copy .env.test.example and point it at a local *_test database.`);
  process.exit(2);
}
const fileEnv = parse(fs.readFileSync(envFile));

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  const raw = fileEnv[key];
  if (!raw) { console.error(`${key} is required in .env.test.local`); process.exit(2); }
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!LOCAL_HOSTS.has(url.hostname) || !database.endsWith('_test')) {
    console.error(`${key} must target a local database ending in _test; got ${url.hostname}/${database}`);
    process.exit(2);
  }
}

// Provider keys default to empty/dead so tests can never reach paid or shared services.
const safeDefaults = {
  NODE_ENV: 'test',
  AI_SERVICE_URL: 'http://127.0.0.1:9',
  AI_SERVICE_TIMEOUT_MS: '500',
  EXA_API_KEY: '',
  FIRECRAWL_API_KEY: '',
  GROK_API_KEY: '',
  CLOUDINARY_CLOUD_NAME: '',
  CLOUDINARY_API_KEY: '',
  CLOUDINARY_API_SECRET: '',
  MAPBOX_ACCESS_TOKEN: '',
  FILE_STORAGE_PROVIDER: 'local',
  MEDIA_STORAGE_PROVIDER: 'local',
  ENABLE_AI_IMAGE_GENERATION: 'false',
  ALLOW_UNSCOPED_FULL_SNAPSHOT_DEACTIVATION: 'false',
};
const env = { ...process.env, ...safeDefaults, ...fileEnv };
const target = new URL(env.DATABASE_URL);
console.error(`[isolated-test-env] database=${target.hostname}:${target.port}/${target.pathname.slice(1)} storage=${env.STORAGE_LOCAL_PATH ?? '(default)'}`);

const [command, ...args] = process.argv.slice(2);
if (!command) { console.error('No command given'); process.exit(2); }
const result = spawnSync(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
