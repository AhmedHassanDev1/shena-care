import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { serviceGovernorate, assertDeliverablePin } from '../../ordering/services/service-area';
import { CreateCustomerAddressDto, UpdateCustomerAddressDto } from '../dto/address.dto';

@Injectable()
export class CustomerAddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async listAddresses(customerId: string) {
    return this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getAddress(customerId: string, addressId: string) {
    const address = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
    if (!address) {
      throw new NotFoundException('Address not found');
    }
    return address;
  }

  async createAddress(customerId: string, dto: CreateCustomerAddressDto) {
    serviceGovernorate(dto.governorate);
    assertDeliverablePin({ latitude: dto.latitude, longitude: dto.longitude });

    return this.prisma.$transaction(async (tx) => {
      const count = await tx.customerAddress.count({ where: { customerId } });
      const makeDefault = count === 0 ? true : Boolean(dto.isDefault);

      if (makeDefault && count > 0) {
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.customerAddress.create({
        data: {
          customerId,
          label: dto.label?.trim() || null,
          customerName: dto.customerName.trim(),
          customerPhone: dto.customerPhone.trim(),
          governorate: dto.governorate.trim(),
          area: dto.area.trim(),
          shippingAddress: dto.shippingAddress.trim(),
          notes: dto.notes?.trim() || null,
          latitude: dto.latitude,
          longitude: dto.longitude,
          locationSource: dto.locationSource ?? 'map_pin',
          isDefault: makeDefault,
        },
      });
    });
  }

  async updateAddress(customerId: string, addressId: string, dto: UpdateCustomerAddressDto) {
    const existing = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
    if (!existing) {
      throw new NotFoundException('Address not found');
    }

    if (dto.governorate) {
      serviceGovernorate(dto.governorate);
    }

    if (dto.latitude !== undefined || dto.longitude !== undefined) {
      const lat = dto.latitude ?? existing.latitude;
      const lng = dto.longitude ?? existing.longitude;
      assertDeliverablePin({ latitude: lat, longitude: lng });
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true, id: { not: addressId } },
          data: { isDefault: false },
        });
      }

      return tx.customerAddress.update({
        where: { id: addressId },
        data: {
          ...(dto.label !== undefined ? { label: dto.label?.trim() || null } : {}),
          ...(dto.customerName !== undefined ? { customerName: dto.customerName.trim() } : {}),
          ...(dto.customerPhone !== undefined ? { customerPhone: dto.customerPhone.trim() } : {}),
          ...(dto.governorate !== undefined ? { governorate: dto.governorate.trim() } : {}),
          ...(dto.area !== undefined ? { area: dto.area.trim() } : {}),
          ...(dto.shippingAddress !== undefined ? { shippingAddress: dto.shippingAddress.trim() } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
          ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
          ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
          ...(dto.locationSource !== undefined ? { locationSource: dto.locationSource } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        },
      });
    });
  }

  async deleteAddress(customerId: string, addressId: string) {
    const existing = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
    if (!existing) {
      throw new NotFoundException('Address not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.delete({ where: { id: addressId } });

      if (existing.isDefault) {
        const nextDefault = await tx.customerAddress.findFirst({
          where: { customerId },
          orderBy: { updatedAt: 'desc' },
        });
        if (nextDefault) {
          await tx.customerAddress.update({
            where: { id: nextDefault.id },
            data: { isDefault: true },
          });
        }
      }

      return { success: true };
    });
  }

  async setDefaultAddress(customerId: string, addressId: string) {
    const existing = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
    if (!existing) {
      throw new NotFoundException('Address not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });

      return tx.customerAddress.update({
        where: { id: addressId },
        data: { isDefault: true },
      });
    });
  }
}
