/**
 * Isolated development/test fixture for exercising Product Reviews:
 * - Creates/updates 4 distinct accounts against the target database:
 *   1. Authorized developer (ADMIN role, 0 purchases for target product)
 *   2. Customer with a DELIVERED order for the target product (eligible)
 *   3. Customer with a CANCELLED order for the target product (blocked)
 *   4. Customer with NO orders for the target product (blocked)
 *
 * Refuses to run in production or staging environments.
 * Usage:
 *   cd apps/api
 *   node scripts/isolated-test-env.cjs npx ts-node -r tsconfig-paths/register scripts/dev-reviews-fixture.ts
 *   node scripts/isolated-test-env.cjs npx ts-node -r tsconfig-paths/register scripts/dev-reviews-fixture.ts --product=<slug> --reset
 */
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { OrderItemLineState, OrderStatus, PaymentMethod, PrismaClient, Role } from '@prisma/client';
import { isDevTestReviewEnvironment } from '../src/platform/auth/dev-test-reviews';

const DEV_FIXED_ENV_KEYS = ['NODE_ENV', 'APP_ENV', 'ENVIRONMENT', 'VERCEL_ENV', 'RAILWAY_ENVIRONMENT'] as const;

function assertSafeLocalFixtureEnvironment(): void {
  const effectiveEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'development',
  };
  if (!isDevTestReviewEnvironment(effectiveEnv)) {
    const summary = DEV_FIXED_ENV_KEYS.map((k) => `${k}=${process.env[k] ?? ''}`).join(' ');
    throw new Error(`Refusing to seed review fixtures outside local development/test (${summary})`);
  }
}

async function upsertAccount(
  prisma: PrismaClient,
  input: {
    email: string;
    phoneNumber: string;
    name: string;
    roles: Role[];
    password?: string;
  },
) {
  const existing = await prisma.customer.findUnique({ where: { email: input.email } });
  const customer = existing
    ? await prisma.customer.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          roles: input.roles,
          isActive: true,
        },
      })
    : await prisma.customer.create({
        data: {
          email: input.email,
          name: input.name,
          roles: input.roles,
          isActive: true,
        },
      });

  const phoneIdentity = await prisma.identity.findUnique({
    where: {
      provider_providerId: {
        provider: 'PHONE',
        providerId: input.phoneNumber,
      },
    },
  });
  if (!phoneIdentity) {
    await prisma.identity.create({
      data: {
        customerId: customer.id,
        provider: 'PHONE',
        providerId: input.phoneNumber,
      },
    });
  }

  if (input.password) {
    const passwordHash = await bcrypt.hash(input.password, 12);
    const emailIdentity = await prisma.identity.findUnique({
      where: {
        provider_providerId: {
          provider: 'EMAIL',
          providerId: input.email,
        },
      },
    });
    if (emailIdentity) {
      await prisma.identity.update({
        where: { id: emailIdentity.id },
        data: { passwordHash, customerId: customer.id },
      });
    } else {
      await prisma.identity.create({
        data: {
          customerId: customer.id,
          provider: 'EMAIL',
          providerId: input.email,
          passwordHash,
        },
      });
    }
  }

  return customer;
}

