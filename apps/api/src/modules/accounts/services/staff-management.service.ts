import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../platform/database/prisma.service';
import { Role, Prisma } from '@prisma/client';
import { CreateStaffDto, UpdateStaffProfileDto } from '../dto/staff-management.dto';

export const ALLOWED_STAFF_ROLES: Role[] = [Role.ADMIN, Role.HUB_OPERATOR, Role.SUPPLIER, Role.DRIVER];
/** A supplier login or a driver login is a single-purpose account: it never also carries Admin or Hub authority. */
const EXCLUSIVE_ROLES: Role[] = [Role.SUPPLIER, Role.DRIVER];

/**
 * Role combinations an Admin may grant. Granting is already Admin-only at the route; these rules also stop an Admin from
 * quietly turning a supplier or driver login into an account with Admin or Hub reach.
 */
export function assertRoleCombination(roles: Role[], supplierId: string | null | undefined): void {
  const staffRoles = roles.filter(role => role !== Role.CUSTOMER);
  if (!staffRoles.length) return; // demotion to a plain customer account
  const exclusive = staffRoles.find(role => EXCLUSIVE_ROLES.includes(role));
  if (exclusive && staffRoles.length > 1) {
    throw new BadRequestException({ code: 'ROLE_COMBINATION_NOT_ALLOWED', message: `${exclusive} accounts cannot hold any other staff role.` });
  }
  if (staffRoles.includes(Role.SUPPLIER) && !supplierId) {
    throw new BadRequestException({ code: 'SUPPLIER_REQUIRED', message: 'A supplier login must belong to a supplier company.' });
  }
}

@Injectable()
export class StaffManagementService {
  constructor(private readonly prisma: PrismaService) {}

  /** Adds hub assignments and the number of live sessions, without exposing credentials. */
  private async withAccess<T extends { id: string }>(rows: T[]) {
    if (!rows.length) return [];
    const ids = rows.map(row => row.id);
    const [assignments, sessions] = await Promise.all([
      this.prisma.fulfillmentLocationOperator.findMany({ where: { operatorId: { in: ids } }, include: { location: { select: { id: true, name: true } } } }),
      this.prisma.session.groupBy({ by: ['customerId'], where: { customerId: { in: ids }, isValid: true, expiresAt: { gt: new Date() } }, _count: { _all: true } }),
    ]);
    return rows.map(row => ({
      ...row,
      locations: assignments.filter(a => a.operatorId === row.id).map(a => a.location),
      activeSessions: sessions.find(s => s.customerId === row.id)?._count._all ?? 0,
    }));
  }

  /** List all staff accounts (holding at least one non-CUSTOMER role) with their scopes */
  async listStaff(filter: { role?: Role; isActive?: boolean } = {}) {
    return this.withAccess(await this.listRows(filter));
  }

