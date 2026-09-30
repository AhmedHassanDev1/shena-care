import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { CreateCustomerCareProfileDto, UpdateCustomerCareProfileDto } from '../dto/care.dto';

@Injectable()
export class CareProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async createProfile(dto: CreateCustomerCareProfileDto) {
    const profile = await this.prisma.customerCareProfile.create({
      data: {
        customerId: dto.customerId,
        skinType: dto.skinType,
        budget: dto.budget,
        currency: dto.currency,
        sensitivities: dto.sensitivities,
        concerns: dto.concerns
          ? {
              create: dto.concerns.map((c) => ({
                concernId: c.concernId,
                severity: c.severity ?? 1,
              })),
            }
          : undefined,
      },
      include: {
        concerns: { include: { concern: true } },
        routine: true,
      },
    });

    return profile;
  }

  async getProfile(customerId: string) {
    const profile = await this.prisma.customerCareProfile.findUnique({
      where: { customerId },
      include: {
        concerns: { include: { concern: true } },
        routine: { include: { steps: { include: { recommendations: true } } } },
      },
    });

    if (!profile) {
      throw new NotFoundException(`Customer care profile not found for customer: ${customerId}`);
    }

    return profile;
  }

  async updateProfile(customerId: string, dto: UpdateCustomerCareProfileDto) {
    // Check if exists
    await this.getProfile(customerId);

    // If concerns are provided, we replace the existing ones completely for simplicity in this MVP
    if (dto.concerns) {
      await this.prisma.customerCareProfileConcern.deleteMany({
        where: { profile: { customerId } },
      });
    }

    const updated = await this.prisma.customerCareProfile.update({
      where: { customerId },
      data: {
        skinType: dto.skinType,
        sensitivities: dto.sensitivities,
        budget: dto.budget,
        currency: dto.currency,
        routineId: dto.routineId,
        ...(dto.concerns && {
          concerns: {
            create: dto.concerns.map((c) => ({
              concernId: c.concernId,
              severity: c.severity ?? 1,
            })),
          },
        }),
      },
      include: {
        concerns: { include: { concern: true } },
        routine: true,
      },
    });

    return updated;
  }
}