async function main() {
  assertSafeLocalFixtureEnvironment();

  const args = process.argv.slice(2);
  const productArg = args.find((arg) => arg.startsWith('--product='))?.slice('--product='.length);
  const shouldReset = args.includes('--reset');

  const prisma = new PrismaClient();
  try {
    const product = productArg
      ? await prisma.product.findFirst({
          where: {
            OR: [{ slug: productArg }, ...(productArg.length === 36 ? [{ id: productArg }] : [])],
            isPublished: true,
            archivedAt: null,
          },
          include: { skus: { where: { isActive: true }, take: 1 } },
        })
      : await prisma.product.findFirst({
          where: { isPublished: true, archivedAt: null, skus: { some: { isActive: true } } },
          orderBy: { createdAt: 'asc' },
          include: { skus: { where: { isActive: true }, take: 1 } },
        });

    if (!product || product.skus.length === 0) {
      throw new Error('No active product with an active SKU found. Seed the catalog first (or pass --product=<slug>).');
    }

    const sku = product.skus[0];
    const devPassword = process.env.DEV_FIXTURE_PASSWORD || crypto.randomBytes(12).toString('base64url');
    const customerPassword = process.env.DEV_FIXTURE_CUSTOMER_PASSWORD || crypto.randomBytes(12).toString('base64url');

    const devActor = await upsertAccount(prisma, {
      email: 'dev.reviewer@shinacare.local',
      phoneNumber: '+201099990001',
      name: 'ShinaCare Dev Reviewer',
      roles: [Role.ADMIN],
      password: devPassword,
    });

    const deliveredBuyer = await upsertAccount(prisma, {
      email: 'buyer.delivered@shinacare.local',
      phoneNumber: '+201099990002',
      name: 'سارة المنصور',
      roles: [Role.CUSTOMER],
      password: customerPassword,
    });

    const cancelledBuyer = await upsertAccount(prisma, {
      email: 'buyer.cancelled@shinacare.local',
      phoneNumber: '+201099990003',
      name: 'نور حسن',
      roles: [Role.CUSTOMER],
      password: customerPassword,
    });

    const nonBuyer = await upsertAccount(prisma, {
      email: 'customer.nobuy@shinacare.local',
      phoneNumber: '+201099990004',
      name: 'مريم طارق',
      roles: [Role.CUSTOMER],
      password: customerPassword,
    });

    if (shouldReset) {
      await prisma.productReview.deleteMany({
        where: {
          productId: product.id,
          customerId: { in: [devActor.id, deliveredBuyer.id, cancelledBuyer.id, nonBuyer.id] },
        },
      });
    }

    // Ensure developer & non-buyer have zero qualifying orders on this product cleanly.
    const deliveredOrderNumber = `DEV-DELIV-${product.slug.slice(0, 14).toUpperCase()}`;
    const existingDelivered = await prisma.order.findUnique({ where: { orderNumber: deliveredOrderNumber } });
    if (!existingDelivered) {
      await prisma.order.create({
        data: {
          orderNumber: deliveredOrderNumber,
          customerId: deliveredBuyer.id,
          customerName: deliveredBuyer.name,
          customerPhone: '+201099990002',
          shippingAddress: '12 Nile Corniche, Zamalek, Cairo',
          totalAmount: 450,
          currency: 'EGP',
          status: OrderStatus.delivered,
          paymentMethod: PaymentMethod.COD,
          items: {
            create: {
              productId: product.id,
              skuId: sku.id,
              productName: product.name,
              skuCode: sku.code,
              quantity: 1,
              price: 450,
              currency: 'EGP',
              lineState: OrderItemLineState.active,
            },
          },
        },
      });
    }

    const cancelledOrderNumber = `DEV-CANC-${product.slug.slice(0, 14).toUpperCase()}`;
    const existingCancelled = await prisma.order.findUnique({ where: { orderNumber: cancelledOrderNumber } });
    if (!existingCancelled) {
      await prisma.order.create({
        data: {
          orderNumber: cancelledOrderNumber,
          customerId: cancelledBuyer.id,
          customerName: cancelledBuyer.name,
          customerPhone: '+201099990003',
          shippingAddress: '15 Maadi Degla, Cairo',
          totalAmount: 450,
          currency: 'EGP',
          status: OrderStatus.cancelled,
          paymentMethod: PaymentMethod.COD,
          items: {
            create: {
              productId: product.id,
              skuId: sku.id,
              productName: product.name,
              skuCode: sku.code,
              quantity: 1,
              price: 450,
              currency: 'EGP',
              lineState: OrderItemLineState.active,
            },
          },
        },
      });
    }

    console.log(
      JSON.stringify(
        {
          product: { id: product.id, slug: product.slug, skuId: sku.id },
          accounts: {
            developer: { email: devActor.email, roles: devActor.roles, password: devPassword },
            deliveredBuyer: { email: deliveredBuyer.email, phoneNumber: '+201099990002', password: customerPassword },
            cancelledBuyer: { email: cancelledBuyer.email, phoneNumber: '+201099990003', password: customerPassword },
            nonBuyer: { email: nonBuyer.email, phoneNumber: '+201099990004', password: customerPassword },
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
