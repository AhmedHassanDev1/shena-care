import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { Role, Prisma } from '@prisma/client';

export const ALLOWED_STAFF_ROLES: Role[] = [Role.ADMIN, Role.HUB_OPERATOR, Role.SUPPLIER, Role.DRIVER];

@Injectable()
export class StaffManagementService {
  constructor(private readonly prisma: PrismaService) {}

  /** List all staff accounts (holding at least one non-CUSTOMER role) with their scopes */
  async listStaff(filter: { role?: Role; isActive?: boolean } = {}) {
    return this.prisma.customer.findMany({
      where: {
        roles: filter.role ? { has: filter.role } : { hasSome: ALLOWED_STAFF_ROLES },
        ...(filter.isActive !== undefined ? { isActive: filter.isActive } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        roles: true,
        isActive: true,
        supplierId: true,
        supplier: { select: { id: true, name: true, slug: true } },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async getStaffById(id: string) {
    const staff = await this.prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        roles: true,
        isActive: true,
        supplierId: true,
        supplier: { select: { id: true, name: true, slug: true } },
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!staff) throw new NotFoundException(`Staff account ${id} not found`);
    return staff;
  }

  /**
   * Set staff active/deactivated lifecycle status.
   * - Cannot deactivate the last remaining active Admin (Founder-only Admin preservation).
   * - Cannot deactivate a driver with active shipment custody or un-settled cash. Never silently reassign physical custody.
   * - Immediately revokes all active sessions on deactivation.
   */
  async setStaffStatus(id: string, isActive: boolean, adminActorId: string) {
    return this.prisma.$transaction(async tx => {
      const staff = await tx.customer.findUnique({ where: { id } });
      if (!staff) throw new NotFoundException(`Staff account ${id} not found`);

      if (staff.isActive === isActive) {
        return staff;
      }

      if (!isActive) {
        // 1. Founder-only Admin preservation
        if (staff.roles.includes(Role.ADMIN)) {
          const activeAdminsCount = await tx.customer.count({
            where: { roles: { has: Role.ADMIN }, isActive: true },
          });
          if (activeAdminsCount <= 1) {
            throw new BadRequestException('Cannot deactivate the last remaining active Admin (Founder-only Admin preservation).');
          }
        }

        // 2. Driver physical custody guard
        if (staff.roles.includes(Role.DRIVER)) {
          await this.assertDriverHasNoCustody(tx, id);
        }

        // 3. Revoke all active sessions immediately
        await tx.session.updateMany({
          where: { customerId: id, isValid: true },
          data: { isValid: false },
        });
      }

      const updated = await tx.customer.update({
        where: { id },
        data: { isActive },
        select: {
          id: true,
          name: true,
          email: true,
          roles: true,
          isActive: true,
          supplierId: true,
          updatedAt: true,
        },
      });

      // Audit trail in outbox
      await tx.notificationOutbox.create({
        data: {
          eventType: 'staff.status_changed',
          aggregateId: id,
          aggregateType: 'StaffAccount',
          payload: {
            staffId: id,
            isActive,
            changedBy: adminActorId,
            timestamp: new Date().toISOString(),
          },
          deduplicationKey: `staff.status:${id}:${Date.now()}`,
        },
      });

      return updated;
    });
  }

  /**
   * Update staff roles.
   * - Enforces only canonical roles (ADMIN, HUB_OPERATOR, SUPPLIER, DRIVER). No HR/payroll/shifts.
   * - Cannot demote the last remaining active Admin.
   * - Cannot remove DRIVER role while driver holds active physical shipment custody or un-settled cash.
   * - Revokes existing sessions to force fresh authentication with updated permissions.
   */
  async updateStaffRoles(id: string, newRoles: Role[], adminActorId: string) {
    if (!newRoles || newRoles.length === 0) {
      throw new BadRequestException('At least one role is required');
    }

    const invalidRole = newRoles.find(r => !ALLOWED_STAFF_ROLES.includes(r) && r !== Role.CUSTOMER);
    if (invalidRole) {
      throw new BadRequestException(`Role ${invalidRole} is not an authorized role`);
    }

    return this.prisma.$transaction(async tx => {
      const staff = await tx.customer.findUnique({ where: { id } });
      if (!staff) throw new NotFoundException(`Staff account ${id} not found`);

      // Demoting Admin check
      if (staff.roles.includes(Role.ADMIN) && !newRoles.includes(Role.ADMIN)) {
        const activeAdminsCount = await tx.customer.count({
          where: { roles: { has: Role.ADMIN }, isActive: true },
        });
        if (activeAdminsCount <= 1) {
          throw new BadRequestException('Cannot remove ADMIN role from the last remaining active Admin (Founder-only Admin preservation).');
        }
      }

      // Removing Driver role check
      if (staff.roles.includes(Role.DRIVER) && !newRoles.includes(Role.DRIVER)) {
        await this.assertDriverHasNoCustody(tx, id);
      }

      // Revoke all active sessions to force re-login with new roles
      await tx.session.updateMany({
        where: { customerId: id, isValid: true },
        data: { isValid: false },
      });

      const updated = await tx.customer.update({
        where: { id },
        data: { roles: newRoles },
        select: {
          id: true,
          name: true,
          email: true,
          roles: true,
          isActive: true,
          supplierId: true,
          updatedAt: true,
        },
      });

      await tx.notificationOutbox.create({
        data: {
          eventType: 'staff.roles_changed',
          aggregateId: id,
          aggregateType: 'StaffAccount',
          payload: {
            staffId: id,
            priorRoles: staff.roles,
            newRoles,
            changedBy: adminActorId,
            timestamp: new Date().toISOString(),
          },
          deduplicationKey: `staff.roles:${id}:${Date.now()}`,
        },
      });

      return updated;
    });
  }

  /**
   * Explicitly revoke all active sessions for a staff member.
   */
  async revokeSessions(id: string, adminActorId: string) {
    const staff = await this.prisma.customer.findUnique({ where: { id } });
    if (!staff) throw new NotFoundException(`Staff account ${id} not found`);

    const result = await this.prisma.session.updateMany({
      where: { customerId: id, isValid: true },
      data: { isValid: false },
    });

    await this.prisma.notificationOutbox.create({
      data: {
        eventType: 'staff.sessions_revoked',
        aggregateId: id,
        aggregateType: 'StaffAccount',
        payload: {
          staffId: id,
          revokedCount: result.count,
          revokedBy: adminActorId,
          timestamp: new Date().toISOString(),
        },
        deduplicationKey: `staff.revoked:${id}:${Date.now()}`,
      },
    });

    return { success: true, revokedSessionsCount: result.count };
  }

  /**
   * Verify that a driver has zero physical custody before deactivation or role revocation.
   * Checks dispatched batches, active delivery stops, and un-settled cash collections.
   */
  private async assertDriverHasNoCustody(tx: Prisma.TransactionClient, driverId: string): Promise<void> {
    // 1. Active batches
    const activeBatch = await tx.deliveryBatch.findFirst({
      where: { driverId, status: { in: ['dispatched', 'in_progress'] } },
    });
    if (activeBatch) {
      throw new BadRequestException(
        `Cannot disable driver: driver currently holds active delivery batch ${activeBatch.id} in status '${activeBatch.status}'. Settle or reassign the batch before deactivating. Never silently reassign physical custody.`
      );
    }

    // 2. Active delivery stops
    const activeStop = await tx.deliveryStop.findFirst({
      where: { batch: { driverId }, status: 'active' },
    });
    if (activeStop) {
      throw new BadRequestException(
        `Cannot disable driver: driver currently holds active delivery stop ${activeStop.id} for shipment ${activeStop.shipmentId}. Complete or return the package before deactivating. Never silently reassign physical custody.`
      );
    }

    // 3. Un-settled cash collections held by courier
    const unSettledCash = await tx.paymentCollection.findFirst({
      where: { courierId: driverId, status: 'collected' },
    });
    if (unSettledCash) {
      throw new BadRequestException(
        `Cannot disable driver: driver holds collected cash for order ${unSettledCash.orderId} awaiting hub settlement. Settle cash collection before deactivating.`
      );
    }
  }
}
