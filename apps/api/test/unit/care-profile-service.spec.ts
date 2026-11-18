import '../test-database-guard';
import { NotFoundException } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { CareProfileService } from '../../src/modules/care/services/care-profile.service';
import { CreateCustomerCareProfileDto, UpdateCustomerCareProfileDto, HairType, ScalpType } from '../../src/modules/care/dto/care.dto';
import { SkinType, CareAgeBand, CareExperienceLevel } from '@prisma/client';

describe('CareProfileService & DTOs (Personal Care Hub Foundation)', () => {
  const prisma = {
    customerCareProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    customerCareProfileConcern: {
      deleteMany: jest.fn(),
    },
  };

  let service: CareProfileService;
  const validationPipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CareProfileService(prisma as any);
  });

  describe('Validation: CreateCustomerCareProfileDto & UpdateCustomerCareProfileDto', () => {
    it('accepts valid skin and hair profile inputs', async () => {
      const dto = await validationPipe.transform(
        {
          customerId: 'cust-123',
          skinType: SkinType.combination,
          hairType: HairType.curly,
          scalpType: ScalpType.sensitive,
          ageBand: CareAgeBand.ADULT,
          experienceLevel: CareExperienceLevel.BEGINNER,
          fragranceFree: true,
          sensitivities: 'chamomile',
          budget: 250,
          currency: 'EGP',
          concerns: [{ concernId: 'concern-acne-uuid', severity: 2 }],
        },
        { type: 'body', metatype: CreateCustomerCareProfileDto },
      );

      expect(dto.skinType).toBe(SkinType.combination);
      expect(dto.hairType).toBe(HairType.curly);
      expect(dto.scalpType).toBe(ScalpType.sensitive);
      expect(dto.fragranceFree).toBe(true);
      expect(dto.concerns).toHaveLength(1);
    });

    it('rejects invalid enum values for hairType and scalpType', async () => {
      await expect(
        validationPipe.transform(
          { customerId: 'cust-123', hairType: 'invalid-hair' },
          { type: 'body', metatype: CreateCustomerCareProfileDto },
        ),
      ).rejects.toThrow();

      await expect(
        validationPipe.transform(
          { scalpType: 'invalid-scalp' },
          { type: 'body', metatype: UpdateCustomerCareProfileDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('CareProfileService operations', () => {
    it('creates profile with skin, hair, and preference fields', async () => {
      const mockResult = {
        id: 'prof-1',
        customerId: 'cust-1',
        skinType: SkinType.oily,
        hairType: HairType.wavy,
        scalpType: ScalpType.dry,
        ageBand: CareAgeBand.ADULT,
        experienceLevel: CareExperienceLevel.EXPERIENCED,
        fragranceFree: true,
        budget: 150,
        currency: 'EGP',
        concerns: [],
        routine: null,
        safetyFlags: null,
      };

      prisma.customerCareProfile.create.mockResolvedValue(mockResult);

      const res = await service.createProfile({
        customerId: 'cust-1',
        skinType: SkinType.oily,
        hairType: HairType.wavy,
        scalpType: ScalpType.dry,
        ageBand: CareAgeBand.ADULT,
        experienceLevel: CareExperienceLevel.EXPERIENCED,
        fragranceFree: true,
        budget: 150,
        currency: 'EGP',
      });

      expect(prisma.customerCareProfile.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId: 'cust-1',
          skinType: SkinType.oily,
          hairType: HairType.wavy,
          scalpType: ScalpType.dry,
          fragranceFree: true,
        }),
        include: expect.objectContaining({
          concerns: { include: { concern: true } },
          routine: true,
          safetyFlags: true,
        }),
      });
      expect(res).toBe(mockResult);
    });

    it('getProfile throws NotFoundException when profile does not exist', async () => {
      prisma.customerCareProfile.findUnique.mockResolvedValue(null);
      await expect(service.getProfile('missing-cust')).rejects.toThrow(NotFoundException);
    });

    it('getProfile returns profile with concerns, routine, and safetyFlags', async () => {
      const mockProfile = {
        id: 'prof-1',
        customerId: 'cust-1',
        skinType: SkinType.dry,
        hairType: HairType.straight,
        scalpType: ScalpType.normal,
        concerns: [{ id: 'c1', concern: { name: 'Dullness' } }],
        routine: null,
        safetyFlags: { pregnant: 'NO', fragranceSensitive: 'YES' },
      };

      prisma.customerCareProfile.findUnique.mockResolvedValue(mockProfile);

      const res = await service.getProfile('cust-1');
      expect(res).toEqual(mockProfile);
      expect(prisma.customerCareProfile.findUnique).toHaveBeenCalledWith({
        where: { customerId: 'cust-1' },
        include: {
          concerns: { include: { concern: true } },
          routine: { include: { steps: { include: { recommendations: true } } } },
          safetyFlags: true,
        },
      });
    });

    it('updateProfile auto-provisions profile if none exists yet', async () => {
      prisma.customerCareProfile.findUnique.mockResolvedValue(null);
      prisma.customerCareProfile.create.mockResolvedValue({
        id: 'prof-new',
        customerId: 'cust-first-timer',
        skinType: SkinType.sensitive,
        hairType: HairType.curly,
      });

      await service.updateProfile('cust-first-timer', {
        skinType: SkinType.sensitive,
        hairType: HairType.curly,
      });

      expect(prisma.customerCareProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-first-timer',
            skinType: SkinType.sensitive,
            hairType: HairType.curly,
          }),
        }),
      );
    });

    it('updateProfile replaces concerns and updates fields when profile exists', async () => {
      prisma.customerCareProfile.findUnique.mockResolvedValue({ id: 'prof-1', customerId: 'cust-1' });
      prisma.customerCareProfileConcern.deleteMany.mockResolvedValue({ count: 1 });
      prisma.customerCareProfile.update.mockResolvedValue({
        id: 'prof-1',
        customerId: 'cust-1',
        skinType: SkinType.combination,
        hairType: HairType.coily,
        scalpType: ScalpType.oily,
      });

      const updated = await service.updateProfile('cust-1', {
        skinType: SkinType.combination,
        hairType: HairType.coily,
        scalpType: ScalpType.oily,
        concerns: [{ concernId: 'concern-oiliness-uuid', severity: 3 }],
      });

      expect(prisma.customerCareProfileConcern.deleteMany).toHaveBeenCalledWith({
        where: { profile: { customerId: 'cust-1' } },
      });
      expect(prisma.customerCareProfile.update).toHaveBeenCalledWith({
        where: { customerId: 'cust-1' },
        data: expect.objectContaining({
          skinType: SkinType.combination,
          hairType: HairType.coily,
          scalpType: ScalpType.oily,
          concerns: {
            create: [{ concernId: 'concern-oiliness-uuid', severity: 3 }],
          },
        }),
        include: expect.objectContaining({
          concerns: { include: { concern: true } },
          routine: true,
          safetyFlags: true,
        }),
      });
      expect(updated.hairType).toBe(HairType.coily);
    });

    it('consultationSnapshot returns skin, hair, scalp, and privacy-safe flags without customer identity', async () => {
      prisma.customerCareProfile.findUnique.mockResolvedValue({
        skinType: SkinType.oily,
        hairType: HairType.curly,
        scalpType: ScalpType.sensitive,
        fragranceFree: true,
        concerns: [{ concern: { slug: 'acne', isActive: true } }, { concern: { slug: 'retired', isActive: false } }],
        safetyFlags: {
          pregnant: 'NO',
          breastfeeding: 'NO',
          prescriptionTopical: 'UNKNOWN',
          oralRetinoid: 'NO',
        },
      });

      const snapshot = await service.consultationSnapshot('cust-1');
      expect(snapshot).toEqual({
        skinType: 'oily',
        hairType: 'curly',
        scalpType: 'sensitive',
        fragranceFree: true,
        concernSlugs: ['acne'],
        safety: {
          pregnant: 'NO',
          breastfeeding: 'NO',
          prescriptionTopical: 'UNKNOWN',
          oralRetinoid: 'NO',
        },
      });
    });
  });
});
