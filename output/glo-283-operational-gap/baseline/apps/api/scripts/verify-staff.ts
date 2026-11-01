import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function verify() {
  const prisma = new PrismaClient();
  const staffCredentials = [
    { email: 'admin@shenacare.com', role: 'ADMIN', pass: (process.env.DEV_STAFF_PASSWORD ?? '') },
    { email: 'hub@shenacare.com', role: 'HUB_OPERATOR', pass: (process.env.DEV_STAFF_PASSWORD ?? '') },
    { email: 'supplier@shenacare.com', role: 'SUPPLIER', pass: (process.env.DEV_STAFF_PASSWORD ?? '') },
    { email: 'driver@shenacare.com', role: 'DRIVER', pass: (process.env.DEV_STAFF_PASSWORD ?? '') },
  ];

  console.log('Staff Provisioning Safety Verification:');
  for (const s of staffCredentials) {
    const user = await prisma.customer.findUnique({
      where: { email: s.email },
      include: {
        identities: true,
      },
    });

    const emailIdentity = user?.identities.find((i) => i.provider === 'EMAIL');
    const passwordValid = emailIdentity?.passwordHash
      ? await bcrypt.compare(s.pass, emailIdentity.passwordHash)
      : false;

    // Check hub assignment if hub operator
    let assignedHubName: string | null = null;
    if (user?.id) {
      const hubOp = await prisma.fulfillmentLocationOperator.findFirst({
        where: { operatorId: user.id },
        include: { location: true },
      });
      if (hubOp) assignedHubName = hubOp.location.name;
    }

    // Check supplier if supplier
    let assignedSupplierName: string | null = null;
    if (user?.supplierId) {
      const sup = await prisma.supplier.findUnique({
        where: { id: user.supplierId },
      });
      if (sup) assignedSupplierName = sup.name;
    }

    console.log({
      email: user?.email,
      roles: user?.roles,
      isActive: user?.isActive,
      identityProvider: emailIdentity?.provider,
      passwordAuthenticationValid: passwordValid,
      assignedHub: assignedHubName,
      assignedSupplier: assignedSupplierName,
    });
  }

  await prisma.$disconnect();
}

verify().catch(console.error);
