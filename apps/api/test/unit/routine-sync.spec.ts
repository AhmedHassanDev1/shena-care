import '../test-database-guard';
import { ValidationPipe } from '@nestjs/common';
import { MyRoutinesService } from '../../src/modules/care/services/my-routines.service';
import { SyncLocalRoutineDto, SyncLocalRoutineStepDto } from '../../src/modules/care/dto/routine-workspace.dto';
import { CareArea, RoutineActivation, RoutineLifecycle, RoutineKind } from '@prisma/client';

describe('MyRoutinesService.syncLocalRoutine (Canonical Routine Sync)', () => {
  const prisma = {
    customerCareProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    customerRoutine: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    routineBlueprint: {
      findFirst: jest.fn(),
    },
    sku: {
      findMany: jest.fn(),
    },
    routineDraft: {
      create: jest.fn(),
    },
    routineProposal: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (cb) => cb(prisma)),
  };

  const engine = {} as any;
  const catalog = {
    getRoutineProductFacts: jest.fn().mockResolvedValue([]),
  } as any;

  let service: MyRoutinesService;
  const validationPipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

  const sampleSyncDto: SyncLocalRoutineDto = {
    localId: 'cr-1731890000000',
    title: 'روتيني المخصص للعناية بالبشرة',
    category: CareArea.skin,
    concernSlug: 'acne',
    steps: [
      {
        id: 'step-1',
        period: 'morning',
        stepName: 'غسول رغوي لطيف',
        skuId: '343f1cb1-0b53-4876-90e8-07e1bf1f8d42',
        roleKey: 'cleanser',
        isEssential: true,
      },
      {
        id: 'step-2',
        period: 'morning',
        stepName: 'واقي شمس واسع المدى',
        skuId: '550e8400-e29b-41d4-a716-446655440000',
        roleKey: 'sunscreen',
        isEssential: true,
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MyRoutinesService(prisma as any, engine, catalog);
  });

  describe('Validation: SyncLocalRoutineDto', () => {
    it('accepts valid sync input', async () => {
      const dto = await validationPipe.transform(sampleSyncDto, {
        type: 'body',
        metatype: SyncLocalRoutineDto,
      });
      expect(dto.localId).toBe('cr-1731890000000');
      expect(dto.steps).toHaveLength(2);
      expect(dto.category).toBe(CareArea.skin);
    });

    it('rejects invalid care area or period', async () => {
      await expect(
        validationPipe.transform(
          { ...sampleSyncDto, category: 'invalid-area' },
          { type: 'body', metatype: SyncLocalRoutineDto },
        ),
      ).rejects.toThrow();

      await expect(
        validationPipe.transform(
          {
            ...sampleSyncDto,
            steps: [{ ...sampleSyncDto.steps[0], period: 'night' }],
          },
          { type: 'body', metatype: SyncLocalRoutineDto },
        ),
      ).rejects.toThrow();
    });
  });

  describe('Sync execution & safety guarantees', () => {
    it('detects duplicate imports idempotently via localId and returns existing routine without creating a duplicate', async () => {
      prisma.customerCareProfile.findUnique.mockResolvedValue({ id: 'prof-1', customerId: 'cust-1' });
      prisma.customerRoutine.findFirst.mockResolvedValueOnce({
        id: 'routine-already-synced',
        titleAr: 'روتين موجود سابقاً',
      });
      // Mock for getRoutine load
      prisma.customerRoutine.findUnique.mockResolvedValue({
        id: 'routine-already-synced',
        titleAr: 'روتين موجود سابقاً',
        items: [],
        careProfile: { customerId: 'cust-1' },
      });

      const res = await service.syncLocalRoutine('cust-1', sampleSyncDto);

      expect(res.status).toBe('ALREADY_SYNCED');
      expect(res.routineId).toBe('routine-already-synced');
      expect(prisma.customerRoutine.create).not.toHaveBeenCalled();
    });

    it('detects conflict when cloud already has an active routine in the same area and prevents silent overwrite', async () => {
      prisma.customerCareProfile.findUnique.mockResolvedValue({ id: 'prof-1', customerId: 'cust-1' });
      // Not already synced
      prisma.customerRoutine.findFirst.mockResolvedValueOnce(null);
      // Existing active routine found
      prisma.customerRoutine.findFirst.mockResolvedValueOnce({
        id: 'existing-cloud-routine',
        titleAr: 'روتين الحبوب السحابي النشط',
        activation: RoutineActivation.ACTIVE,
      });
      prisma.customerRoutine.findUnique.mockResolvedValue({
        id: 'existing-cloud-routine',
        titleAr: 'روتين الحبوب السحابي النشط',
        items: [],
        careProfile: { customerId: 'cust-1' },
      });

      const res = await service.syncLocalRoutine('cust-1', sampleSyncDto);

      expect(res.status).toBe('CONFLICT');
      expect(res.existingRoutine.id).toBe('existing-cloud-routine');
      expect(prisma.customerRoutine.create).not.toHaveBeenCalled();
    });

    it('honors conflictResolution = KEEP_CLOUD without mutating cloud data', async () => {
      prisma.customerCareProfile.findUnique.mockResolvedValue({ id: 'prof-1', customerId: 'cust-1' });
      prisma.customerRoutine.findFirst.mockResolvedValueOnce(null);
      prisma.customerRoutine.findFirst.mockResolvedValueOnce({
        id: 'cloud-routine-1',
        titleAr: 'الروتين السحابي',
      });
      prisma.customerRoutine.findUnique.mockResolvedValue({
        id: 'cloud-routine-1',
        titleAr: 'الروتين السحابي',
        items: [],
        careProfile: { customerId: 'cust-1' },
      });

      const res = await service.syncLocalRoutine('cust-1', {
        ...sampleSyncDto,
        conflictResolution: 'KEEP_CLOUD',
      });

      expect(res.status).toBe('KEPT_CLOUD');
      expect(res.routineId).toBe('cloud-routine-1');
      expect(prisma.customerRoutine.create).not.toHaveBeenCalled();
    });

    it('honors conflictResolution = OVERWRITE_CLOUD by deactivating previous and activating new routine', async () => {
      prisma.customerCareProfile.findUnique.mockResolvedValue({ id: 'prof-1', customerId: 'cust-1' });
      prisma.customerRoutine.findFirst.mockResolvedValueOnce(null);
      prisma.customerRoutine.findFirst.mockResolvedValueOnce({
        id: 'old-routine',
        activation: RoutineActivation.ACTIVE,
      });

      prisma.routineBlueprint.findFirst.mockResolvedValue({
        id: 'bp-1',
        version: 1,
        concernSlug: 'acne',
        kind: RoutineKind.TREATMENT,
      });
      prisma.sku.findMany.mockResolvedValue([
        { id: sampleSyncDto.steps[0].skuId, productId: 'prod-1' },
      ]);
      prisma.routineDraft.create.mockResolvedValue({ id: 'draft-1' });
      prisma.routineProposal.create.mockResolvedValue({ id: 'proposal-1' });
      prisma.customerRoutine.create.mockResolvedValue({ id: 'new-routine-id' });
      prisma.customerRoutine.findUnique.mockResolvedValue({
        id: 'new-routine-id',
        titleAr: sampleSyncDto.title,
        items: [],
        careProfile: { customerId: 'cust-1' },
      });

      const res = await service.syncLocalRoutine('cust-1', {
        ...sampleSyncDto,
        conflictResolution: 'OVERWRITE_CLOUD',
      });

      expect(res.status).toBe('SYNCED');
      expect(prisma.customerRoutine.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-routine' },
          data: expect.objectContaining({ activation: RoutineActivation.INACTIVE }),
        }),
      );
      expect(prisma.customerRoutine.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            activation: RoutineActivation.ACTIVE,
            statusReason: 'SYNCED_FROM_LOCAL:cr-1731890000000',
          }),
        }),
      );
    });

    it('persists a complete canonical CustomerRoutine with version 1 snapshot and items when no conflict exists', async () => {
      prisma.customerCareProfile.findUnique.mockResolvedValue({ id: 'prof-1', customerId: 'cust-1' });
      prisma.customerRoutine.findFirst.mockResolvedValue(null); // No existing routine
      prisma.routineBlueprint.findFirst.mockResolvedValue({
        id: 'bp-skin-1',
        version: 1,
        concernSlug: 'acne',
        kind: RoutineKind.TREATMENT,
      });
      prisma.sku.findMany.mockResolvedValue([
        { id: sampleSyncDto.steps[0].skuId, productId: 'prod-cleanser' },
        { id: sampleSyncDto.steps[1].skuId, productId: 'prod-sunscreen' },
      ]);
      prisma.routineDraft.create.mockResolvedValue({ id: 'draft-123' });
      prisma.routineProposal.create.mockResolvedValue({ id: 'proposal-456' });
      prisma.customerRoutine.create.mockResolvedValue({ id: 'persisted-routine-uuid' });
      prisma.customerRoutine.findUnique.mockResolvedValue({
        id: 'persisted-routine-uuid',
        titleAr: sampleSyncDto.title,
        items: [],
        careProfile: { customerId: 'cust-1' },
      });

      const res = await service.syncLocalRoutine('cust-1', sampleSyncDto);

      expect(res.status).toBe('SYNCED');
      expect(res.routineId).toBe('persisted-routine-uuid');
      expect(prisma.customerRoutine.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          careProfileId: 'prof-1',
          blueprintId: 'bp-skin-1',
          createdFromProposalId: 'proposal-456',
          activation: RoutineActivation.ACTIVE,
          lifecycle: RoutineLifecycle.NOT_STARTED,
          statusReason: 'SYNCED_FROM_LOCAL:cr-1731890000000',
          items: {
            create: expect.arrayContaining([
              expect.objectContaining({
                roleKey: 'cleanser',
                skuId: '343f1cb1-0b53-4876-90e8-07e1bf1f8d42',
                productId: 'prod-cleanser',
                isEssential: true,
              }),
            ]),
          },
          versions: {
            create: expect.objectContaining({
              version: 1,
            }),
          },
        }),
      });
    });
  });
});
