import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CustomerAddressesService } from '../../src/modules/accounts/services/customer-addresses.service';
import { PrismaService } from '../../src/platform/database/prisma.service';

describe('CustomerAddressesService (Maps Phase 2)', () => {
  let service: CustomerAddressesService;
  let prisma: any;

  const customerId = 'cust-uuid-1';
  const otherCustomerId = 'cust-uuid-other';
  const addressId = 'addr-uuid-1';

  const validAddressDto = {
    customerName: 'Ahmed Hassan',
    customerPhone: '01012345678',
    governorate: 'Cairo',
    area: 'Maadi',
    shippingAddress: '15 Road 9, Floor 3, Apt 12',
    latitude: 29.9602,
    longitude: 31.2569,
    locationSource: 'gps' as const,
    label: 'Home',
    notes: 'Near Degla square',
  };

  beforeEach(async () => {
    prisma = {
      customerAddress: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => callback(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerAddressesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CustomerAddressesService>(CustomerAddressesService);
  });

  describe('listAddresses', () => {
    it('queries addresses strictly scoped to the authenticated customerId', async () => {
      const mockList = [
        { id: 'addr-1', customerId, isDefault: true, label: 'Home' },
        { id: 'addr-2', customerId, isDefault: false, label: 'Work' },
      ];
      prisma.customerAddress.findMany.mockResolvedValue(mockList);

      const result = await service.listAddresses(customerId);
      expect(result).toBe(mockList);
      expect(prisma.customerAddress.findMany).toHaveBeenCalledWith({
        where: { customerId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });
    });
  });

  describe('getAddress', () => {
    it('returns address when customer owns it', async () => {
      const mockAddress = { id: addressId, customerId, ...validAddressDto };
      prisma.customerAddress.findFirst.mockResolvedValue(mockAddress);

      const result = await service.getAddress(customerId, addressId);
      expect(result).toEqual(mockAddress);
      expect(prisma.customerAddress.findFirst).toHaveBeenCalledWith({
        where: { id: addressId, customerId },
      });
    });

    it('throws NotFoundException on IDOR attempt or missing address', async () => {
      prisma.customerAddress.findFirst.mockResolvedValue(null);

      await expect(service.getAddress(otherCustomerId, addressId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createAddress', () => {
    it('creates address and marks as default if it is the first address', async () => {
      prisma.customerAddress.count.mockResolvedValue(0);
      prisma.customerAddress.create.mockImplementation(({ data }: any) => ({
        id: 'new-addr-1',
        ...data,
      }));

      const result = await service.createAddress(customerId, {
        ...validAddressDto,
        isDefault: false, // Should be overridden to true since count is 0
      });

      expect(result.isDefault).toBe(true);
      expect(result.customerName).toBe('Ahmed Hassan');
      expect(result.latitude).toBe(29.9602);
      expect(result.longitude).toBe(31.2569);
      expect(prisma.customerAddress.updateMany).not.toHaveBeenCalled();
    });

    it('unsets previous default if creating a subsequent address with isDefault: true', async () => {
      prisma.customerAddress.count.mockResolvedValue(2);
      prisma.customerAddress.create.mockImplementation(({ data }: any) => ({
        id: 'new-addr-2',
        ...data,
      }));

      const result = await service.createAddress(customerId, {
        ...validAddressDto,
        isDefault: true,
      });

      expect(result.isDefault).toBe(true);
      expect(prisma.customerAddress.updateMany).toHaveBeenCalledWith({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });
    });

    it('rejects governorate outside Cairo/Giza', async () => {
      await expect(
        service.createAddress(customerId, {
          ...validAddressDto,
          governorate: 'Alexandria',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects unplaced map default centroid pin', async () => {
      await expect(
        service.createAddress(customerId, {
          ...validAddressDto,
          latitude: 30.0444, // Tahrir default
          longitude: 31.2357,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects location outside Cairo/Giza bounds', async () => {
      await expect(
        service.createAddress(customerId, {
          ...validAddressDto,
          latitude: 31.2001, // Alexandria
          longitude: 29.9187,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('updateAddress', () => {
    it('updates customer address fields with deliverable pin verification', async () => {
      const existing = {
        id: addressId,
        customerId,
        latitude: 29.9602,
        longitude: 31.2569,
        governorate: 'Cairo',
      };
      prisma.customerAddress.findFirst.mockResolvedValue(existing);
      prisma.customerAddress.update.mockResolvedValue({
        ...existing,
        area: 'Degla',
      });

      const result = await service.updateAddress(customerId, addressId, {
        area: 'Degla',
      });

      expect(result.area).toBe('Degla');
      expect(prisma.customerAddress.update).toHaveBeenCalled();
    });

    it('throws NotFoundException if updating another customer address', async () => {
      prisma.customerAddress.findFirst.mockResolvedValue(null);

      await expect(
        service.updateAddress(customerId, addressId, { label: 'New Label' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects invalid pin updates', async () => {
      const existing = {
        id: addressId,
        customerId,
        latitude: 29.9602,
        longitude: 31.2569,
        governorate: 'Cairo',
      };
      prisma.customerAddress.findFirst.mockResolvedValue(existing);

      await expect(
        service.updateAddress(customerId, addressId, {
          latitude: 51.5074, // London
          longitude: -0.1278,
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('deleteAddress', () => {
    it('deletes address and assigns next default if deleted was default', async () => {
      const existing = {
        id: addressId,
        customerId,
        isDefault: true,
      };
      prisma.customerAddress.findFirst
        .mockResolvedValueOnce(existing) // First check
        .mockResolvedValueOnce({ id: 'addr-next', customerId }); // nextDefault check
      prisma.customerAddress.delete.mockResolvedValue(existing);
      prisma.customerAddress.update.mockResolvedValue({ id: 'addr-next', isDefault: true });

      const result = await service.deleteAddress(customerId, addressId);
      expect(result).toEqual({ success: true });
      expect(prisma.customerAddress.delete).toHaveBeenCalledWith({ where: { id: addressId } });
      expect(prisma.customerAddress.update).toHaveBeenCalledWith({
        where: { id: 'addr-next' },
        data: { isDefault: true },
      });
    });

    it('throws NotFoundException if deleting non-owned address', async () => {
      prisma.customerAddress.findFirst.mockResolvedValue(null);

      await expect(service.deleteAddress(customerId, addressId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setDefaultAddress', () => {
    it('resets old defaults and sets new default in transaction', async () => {
      const existing = { id: addressId, customerId, isDefault: false };
      prisma.customerAddress.findFirst.mockResolvedValue(existing);
      prisma.customerAddress.update.mockResolvedValue({ ...existing, isDefault: true });

      const result = await service.setDefaultAddress(customerId, addressId);
      expect(result.isDefault).toBe(true);
      expect(prisma.customerAddress.updateMany).toHaveBeenCalledWith({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.customerAddress.update).toHaveBeenCalledWith({
        where: { id: addressId },
        data: { isDefault: true },
      });
    });

    it('throws NotFoundException if address not found or not owned', async () => {
      prisma.customerAddress.findFirst.mockResolvedValue(null);

      await expect(service.setDefaultAddress(customerId, addressId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
