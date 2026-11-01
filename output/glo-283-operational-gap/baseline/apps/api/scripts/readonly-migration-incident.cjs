'use strict';
// Fixed read-only metadata inspection of the previously affected Supabase database.
// It never loads remote credentials into process.env or invokes Prisma migrations.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parse } = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const { assertLocalTestDatabase } = require('./local-test-database.cjs');

async function main() {
  assertLocalTestDatabase(process.env);
  const config = parse(fs.readFileSync(path.join(__dirname, '../.env')));
  const target = new URL(config.DIRECT_URL);
  if (!target.hostname.endsWith('.supabase.com')) throw new Error('Unexpected incident datasource');
  const migration = '20261026090000_routine_phase1_individual';
  const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations', migration, 'migration.sql'));
  const localChecksum = createHash('sha256').update(sql).digest('hex');
  const prisma = new PrismaClient({ datasources: { db: { url: target.href } }, log: [] });
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '8000ms'`;
      const mode = await tx.$queryRaw`SELECT current_database() AS database, current_setting('transaction_read_only') AS read_only`;
      const history = await tx.$queryRaw`SELECT migration_name, finished_at, rolled_back_at, checksum
        FROM public._prisma_migrations WHERE migration_name = ${migration}`;
      const tables = await tx.$queryRaw`SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'care' AND table_name IN ('routine_blueprints', 'blueprint_roles',
        'product_role_eligibility', 'ingredient_rules', 'care_safety_flags', 'customer_routines',
        'customer_routine_items', 'customer_routine_versions') ORDER BY table_name`;
      return { mode, history: history.map(row => ({ migration_name: row.migration_name,
        finished_at: row.finished_at, rolled_back_at: row.rolled_back_at, checksumMatchesLocal: row.checksum === localChecksum })), tables };
    }, { timeout: 15000, maxWait: 5000 });
    console.log(JSON.stringify({ host: target.hostname, ...result }, null, 2));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(`Read-only incident verification unavailable (${error.code || error.name}); no write or rollback attempted`); process.exitCode = 1; });
