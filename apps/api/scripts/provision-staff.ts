/**
 * Business Workspace staff provisioning (C0). Creates or updates one staff account; there is no HTTP
 * route that grants roles, so role escalation is an operator action, not an API surface.
 *
 *   STAFF_PASSWORD='…' npm run staff:provision -- --email founder@example.com --name "Founder" --role ADMIN
 *   STAFF_PASSWORD='…' npm run staff:provision -- --email hub@… --name "Hub 1" --role HUB_OPERATOR --hub "Maadi Pharmacy Hub"
 *   STAFF_PASSWORD='…' npm run staff:provision -- --email sup@… --name "Supplier" --role SUPPLIER --supplier official-distributor
 *   STAFF_PASSWORD='…' npm run staff:provision -- --email drv@… --name "Driver" --role DRIVER
 *
 *   … --phone 01012345678   also lets the account sign in with a phone code (an Egyptian mobile number)
 *
 * The password is read from STAFF_PASSWORD (never argv, so it stays out of shell history and process
 * lists). `--hub` assigns the operator to a hub by name, creating the hub with `--hub-address` if
 * missing. Refuses non-local databases unless `--allow-remote` is given.
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { normalizeEgyptianMobile } from '../src/modules/accounts/phone';

const ROLES: Role[] = ['ADMIN', 'HUB_OPERATOR', 'SUPPLIER', 'DRIVER'];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message: string): never {
  console.error(`provision-staff: ${message}`);
  process.exit(1);
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name')?.trim();
  const role = arg('role') as Role | undefined;
  const password = process.env.STAFF_PASSWORD;
  if (!email || !name || !role) fail('--email, --name and --role are required');
  if (!ROLES.includes(role)) fail(`--role must be one of ${ROLES.join(', ')}`);
  if (!password || password.length < 12) fail('STAFF_PASSWORD must be set (12+ characters)');

  const url = process.env.DATABASE_URL ?? fail('DATABASE_URL is not set');
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.argv.includes('--allow-remote')) {
    fail(`refusing to write to remote database host ${host} without --allow-remote`);
  }

  const phoneArg = arg('phone');
  const phone = phoneArg ? normalizeEgyptianMobile(phoneArg) : null;
  if (phoneArg && !phone) fail('--phone must be an Egyptian mobile number (010/011/012/015…)');

  const prisma = new PrismaClient();
  try {
    const supplierSlug = arg('supplier');
    const supplier = supplierSlug ? await prisma.supplier.findUnique({ where: { slug: supplierSlug } }) : null;
    if (role === 'SUPPLIER' && !supplier) fail('a SUPPLIER account needs --supplier <existing supplier slug>');

    const passwordHash = await bcrypt.hash(password, 12);
    const account = await prisma.$transaction(async tx => {
      const existing = await tx.identity.findUnique({ where: { provider_providerId: { provider: 'EMAIL', providerId: email } }, include: { customer: true } });
      if (existing) {
        await tx.identity.update({ where: { id: existing.id }, data: { passwordHash } });
        return tx.customer.update({
          where: { id: existing.customerId },
          data: { name, roles: [role], supplierId: supplier?.id ?? null },
        });
      }
      return tx.customer.create({ data: {
        name, email, roles: [role], supplierId: supplier?.id ?? null,
        identities: { create: { provider: 'EMAIL', providerId: email, passwordHash } },
      } });
    });

    if (phone) {
      const holder = await prisma.identity.findUnique({ where: { provider_providerId: { provider: 'PHONE', providerId: phone } } });
      if (holder && holder.customerId !== account.id) fail('that phone number already belongs to another account');
      if (!holder) await prisma.identity.create({ data: { customerId: account.id, provider: 'PHONE', providerId: phone } });
      console.log(`phone sign-in enabled for ${phone.slice(0, 5)}*****`);
    }

    const hubName = arg('hub');
    if (hubName) {
      if (role !== 'HUB_OPERATOR') fail('--hub only applies to HUB_OPERATOR accounts');
      const hub = await prisma.fulfillmentLocation.upsert({
        where: { name: hubName }, update: {},
        create: { name: hubName, address: arg('hub-address') ?? fail('--hub-address is required to create a new hub') },
      });
      await prisma.fulfillmentLocationOperator.upsert({
        where: { locationId_operatorId: { locationId: hub.id, operatorId: account.id } }, update: {},
        create: { locationId: hub.id, operatorId: account.id },
      });
      console.log(`assigned to hub ${hub.name} (${hub.id})`);
    }
    console.log(`${role} ${email} → ${account.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
