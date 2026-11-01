import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../../src/platform/database/prisma.service';

export interface Actor { id: string; token: string; auth: { Authorization: string } }

/** A real customer account with a live session, so requests pass the production AuthGuard. */
export async function createActor(prisma: PrismaService, role: Role, supplierId?: string): Promise<Actor> {
  const user = await prisma.customer.create({ data: {
    name: `Fixture ${role}`, email: `${role.toLowerCase()}-${randomUUID()}@fixtures.test`, roles: [role], supplierId: supplierId ?? null,
  } });
  const session = await prisma.session.create({ data: {
    customerId: user.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000),
  } });
  return { id: user.id, token: session.token, auth: { Authorization: `Bearer ${session.token}` } };
}
