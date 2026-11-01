const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertLocalTestDatabase } = require('./local-test-database.cjs');

const local = 'postgresql://test:test@127.0.0.1:5434/glo283_closure_test';
test('requires explicit matching localhost test datasources', () => {
  assert.doesNotThrow(() => assertLocalTestDatabase({ DATABASE_URL: local, DIRECT_URL: local }));
  for (const env of [
    {}, { DATABASE_URL: local }, { DATABASE_URL: local, DIRECT_URL: 'postgresql://secret:password@remote.example/app_test' },
    { DATABASE_URL: local, DIRECT_URL: local.replace('closure_test', 'other_test') },
    { DATABASE_URL: local.replace('_test', ''), DIRECT_URL: local.replace('_test', '') },
    { DATABASE_URL: local + '?host=remote.example', DIRECT_URL: local + '?host=remote.example' },
  ]) assert.throws(() => assertLocalTestDatabase(env), /localhost.*_test/);
});
test('errors never echo credentials', () => {
  assert.throws(() => assertLocalTestDatabase({ DATABASE_URL: 'postgresql://sensitive:password@remote/app_test' }), error =>
    !error.message.includes('sensitive') && !error.message.includes('password'));
});
