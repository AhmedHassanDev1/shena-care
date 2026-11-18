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
        hairType: dto.hairType as any,
        scalpType: dto.scalpType as any,
        primaryFocus: dto.primaryFocus as any,
        sunExposure: dto.sunExposure as any,
        preferredTexture: dto.preferredTexture as any,
        ageBand: dto.ageBand,
        experienceLevel: dto.experienceLevel,
        fragranceFree: dto.fragranceFree,
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
        safetyFlags: true,
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
        safetyFlags: true,
      },
    });

    if (!profile) {
      throw new NotFoundException(`Customer care profile not found for customer: ${customerId}`);
    }

    return profile;
  }

  /**
   * The part of a care profile a consultation may start from: skin type, hair type, the fragrance preference, chosen concerns and
   * the safety answers. Nothing that identifies the customer. A customer with no profile gets empty values, never an error.
   */
  async consultationSnapshot(customerId: string) {
    const profile = await this.prisma.customerCareProfile.findUnique({
      where: { customerId },
      select: {
        skinType: true,
        hairType: true,
        scalpType: true,
        fragranceFree: true,
        concerns: { select: { concern: { select: { slug: true, isActive: true } } } },
        safetyFlags: true,
      },
    });
    const flags = profile?.safetyFlags;
    return {
      skinType: profile?.skinType ?? null,
      hairType: (profile as any)?.hairType ?? null,
      scalpType: (profile as any)?.scalpType ?? null,
      fragranceFree: profile?.fragranceFree ?? null,
      concernSlugs: (profile?.concerns ?? []).filter(row => row.concern.isActive).map(row => row.concern.slug),
      safety: {
        pregnant: flags?.pregnant ?? 'UNKNOWN', breastfeeding: flags?.breastfeeding ?? 'UNKNOWN',
        prescriptionTopical: flags?.prescriptionTopical ?? 'UNKNOWN', oralRetinoid: flags?.oralRetinoid ?? 'UNKNOWN',
      } as { pregnant: 'YES' | 'NO' | 'UNKNOWN'; breastfeeding: 'YES' | 'NO' | 'UNKNOWN'; prescriptionTopical: 'YES' | 'NO' | 'UNKNOWN'; oralRetinoid: 'YES' | 'NO' | 'UNKNOWN' },
    };
  }

  async updateProfile(customerId: string, dto: UpdateCustomerCareProfileDto) {
    const existing = await this.prisma.customerCareProfile.findUnique({ where: { customerId } });

    if (!existing) {
      return this.createProfile({
        ...dto,
        customerId,
      });
    }

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
        hairType: dto.hairType as any,
        scalpType: dto.scalpType as any,
        primaryFocus: dto.primaryFocus as any,
        sunExposure: dto.sunExposure as any,
        preferredTexture: dto.preferredTexture as any,
        ageBand: dto.ageBand,
        experienceLevel: dto.experienceLevel,
        fragranceFree: dto.fragranceFree,
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
        safetyFlags: true,
      },
    });

    return updated;
  }
}
