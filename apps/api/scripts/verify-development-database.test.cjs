'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertDevelopmentUrls } = require('./verify-development-database.cjs');
const url = 'postgresql://postgres.cluidtctwgxxhybzftft:fixture@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';
test('both datasource identities must be the owner-confirmed Development project', () => {
  assert.equal(assertDevelopmentUrls({ DATABASE_URL: url.replace(':5432/', ':6543/'), DIRECT_URL: url }).length, 2);
  for (const changed of [url.replace('cluidtctwgxxhybzftft', 'otherproject'), url.replace('/postgres', '/other'),
    url + '?host=another-server', url + '?options=unsafe', url + '?schema=other', url.replace('fixture', 'different'), undefined]) {
    assert.throws(() => assertDevelopmentUrls({ DATABASE_URL: url, DIRECT_URL: changed }));
  }
});
