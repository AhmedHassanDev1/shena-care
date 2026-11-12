const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../apps/api/.env'), quiet: true });
process.env.TS_NODE_PROJECT = path.join(__dirname, '../../apps/api/tsconfig.json');
require('ts-node/register/transpile-only');
const request = require('supertest');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../apps/api/src/app.module');

async function main() {
  if (process.env.NODE_ENV !== 'development' || new URL(process.env.DATABASE_URL).hostname !== 'aws-0-eu-west-1.pooler.supabase.com') {
    throw new Error('Expected the recorded development database');
  }
  const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'enrichment-after.json'), 'utf8')).products;
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.init();
  try {
    const rows = [];
    for (const product of products) {
      const response = await request(app.getHttpServer()).get(`/products/${encodeURIComponent(product.slug)}`);
      const body = response.body;
      rows.push({ id: product.id, slug: product.slug, status: response.status,
        returnedId: body.id ?? null, name: body.name ?? null,
        usagePresent: !!body.usage, warningsPresent: !!body.warnings,
        bodyKeys: Object.keys(body).sort(), error: response.status === 200 ? undefined : body.message });
    }
    fs.writeFileSync(path.join(__dirname, 'enrichment-api-readback.json'), JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
    for (const row of rows) console.log(JSON.stringify(row));
    if (rows.some(row => row.status !== 200)) process.exitCode = 1;
  } finally { await app.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
