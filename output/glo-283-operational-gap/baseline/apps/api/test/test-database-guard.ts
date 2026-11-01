import { assertLocalTestDatabase } from '../scripts/local-test-database.cjs';

assertLocalTestDatabase(process.env);

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
