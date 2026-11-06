// Test setup only: an isolated localhost *_test database seeded from the committed local Policy v14 snapshot. Reads no remote database, writes only the target.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const fromApi = createRequire(path.resolve(__dirname, '../../../apps/api/package.json'));
const { PrismaClient } = fromApi('@prisma/client');
const bcrypt = fromApi('bcrypt');

const url = process.env.DATABASE_URL;
const target = new URL(url);
if (target.hostname !== '127.0.0.1' || !target.pathname.endsWith('_test') || process.env.DIRECT_URL !== url) throw new Error('Refusing: only a localhost *_test database');
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '../policy-v14-local-snapshot.json'), 'utf8'));
const prisma = new PrismaClient({ datasources: { db: { url } } });

// Local-only test login for the Business UI walkthrough (never valid anywhere else).
const ADMIN_EMAIL = 'autopilot-admin@local.test';
const ADMIN_PASSWORD = 'LocalAutopilotOnly!2026';

async function main() {
  for (const brand of snapshot.brands) await prisma.brand.upsert({ where: { id: brand.id }, create: brand, update: {} });
  for (const c of snapshot.categories.filter(c => !c.parentId)) await prisma.category.upsert({ where: { id: c.id }, create: c, update: {} });
  for (const c of snapshot.categories.filter(c => c.parentId)) await prisma.category.upsert({ where: { id: c.id }, create: c, update: {} });
  const admin = await prisma.customer.upsert({ where: { email: ADMIN_EMAIL }, create: { name: 'Autopilot Local Admin', email: ADMIN_EMAIL, roles: ['ADMIN'] }, update: {} });
  await prisma.identity.upsert({ where: { provider_providerId: { provider: 'EMAIL', providerId: ADMIN_EMAIL } },
    create: { customerId: admin.id, provider: 'EMAIL', providerId: ADMIN_EMAIL, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10) }, update: {} });
  await prisma.ingestionEligibilityPolicy.upsert({ where: { version: 14 },
    create: { version: 14, baseVersion: snapshot.policy.baseVersion, status: 'APPROVED', document: snapshot.policy.document, impact: snapshot.policy.impact,
      actorId: admin.id, reason: 'Isolated local mirror of approved Policy v14 (snapshot file)', approvedAt: new Date() }, update: {} });
  const token = crypto.randomUUID();
  await prisma.session.create({ data: { customerId: admin.id, token, expiresAt: new Date(Date.now() + 8 * 3600_000) } });
  fs.writeFileSync(path.join(__dirname, '.session'), token);
  console.log(JSON.stringify({ database: target.pathname.slice(1), policyVersion: 14, brands: snapshot.brands.length, categories: snapshot.categories.length, adminId: admin.id,
    products: await prisma.product.count(), offers: await prisma.supplierOffer.count() }));
}
main().finally(() => prisma.$disconnect());
