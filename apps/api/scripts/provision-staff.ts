/**
 * Business Workspace staff provisioning (C0). Creates, updates, disables, or reactivates staff accounts;
 * there is no HTTP route that grants roles without admin auth, and role escalation is strictly bounded.
 *
 * Provisioning:
 *   STAFF_PASSWORD='…' npm run staff:provision -- --email founder@example.com --name "Founder" --role ADMIN
 *   STAFF_PASSWORD='…' npm run staff:provision -- --email hub@… --name "Hub 1" --role HUB_OPERATOR --hub "Maadi Pharmacy Hub"
 *   STAFF_PASSWORD='…' npm run staff:provision -- --email sup@… --name "Supplier" --role SUPPLIER --supplier official-distributor
 *   STAFF_PASSWORD='…' npm run staff:provision -- --email drv@… --name "Driver" --role DRIVER
 *
 * Lifecycle management:
 *   npm run staff:provision -- --email drv@… --disable
 *   npm run staff:provision -- --email drv@… --reactivate
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const ROLES: Role[] = ['ADMIN', 'HUB_OPERATOR', 'SUPPLIER', 'DRIVER'];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function fail(message: string): never {
  console.error(`provision-staff: ${message}`);
  process.exit(1);
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  if (!email) fail('--email is required');

  const url = process.env.DATABASE_URL ?? fail('DATABASE_URL is not set');
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !hasFlag('allow-remote')) {
    fail(`refusing to write to remote database host ${host} without --allow-remote`);
  }

  const prisma = new PrismaClient();
  try {
    const isDisable = hasFlag('disable') || hasFlag('deactivate');
    const isReactivate = hasFlag('reactivate') || hasFlag('enable');

    // 1. Disable flow
    if (isDisable) {
      const existing = await prisma.customer.findUnique({ where: { email } });
      if (!existing) fail(`Staff account with email ${email} not found`);

      // Guard: Founder-only Admin preservation
      if (existing.roles.includes('ADMIN')) {
        const activeAdmins = await prisma.customer.count({ where: { roles: { has: 'ADMIN' }, isActive: true } });
        if (activeAdmins <= 1) {
          fail('Cannot deactivate the last remaining active Admin (Founder-only Admin preservation)');
        }
      }

      // Guard: Driver active physical custody
      if (existing.roles.includes('DRIVER')) {
        const activeBatch = await prisma.deliveryBatch.findFirst({
          where: { driverId: existing.id, status: { in: ['dispatched', 'in_progress'] } },
        });
        if (activeBatch) {
          fail(`Cannot disable driver: driver currently holds active delivery batch ${activeBatch.id}. Never silently reassign physical custody.`);
        }
        const activeStop = await prisma.deliveryStop.findFirst({
          where: { batch: { driverId: existing.id }, status: 'active' },
        });
        if (activeStop) {
          fail(`Cannot disable driver: driver currently holds active delivery stop ${activeStop.id}. Complete or return the package first.`);
        }
        const unSettledCash = await prisma.paymentCollection.findFirst({
          where: { courierId: existing.id, status: 'collected' },
        });
        if (unSettledCash) {
          fail(`Cannot disable driver: driver holds collected cash for order ${unSettledCash.orderId}. Settle collection first.`);
        }
      }

      await prisma.$transaction(async tx => {
        await tx.customer.update({ where: { id: existing.id }, data: { isActive: false } });
        await tx.session.updateMany({ where: { customerId: existing.id, isValid: true }, data: { isValid: false } });
      });

      console.log(`Deactivated staff account ${email} (${existing.id}) and revoked all active sessions.`);
      return;
    }

    // 2. Reactivate flow
    if (isReactivate) {
      const existing = await prisma.customer.findUnique({ where: { email } });
      if (!existing) fail(`Staff account with email ${email} not found`);

      await prisma.customer.update({ where: { id: existing.id }, data: { isActive: true } });
      console.log(`Reactivated staff account ${email} (${existing.id}).`);
      return;
    }

    // 3. Provision / Update flow
    const name = arg('name')?.trim();
    const role = arg('role') as Role | undefined;
    const password = process.env.STAFF_PASSWORD;

    if (!name || !role) fail('--email, --name and --role are required to provision an account');
    if (!ROLES.includes(role)) fail(`--role must be one of ${ROLES.join(', ')}`);

    const supplierSlug = arg('supplier');
    const supplier = supplierSlug ? await prisma.supplier.findUnique({ where: { slug: supplierSlug } }) : null;
    if (role === 'SUPPLIER' && !supplier) fail('a SUPPLIER account needs --supplier <existing supplier slug>');

    const account = await prisma.$transaction(async tx => {
      const existing = await tx.identity.findUnique({
        where: { provider_providerId: { provider: 'EMAIL', providerId: email } },
        include: { customer: true },
      });

      if (existing) {
        if (password) {
          if (password.length < 12) fail('STAFF_PASSWORD must be 12+ characters');
          const passwordHash = await bcrypt.hash(password, 12);
          await tx.identity.update({ where: { id: existing.id }, data: { passwordHash } });
        }
        // Invalidate sessions on role change
        await tx.session.updateMany({ where: { customerId: existing.customerId, isValid: true }, data: { isValid: false } });
        return tx.customer.update({
          where: { id: existing.customerId },
          data: { name, roles: [role], supplierId: supplier?.id ?? null, isActive: true },
        });
      }

      if (!password || password.length < 12) fail('STAFF_PASSWORD must be set (12+ characters) to create a new staff account');
      const passwordHash = await bcrypt.hash(password, 12);
      return tx.customer.create({
        data: {
          name,
          email,
          roles: [role],
          supplierId: supplier?.id ?? null,
          isActive: true,
          identities: { create: { provider: 'EMAIL', providerId: email, passwordHash } },
        },
      });
    });

    const hubName = arg('hub');
    if (hubName) {
      if (role !== 'HUB_OPERATOR') fail('--hub only applies to HUB_OPERATOR accounts');
      const hub = await prisma.fulfillmentLocation.upsert({
        where: { name: hubName },
        update: {},
        create: { name: hubName, address: arg('hub-address') ?? fail('--hub-address is required to create a new hub') },
      });
      await prisma.fulfillmentLocationOperator.upsert({
        where: { locationId_operatorId: { locationId: hub.id, operatorId: account.id } },
        update: {},
        create: { locationId: hub.id, operatorId: account.id },
      });
      console.log(`assigned to hub ${hub.name} (${hub.id})`);
    }

    console.log(`${role} ${email} → ${account.id} (isActive: true)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
