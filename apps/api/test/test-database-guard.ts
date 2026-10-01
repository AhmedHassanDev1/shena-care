import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'dotenv';

const envPath = path.join(__dirname, '../.env');
const databaseUrl = process.env.DATABASE_URL ||
  (fs.existsSync(envPath) ? parse(fs.readFileSync(envPath)).DATABASE_URL : undefined);
if (!databaseUrl) throw new Error('API tests require DATABASE_URL for a dedicated test database');

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.endsWith('_test')) {
  throw new Error(`API tests require a database ending in _test; received ${databaseName}`);
}

import { PrismaClient } from '@prisma/client';

beforeAll(async () => {
  if (process.env.TEST_BYPASS_AUTH === 'true') {
    const prisma = new PrismaClient();
    try {
      const existing = await prisma.customer.findUnique({ where: { id: '343f1cb1-0b53-4876-90e8-07e1bf1f8d42' } });
      if (!existing) {
        await prisma.customer.create({
          data: {
            id: '343f1cb1-0b53-4876-90e8-07e1bf1f8d42',
            name: 'Test Bypass User',
            email: 'testbypass' + Date.now() + '@example.com',
            roles: ['CUSTOMER', 'ADMIN', 'HUB_OPERATOR', 'SUPPLIER']
          }
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  }
});