  private listRows(filter: { role?: Role; isActive?: boolean } = {}) {
    return this.prisma.customer.findMany({
      where: {
        roles: filter.role ? { has: filter.role } : { hasSome: ALLOWED_STAFF_ROLES },
        ...(filter.isActive !== undefined ? { isActive: filter.isActive } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
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
        phone: true,
        roles: true,
        isActive: true,
        supplierId: true,
        supplier: { select: { id: true, name: true, slug: true } },
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!staff) throw new NotFoundException(`Staff account ${id} not found`);
    return (await this.withAccess([staff]))[0];
  }

  /**
   * Create a staff login. Email must be new (an existing account is never silently promoted), the role set is checked against the
   * allowed combinations, and the account starts active with the password the Admin set.
   */
  async createStaff(dto: CreateStaffDto, adminActorId: string) {
    assertRoleCombination(dto.roles, dto.supplierId);
    const invalid = dto.roles.find(role => !ALLOWED_STAFF_ROLES.includes(role));
    if (invalid) throw new BadRequestException(`Role ${invalid} is not an authorized staff role`);
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.customer.findUnique({ where: { email } })) {
      throw new ConflictException({ code: 'EMAIL_ALREADY_REGISTERED', message: 'An account with this email already exists.' });
    }
    if (dto.supplierId) {
      if (!dto.roles.includes(Role.SUPPLIER)) throw new BadRequestException({ code: 'SUPPLIER_ONLY_FOR_SUPPLIER_ROLE', message: 'supplierId is only for the SUPPLIER role.' });
      if (!(await this.prisma.supplier.findUnique({ where: { id: dto.supplierId }, select: { id: true } }))) throw new NotFoundException('Supplier not found');
    }
    const locationIds = dto.roles.includes(Role.HUB_OPERATOR) ? dto.locationIds ?? [] : [];
    await this.assertLocationsExist(locationIds);
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const created = await this.prisma.$transaction(async tx => {
      const customer = await tx.customer.create({
        data: {
          name: dto.name.trim(), email, phone: dto.phone?.trim() || null, roles: dto.roles, supplierId: dto.supplierId ?? null,
          identities: { create: { provider: 'EMAIL', providerId: email, passwordHash } },
        },
        select: { id: true },
      });
      if (locationIds.length) await tx.fulfillmentLocationOperator.createMany({ data: locationIds.map(locationId => ({ locationId, operatorId: customer.id })) });
      await tx.notificationOutbox.create({
        data: {
          eventType: 'staff.created', aggregateId: customer.id, aggregateType: 'StaffAccount',
          payload: { staffId: customer.id, roles: dto.roles, createdBy: adminActorId, timestamp: new Date().toISOString() },
          deduplicationKey: `staff.created:${customer.id}`,
        },
      });
      return customer;
    });
    return this.getStaffById(created.id);
  }

  /** Edit the display name and the hubs a Hub operator works at. Roles, status and password have their own audited actions. */
  async updateProfile(id: string, dto: UpdateStaffProfileDto, adminActorId: string) {
    const staff = await this.prisma.customer.findUnique({ where: { id } });
    if (!staff) throw new NotFoundException(`Staff account ${id} not found`);
    if (dto.locationIds && !staff.roles.includes(Role.HUB_OPERATOR)) {
      throw new BadRequestException({ code: 'HUB_ASSIGNMENT_REQUIRES_HUB_ROLE', message: 'Only Hub operators are assigned to hubs.' });
    }
    if (dto.locationIds) await this.assertLocationsExist(dto.locationIds);
    await this.prisma.$transaction(async tx => {
      if (dto.name !== undefined) await tx.customer.update({ where: { id }, data: { name: dto.name.trim() } });
      if (dto.phone !== undefined) await tx.customer.update({ where: { id }, data: { phone: dto.phone.trim() || null } });
      if (dto.locationIds) {
        await tx.fulfillmentLocationOperator.deleteMany({ where: { operatorId: id, locationId: { notIn: dto.locationIds } } });
        if (dto.locationIds.length) {
          await tx.fulfillmentLocationOperator.createMany({ data: dto.locationIds.map(locationId => ({ locationId, operatorId: id })), skipDuplicates: true });
        }
      }
      await tx.notificationOutbox.create({
        data: {
          eventType: 'staff.profile_changed', aggregateId: id, aggregateType: 'StaffAccount',
          payload: { staffId: id, changedBy: adminActorId, name: dto.name ?? null, locationIds: dto.locationIds ?? null, timestamp: new Date().toISOString() },
          deduplicationKey: `staff.profile:${id}:${Date.now()}`,
        },
      });
    });
    return this.getStaffById(id);
  }

  /** Set a new password on a staff login and sign it out everywhere. */
  async resetPassword(id: string, password: string, adminActorId: string) {
    const staff = await this.prisma.customer.findUnique({ where: { id }, include: { identities: { where: { provider: 'EMAIL' } } } });
    if (!staff) throw new NotFoundException(`Staff account ${id} not found`);
    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.$transaction(async tx => {
      if (staff.identities.length) await tx.identity.update({ where: { id: staff.identities[0].id }, data: { passwordHash } });
      else await tx.identity.create({ data: { customerId: id, provider: 'EMAIL', providerId: staff.email, passwordHash } });
      await tx.session.updateMany({ where: { customerId: id, isValid: true }, data: { isValid: false } });
      await tx.notificationOutbox.create({
        data: {
          eventType: 'staff.password_reset', aggregateId: id, aggregateType: 'StaffAccount',
          payload: { staffId: id, resetBy: adminActorId, timestamp: new Date().toISOString() },
          deduplicationKey: `staff.password:${id}:${Date.now()}`,
        },
      });
    });
    return { success: true };
  }

  private async assertLocationsExist(locationIds: string[]) {
    if (!locationIds.length) return;
    const found = await this.prisma.fulfillmentLocation.count({ where: { id: { in: locationIds } } });
    if (found !== new Set(locationIds).size) throw new NotFoundException('One or more hubs were not found');
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

      assertRoleCombination(newRoles, staff.supplierId);

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
