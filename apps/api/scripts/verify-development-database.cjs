'use strict';
// Owner-confirmed Development only. This script does not deploy migrations.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { parse } = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const { assertLocalTestDatabase } = require('./local-test-database.cjs');
const PROJECT = 'cluidtctwgxxhybzftft';
const SCHEMAS = ['accounts', 'care', 'catalog', 'commerce', 'fulfillment', 'ingestion', 'operations', 'ordering', 'sourcing', 'public'];
const CONTAINER = 'shenacare-postgres-test';
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const hash = value => createHash('sha256').update(value).digest('hex');

function assertDevelopmentUrls(config) {
  const urls = ['DATABASE_URL', 'DIRECT_URL'].map(key => {
    const url = new URL(config[key]);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/postgres' ||
        !((url.hostname === 'db.' + PROJECT + '.supabase.co' && decodeURIComponent(url.username) === 'postgres') ||
          (url.hostname === 'aws-0-eu-west-1.pooler.supabase.com' && decodeURIComponent(url.username) === 'postgres.' + PROJECT)) ||
        !['5432', '6543'].includes(url.port || '5432') ||
        [...url.searchParams.keys()].some(key => !['schema', 'pgbouncer', 'connection_limit', 'pool_timeout', 'sslmode', 'connect_timeout'].includes(key)) ||
        (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public') ||
        /[\r\n]/.test(decodeURIComponent(url.username) + decodeURIComponent(url.password))) {
      throw new Error('Development datasource identity mismatch');
    }
    return url;
  });
  if (decodeURIComponent(urls[0].password) !== decodeURIComponent(urls[1].password)) throw new Error('Datasource credential mismatch');
  return urls;
}

function developmentUrls() {
  return assertDevelopmentUrls(parse(fs.readFileSync(path.join(__dirname, '../.env'))));
}

async function snapshot(prisma, originalColumns) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '30000ms'`;
    const tables = await tx.$queryRaw`SELECT schemaname, tablename FROM pg_tables
      WHERE schemaname IN ('accounts','care','catalog','commerce','fulfillment','ingestion','operations','ordering','sourcing','public')
      ORDER BY schemaname, tablename`;
    const columnRows = await tx.$queryRaw`SELECT table_schema, table_name, column_name FROM information_schema.columns
      WHERE table_schema IN ('accounts','care','catalog','commerce','fulfillment','ingestion','operations','ordering','sourcing','public')
      ORDER BY table_schema, table_name, ordinal_position`;
    const columns = {};
    for (const row of columnRows) (columns[row.table_schema + '.' + row.table_name] ??= []).push(row.column_name);
    const data = {};
    for (const table of tables) {
      const name = table.schemaname + '.' + table.tablename;
      if (originalColumns && !originalColumns[name]) continue;
      const projection = (originalColumns?.[name] ?? columns[name]).map(quote).join(', ');
      // Identifiers come from pg_catalog and are quoted; no input SQL is accepted.
      const rows = await tx.$queryRawUnsafe('SELECT count(*)::text AS count, md5(coalesce(string_agg(digest, \'\' ORDER BY digest), \'\')) AS digest FROM (SELECT md5(row_to_json(t)::text) AS digest FROM (SELECT ' + projection + ' FROM ' + quote(table.schemaname) + '.' + quote(table.tablename) + ') t) x');
      data[name] = rows[0];
    }
    const history = await tx.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY migration_name`;
    return { data, history, columns };
  }, { timeout: 120000, maxWait: 10000 });
}

async function main() {
  assertLocalTestDatabase(process.env);
  const [, direct] = developmentUrls();
  const dir = path.resolve(__dirname, '../../../.codex/qa-logs/glo-283-20261101/development-backup');
  fs.mkdirSync(dir, { recursive: true });
  const prisma = new PrismaClient({ datasources: { db: { url: direct.href } }, log: [] });
  try {
    const before = await snapshot(prisma);
    const migrations = path.join(__dirname, '../prisma/migrations');
    const applied = new Set();
    for (const migration of before.history) {
      const sql = path.join(migrations, migration.migration_name, 'migration.sql');
      if (!migration.finished_at || migration.rolled_back_at || !fs.existsSync(sql) || hash(fs.readFileSync(sql)) !== migration.checksum) {
        throw new Error('Migration history mismatch: ' + migration.migration_name);
      }
      applied.add(migration.migration_name);
    }
    const pending = fs.readdirSync(migrations, { withFileTypes: true }).filter(d => d.isDirectory() && !applied.has(d.name)).map(d => ({ name: d.name, sha256: hash(fs.readFileSync(path.join(migrations, d.name, 'migration.sql'))) }));
    console.log(JSON.stringify({ project: PROJECT, database: 'postgres', bothUrlsValidated: true, applied: applied.size, tables: Object.keys(before.data).length, pending }, null, 2));
    if (process.argv[2] !== 'backup') return;
    if (fs.existsSync(path.join(dir, 'before.json')) || fs.existsSync(path.join(dir, 'development-app-schemas.dump'))) {
      throw new Error('Backup destination already contains evidence; preserve it and choose a new audited destination');
    }
    fs.writeFileSync(path.join(dir, 'before.json'), JSON.stringify({ project: PROJECT, ...before, pending }, null, 2), { flag: 'wx' });
    const fixedCommand = 'IFS= read -r PGHOST; IFS= read -r PGPORT; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; IFS= read -r PGDATABASE; export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE; export PGSSLMODE=require PGCONNECT_TIMEOUT=20; exec pg_dump --format=custom --no-owner --no-privileges ' + SCHEMAS.map(s => '--schema=' + s).join(' ');
    const input = [direct.hostname, direct.port || '5432', decodeURIComponent(direct.username), decodeURIComponent(direct.password), 'postgres'].join('\n') + '\n';
    const dump = spawnSync('docker', ['exec', '-i', CONTAINER, 'sh', '-c', fixedCommand], { input, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
    if (dump.status !== 0) throw new Error('pg_dump failed; no remote writes performed');
    const archive = path.join(dir, 'development-app-schemas.dump');
    fs.writeFileSync(archive, dump.stdout, { flag: 'wx' });
    const after = await snapshot(prisma);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Database changed during backup; backup must be repeated before deployment');
    fs.writeFileSync(path.join(dir, 'archive.json'), JSON.stringify({ project: PROJECT, scope: SCHEMAS, bytes: dump.stdout.length, sha256: hash(dump.stdout), consistentBeforeAfter: true }, null, 2));
    console.log('Application schemas and migration registry archived; restore verification is still required');
  } finally { await prisma.$disconnect(); }
}
module.exports = { assertDevelopmentUrls, developmentUrls, snapshot };
if (require.main === module) main().catch(error => {
  console.error(/^(Development datasource|Datasource credential|Migration history|pg_dump|Database changed|Backup destination)/.test(error.message) ? error.message : 'Development verification blocked (' + (error.code || error.name) + ')');
  process.exitCode = 1;
});
