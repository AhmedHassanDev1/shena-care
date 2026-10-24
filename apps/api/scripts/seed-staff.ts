/**
 * Seeds or updates the approved staff accounts from STAFF_CREDENTIALS.md
 * 
 * Accounts seeded:
 * 1. Admin: admin@shenacare.com / ShinaCare@2026Admin!
 * 2. Hub Operator: hub@shenacare.com / ShinaCare@2026Hub! (Maadi Pharmacy Hub)
 * 3. Supplier: supplier@shenacare.com / ShinaCare@2026Supplier! (official-distributor)
 * 4. Driver: driver@shenacare.com / ShinaCare@2026Driver!
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const STAFF_ACCOUNTS = [
  {
    name: 'System Admin',
    email: 'admin@shenacare.com',
    password: 'ShinaCare@2026Admin!',
    role: Role.ADMIN,
  },
  {
    name: 'Hub Operator',
    email: 'hub@shenacare.com',
    password: 'ShinaCare@2026Hub!',
    role: Role.HUB_OPERATOR,
    hubName: 'Maadi Pharmacy Hub',
    hubAddress: 'Maadi, Cairo, Egypt',
  },
  {
    name: 'Official Supplier',
    email: 'supplier@shenacare.com',
    password: 'ShinaCare@2026Supplier!',
    role: Role.SUPPLIER,
    supplierSlug: 'official-distributor',
  },
  {
    name: 'Delivery Driver',
    email: 'driver@shenacare.com',
    password: 'ShinaCare@2026Driver!',
    role: Role.DRIVER,
  },
];

async function seedStaff() {
  // These passwords are public dev fixtures; real staff are created with `npm run staff:provision` and STAFF_PASSWORD.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-staff uses well-known dev passwords and refuses to run with NODE_ENV=production');
  }
  const prisma = new PrismaClient();
  console.log('Seeding approved Business Workspace staff credentials...');

  try {
    for (const acc of STAFF_ACCOUNTS) {
      const passwordHash = await bcrypt.hash(acc.password, 12);

      // Check supplier if needed
      let supplierId: string | null = null;
      if (acc.supplierSlug) {
        const supplier = await prisma.supplier.findUnique({ where: { slug: acc.supplierSlug } });
        if (supplier) {
          supplierId = supplier.id;
        } else {
          // If default supplier doesn't exist yet, create it
          const created = await prisma.supplier.create({
            data: {
              name: 'Official Distributor',
              slug: acc.supplierSlug,
              isActive: true,
            },
          });
          supplierId = created.id;
        }
      }

      // Upsert customer
      let customer = await prisma.customer.findUnique({
        where: { email: acc.email },
        include: { identities: true },
      });

      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            name: acc.name,
            email: acc.email,
            roles: [acc.role],
            supplierId,
            isActive: true,
            identities: {
              create: {
                provider: 'EMAIL',
                providerId: acc.email,
                passwordHash,
              },
            },
          },
          include: { identities: true },
        });
        console.log(`✓ Created staff account: ${acc.email} (${acc.role})`);
      } else {
        // Update customer role, status, and supplierId
        customer = await prisma.customer.update({
          where: { id: customer.id },
          data: {
            name: acc.name,
            roles: [acc.role],
            supplierId,
            isActive: true,
          },
          include: { identities: true },
        });

        // Upsert identity
        const emailIdentity = customer.identities.find(
          (i) => i.provider === 'EMAIL' && i.providerId === acc.email,
        );

        if (emailIdentity) {
          await prisma.identity.update({
            where: { id: emailIdentity.id },
            data: { passwordHash },
          });
        } else {
          await prisma.identity.create({
            data: {
              customerId: customer.id,
              provider: 'EMAIL',
              providerId: acc.email,
              passwordHash,
            },
          });
        }
        console.log(`✓ Updated staff credentials: ${acc.email} (${acc.role})`);
      }

      // Invalidate existing sessions so fresh login uses new credentials
      await prisma.session.updateMany({
        where: { customerId: customer.id, isValid: true },
        data: { isValid: false },
      });

      // Handle Hub assignment for HUB_OPERATOR
      if (acc.hubName) {
        const hub = await prisma.fulfillmentLocation.upsert({
          where: { name: acc.hubName },
          update: {},
          create: {
            name: acc.hubName,
            address: acc.hubAddress ?? 'Cairo, Egypt',
            isActive: true,
          },
        });

        await prisma.fulfillmentLocationOperator.upsert({
          where: {
            locationId_operatorId: {
              locationId: hub.id,
              operatorId: customer.id,
            },
          },
          update: {},
          create: {
            locationId: hub.id,
            operatorId: customer.id,
          },
        });
        console.log(`  Assigned ${acc.email} to hub: ${acc.hubName}`);
      }
    }

    console.log('\nAll 4 staff accounts are provisioned and active in the database!');
  } finally {
    await prisma.$disconnect();
  }
}

seedStaff().catch((err) => {
  console.error('Error seeding staff accounts:', err);
  process.exit(1);
});
