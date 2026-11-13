import { MediaProcessingStatus, MediaReviewStatus, MediaRole } from '@prisma/client';
import { CatalogEnrichmentService } from '../../src/application/composition/services/intake/catalog-enrichment.service';
import { ProductMediaService } from '../../src/modules/catalog/services/product-media.service';

describe('durable, deferred catalog enhancement', () => {
  it('finishes intake with the approved original and a pending enhancement without running a processor', async () => {
    const original = { id: 'original', role: MediaRole.PRIMARY_PACKSHOT, parentAssetId: null, reviewStatus: MediaReviewStatus.APPROVED };
    const pending = { id: 'copy', processingStatus: MediaProcessingStatus.PENDING, reviewStatus: MediaReviewStatus.PENDING_REVIEW };
    const media = { listForSku: jest.fn().mockResolvedValue([original]), requestEditorial: jest.fn().mockResolvedValue(pending), derive: jest.fn(() => { throw new Error('must not run the worker'); }) };
    const templates = { ensureDefaultTemplate: jest.fn() };
    const service = new CatalogEnrichmentService(undefined!, undefined!, media as never, templates as never, undefined!, undefined!, undefined!, undefined!);
    await expect(service.prepareMedia('sku', 'actor')).resolves.toEqual({ primary: 'APPROVED', editorial: 'PENDING', rejectedSources: [] });
    expect(media.requestEditorial).toHaveBeenCalledWith('original', 'actor');
    expect(media.derive).not.toHaveBeenCalled();
    expect(original).toEqual({ id: 'original', role: MediaRole.PRIMARY_PACKSHOT, parentAssetId: null, reviewStatus: MediaReviewStatus.APPROVED });
  });

  it('persists one pending derivative idempotently and preserves an existing failure for explicit retry', async () => {
    const parent = { id: 'original', skuId: 'sku', role: MediaRole.PRIMARY_PACKSHOT, sourceUrl: 'https://cerave.com/product', createdBy: 'actor' };
    const template = { id: 'template', templateKey: 'approved', version: 1 };
    const failed = { id: 'copy', processingStatus: MediaProcessingStatus.FAILED, processingError: 'NEURAL_SEGMENTATION_FAILED' };
    const prisma = { mediaAsset: { upsert: jest.fn().mockResolvedValueOnce({ id: 'copy', processingStatus: 'PENDING' }).mockResolvedValueOnce(failed) } };
    const processor = { composeOnTemplate: jest.fn() };
    const service = new ProductMediaService(prisma as never, undefined!, undefined!, processor as never, undefined!, { resolveForSku: jest.fn().mockResolvedValue(template) } as never);
    jest.spyOn(service as never, 'assertReviewer' as never).mockResolvedValue(undefined as never);
    jest.spyOn(service as never, 'getAsset' as never).mockResolvedValue(parent as never);
    await expect(service.requestEditorial('original', 'actor')).resolves.toMatchObject({ processingStatus: 'PENDING' });
    await expect(service.requestEditorial('original', 'actor')).resolves.toBe(failed);
    expect(prisma.mediaAsset.upsert.mock.calls[0][0]).toMatchObject({ update: {}, create: { parentAssetId: 'original', role: 'CATEGORY_EDITORIAL', processingStatus: 'PENDING' } });
    expect(processor.composeOnTemplate).not.toHaveBeenCalled();
  });

  it('refuses a non-staff actor before reading or scheduling an asset', async () => {
    const prisma = { customer: { findUnique: jest.fn().mockResolvedValue({ roles: ['CUSTOMER'] }) }, mediaAsset: { findUnique: jest.fn(), upsert: jest.fn() } };
    const service = new ProductMediaService(prisma as never, undefined!, undefined!, undefined!, undefined!, undefined!);
    await expect(service.requestEditorial('original', 'actor')).rejects.toThrow('Media review requires internal staff');
    expect(prisma.mediaAsset.findUnique).not.toHaveBeenCalled();
    expect(prisma.mediaAsset.upsert).not.toHaveBeenCalled();
  });
});
