import '../test-database-guard';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccountsController } from '../../src/modules/accounts/accounts.controller';
import { AccountsService, PHONE_SIGNUP_NAME } from '../../src/modules/accounts/accounts.service';
import { UpdateProfileDto } from '../../src/modules/accounts/dto/accounts.dto';
import { AuthGuard } from '../../src/modules/accounts/guards/auth.guard';
import { OperationsController } from '../../src/modules/operations/controllers/operations.controller';
import { SupportService } from '../../src/modules/operations/services/support.service';
import { ValidationPipe } from '@nestjs/common';

describe('Customer Profile & Support Security Contracts', () => {
  const prisma = {
    customer: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    supportCase: {
      findMany: jest.fn(),
    },
  };

  const eventEmitter = { emit: jest.fn() };
  let accountsService: AccountsService;
  let supportService: SupportService;

  beforeEach(() => {
    jest.clearAllMocks();
    accountsService = new AccountsService(
      prisma as unknown as ConstructorParameters<typeof AccountsService>[0],
      eventEmitter as unknown as ConstructorParameters<typeof AccountsService>[1],
    );
    supportService = new SupportService(
      prisma as unknown as ConstructorParameters<typeof SupportService>[0],
      { enqueue: jest.fn() } as unknown as ConstructorParameters<typeof SupportService>[1],
    );
  });

  describe('AccountsController guards', () => {
    it('protects GET /accounts/me and PATCH /accounts/me with AuthGuard', () => {
      const getMeGuards = Reflect.getMetadata(GUARDS_METADATA, AccountsController.prototype.getMe);
      const updateMeGuards = Reflect.getMetadata(GUARDS_METADATA, AccountsController.prototype.updateMe);
      expect(getMeGuards).toContain(AuthGuard);
      expect(updateMeGuards).toContain(AuthGuard);
    });
  });

  describe('UpdateProfileDto validation', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

    it('rejects mass-assignment fields like roles or supplierId', async () => {
      await expect(
        pipe.transform({ name: 'Sara', roles: ['ADMIN'] }, { type: 'body', metatype: UpdateProfileDto }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects whitespace-only name after trimming', async () => {
      await expect(
        pipe.transform({ name: '   ' }, { type: 'body', metatype: UpdateProfileDto }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid email strings while allowing clearing via empty string', async () => {
      await expect(
        pipe.transform({ email: 'not-an-email' }, { type: 'body', metatype: UpdateProfileDto }),
      ).rejects.toThrow(BadRequestException);

      const cleared = await pipe.transform({ email: '   ' }, { type: 'body', metatype: UpdateProfileDto });
      expect(cleared.email).toBeNull();
    });
  });

  describe('AccountsService.getMe & updateMe', () => {
    it('masks synthetic @placeholder.com email and PHONE_SIGNUP_NAME as null', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        name: PHONE_SIGNUP_NAME,
        email: '201012345678@placeholder.com',
        createdAt: new Date('2026-10-01T10:00:00Z'),
        identities: [{ providerId: '+201012345678' }],
      });

      const me = await accountsService.getMe('cust-1');
      expect(me).toEqual({
        id: 'cust-1',
        name: null,
        email: null,
        createdAt: new Date('2026-10-01T10:00:00Z'),
        phoneNumber: '+201012345678',
      });
    });

    it('updates only explicit name and email fields scoped to the authenticated customerId', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        name: PHONE_SIGNUP_NAME,
        email: '201012345678@placeholder.com',
        createdAt: new Date('2026-10-01T10:00:00Z'),
        identities: [{ providerId: '+201012345678' }],
      });
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.update.mockResolvedValue({
        id: 'cust-1',
        name: 'سارة أحمد',
        email: 'sara@example.com',
        createdAt: new Date('2026-10-01T10:00:00Z'),
        identities: [{ providerId: '+201012345678' }],
      });

      const updated = await accountsService.updateMe('cust-1', {
        name: '  سارة أحمد  ',
        email: 'SARA@EXAMPLE.COM',
      });

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { name: 'سارة أحمد', email: 'sara@example.com' },
        select: expect.objectContaining({ id: true, name: true, email: true }),
      });
      expect(updated.name).toBe('سارة أحمد');
      expect(updated.email).toBe('sara@example.com');
      expect(updated.phoneNumber).toBe('+201012345678');
    });

    it('rejects duplicate email with 409 ConflictException without leaking the conflicting owner', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        name: 'Sara',
        email: '201012345678@placeholder.com',
        createdAt: new Date(),
        identities: [{ providerId: '+201012345678' }],
      });
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-other' });

      await expect(accountsService.updateMe('cust-1', { email: 'taken@example.com' })).rejects.toThrow(ConflictException);
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('rejects placeholder.com emails submitted by customers', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        name: 'Sara',
        email: '201012345678@placeholder.com',
        createdAt: new Date(),
        identities: [{ providerId: '+201012345678' }],
      });

      await expect(accountsService.updateMe('cust-1', { email: 'spoof@placeholder.com' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('Customer support case ownership', () => {
    it('scopes customer support list strictly to actor.id and excludes internalNotes & assigneeId', async () => {
      prisma.supportCase.findMany.mockResolvedValue([]);

      await supportService.getCasesForCustomer('cust-99', { take: 200 });

      expect(prisma.supportCase.findMany).toHaveBeenCalledWith({
        where: { customerId: 'cust-99' },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
        skip: 0,
        select: {
          id: true,
          title: true,
          description: true,
          category: true,
          priority: true,
          status: true,
          orderId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    it('protects OperationsController with AuthGuard', () => {
      const controllerGuards = Reflect.getMetadata(GUARDS_METADATA, OperationsController);
      expect(controllerGuards).toContain(AuthGuard);
    });
  });
});
