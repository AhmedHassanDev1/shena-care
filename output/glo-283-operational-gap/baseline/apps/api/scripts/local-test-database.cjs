'use strict';

/** Run before dotenv, Prisma, tests or migrations; never fall back to a repository .env. */
function assertLocalTestDatabase(env) {
  const fail = () => { throw new Error('Both explicit datasource URLs must match the same localhost PostgreSQL _test database'); };
  if (!env.DATABASE_URL || !env.DIRECT_URL || env.DATABASE_URL !== env.DIRECT_URL) fail();
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { fail(); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !/^\/[A-Za-z0-9_]+_test$/.test(url.pathname) ||
      ['host', 'hostaddr', 'service'].some(key => url.searchParams.has(key))) fail();
}
module.exports = { assertLocalTestDatabase };

if (require.main === module) {
  try {
    assertLocalTestDatabase(process.env);
    const args = process.argv.slice(2).filter((value, index) => index !== 0 || value !== '--');
    if (!args.length) console.log('Local test database preflight passed');
    else {
      const result = require('node:child_process').spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
      process.exitCode = result.status ?? 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
