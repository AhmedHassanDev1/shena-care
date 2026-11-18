import {
  getSavedCustomerRoutine,
  saveCustomerRoutine,
  clearSavedCustomerRoutine,
  syncSavedRoutineWithCloud,
  type CustomerSavedRoutine,
} from './routineStorage';
import { apiClient } from '@/lib/api-client';

class LocalStorageMock {
  private store: Record<string, string> = {};
  clear() {
    this.store = {};
  }
  getItem(key: string) {
    return this.store[key] || null;
  }
  setItem(key: string, value: string) {
    this.store[key] = String(value);
  }
  removeItem(key: string) {
    delete this.store[key];
  }
}

const mockStorage = new LocalStorageMock();
(global as unknown as { window: unknown; localStorage: unknown }).window = global;
(global as unknown as { localStorage: unknown }).localStorage = mockStorage;

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

describe('routineStorage & syncSavedRoutineWithCloud', () => {
  const sampleRoutine: CustomerSavedRoutine = {
    id: 'cr-1731890000000',
    title: 'روتيني المخصص للعناية بالبشرة',
    category: 'skin',
    concern: 'acne',
    savedAt: '2026-11-18T00:00:00.000Z',
    morningSteps: [
      {
        id: 'step-1',
        num: '1',
        period: 'morning',
        stepName: 'غسول رغوي لطيف',
        productName: 'غسول للبشرة',
        brand: 'سيمبل',
        actives: 'زنك',
        usage: 'صباحاً',
        price: 250,
        skuId: '343f1cb1-0b53-4876-90e8-07e1bf1f8d42',
        productSlug: 'cleanser-acne',
        isEssential: true,
      },
    ],
    eveningSteps: [
      {
        id: 'step-2',
        num: '2',
        period: 'evening',
        stepName: 'مرطب خفيف',
        productName: 'مرطب جل',
        brand: 'سيروم',
        actives: 'سيراميد',
        usage: 'مساءً',
        price: 300,
        skuId: '550e8400-e29b-41d4-a716-446655440000',
        productSlug: 'ceramide-cream',
        isEssential: true,
      },
    ],
  };

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  describe('Local CRUD operations', () => {
    it('saves and retrieves routine from localStorage', () => {
      expect(getSavedCustomerRoutine()).toBeNull();
      saveCustomerRoutine(sampleRoutine);
      const retrieved = getSavedCustomerRoutine();
      expect(retrieved).toEqual(sampleRoutine);
    });

    it('clears saved routine from localStorage', () => {
      saveCustomerRoutine(sampleRoutine);
      expect(getSavedCustomerRoutine()).not.toBeNull();
      clearSavedCustomerRoutine();
      expect(getSavedCustomerRoutine()).toBeNull();
    });
  });

  describe('syncSavedRoutineWithCloud', () => {
    it('returns null if there is no routine in localStorage', async () => {
      const res = await syncSavedRoutineWithCloud('test-token');
      expect(res).toBeNull();
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('returns ALREADY_SYNCED idempotently without calling API if already synced to cloud', async () => {
      const syncedRoutine: CustomerSavedRoutine = {
        ...sampleRoutine,
        cloudRoutineId: 'cloud-routine-uuid',
        syncedAt: '2026-11-18T00:30:00.000Z',
      };
      saveCustomerRoutine(syncedRoutine);

      const res = await syncSavedRoutineWithCloud('test-token');
      expect(res).toEqual({
        status: 'ALREADY_SYNCED',
        routineId: 'cloud-routine-uuid',
      });
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('syncs local routine to cloud, updates localStorage with cloudRoutineId and syncedAt on SYNCED status', async () => {
      saveCustomerRoutine(sampleRoutine);

      (apiClient.post as jest.Mock).mockResolvedValueOnce({
        status: 'SYNCED',
        routineId: 'new-cloud-routine-uuid',
      });

      const res = await syncSavedRoutineWithCloud('test-jwt-token');

      expect(res?.status).toBe('SYNCED');
      expect(res?.routineId).toBe('new-cloud-routine-uuid');

      expect(apiClient.post).toHaveBeenCalledWith(
        '/care/me/routines/sync',
        expect.objectContaining({
          localId: sampleRoutine.id,
          title: sampleRoutine.title,
          category: 'skin',
          concernSlug: 'acne',
          steps: expect.arrayContaining([
            expect.objectContaining({
              id: 'step-1',
              period: 'morning',
              skuId: '343f1cb1-0b53-4876-90e8-07e1bf1f8d42',
            }),
            expect.objectContaining({
              id: 'step-2',
              period: 'evening',
              skuId: '550e8400-e29b-41d4-a716-446655440000',
            }),
          ]),
        }),
        { token: 'test-jwt-token' }
      );

      const updated = getSavedCustomerRoutine();
      expect(updated?.cloudRoutineId).toBe('new-cloud-routine-uuid');
      expect(updated?.syncedAt).toBeDefined();
    });

    it('handles CONFLICT response without updating localStorage prematurely', async () => {
      saveCustomerRoutine(sampleRoutine);

      (apiClient.post as jest.Mock).mockResolvedValueOnce({
        status: 'CONFLICT',
        existingRoutine: { id: 'existing-cloud-routine', titleAr: 'روتين سحابي نشط' },
      });

      const res = await syncSavedRoutineWithCloud('test-jwt-token');

      expect(res?.status).toBe('CONFLICT');
      expect(res?.existingRoutine).toBeDefined();

      const after = getSavedCustomerRoutine();
      expect(after?.cloudRoutineId).toBeUndefined();
    });

    it('passes conflictResolution = OVERWRITE_CLOUD and updates localStorage on success', async () => {
      saveCustomerRoutine(sampleRoutine);

      (apiClient.post as jest.Mock).mockResolvedValueOnce({
        status: 'OVERWRITTEN',
        routineId: 'overwritten-routine-uuid',
      });

      const res = await syncSavedRoutineWithCloud('test-jwt-token', {
        conflictResolution: 'OVERWRITE_CLOUD',
      });

      expect(res?.status).toBe('OVERWRITTEN');
      expect(res?.routineId).toBe('overwritten-routine-uuid');

      expect(apiClient.post).toHaveBeenCalledWith(
        '/care/me/routines/sync',
        expect.objectContaining({
          conflictResolution: 'OVERWRITE_CLOUD',
        }),
        { token: 'test-jwt-token' }
      );

      const updated = getSavedCustomerRoutine();
      expect(updated?.cloudRoutineId).toBe('overwritten-routine-uuid');
    });
  });
});
