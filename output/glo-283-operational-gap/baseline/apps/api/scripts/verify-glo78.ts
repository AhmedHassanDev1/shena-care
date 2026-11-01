import { PrismaService } from '../src/platform/database/prisma.service';
import { CatalogService } from '../src/modules/catalog/public';
import { SourcingService } from '../src/modules/sourcing/public';
import { CommerceService } from '../src/modules/commerce/public';
import { ProductViewService } from '../src/application/composition/services/product-view.service';
import { StorageService } from '../src/platform/storage/storage.service';
import { requireMediaReview } from '../src/platform/security/media-review';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const catalog = new CatalogService(prisma);
    const sourcing = new SourcingService(prisma, catalog);
    const commerce = new CommerceService(prisma, catalog);
    const views = new ProductViewService(catalog, commerce, sourcing);
    const storage = new StorageService();
    const quarantine = process.argv.includes('--quarantine');
    const destination = path.resolve('../../docs/verification/glo78-pilot-evidence.json');
    const previous = fs.existsSync(destination) ? JSON.parse(fs.readFileSync(destination, 'utf-8')) : null;
    const jobs = await prisma.ingestionJob.findMany({ where: { supplier: { slug: 'loreal-sa' } },
      include: { items: true }, orderBy: { createdAt: 'desc' } });
    if (!jobs.length) throw new Error('Existing pilot not found');
    const latest = jobs.find(job => job.items.length === 12);
    if (!latest) throw new Error('Existing 12-item pilot job not found');
    const quarantined = new Set<string>(previous?.pilotJobId === latest.id ? previous.quarantinedProductIds : []);
    const rows: any[] = [];
    for (const item of latest.items.sort((a, b) => a.supplierSkuCode.localeCompare(b.supplierSkuCode))) {
      const sku = item.matchedSkuId ? await prisma.sku.findUnique({ where: { id: item.matchedSkuId }, include: { product: { include: { media: true } } } }) :
        item.barcode ? await prisma.sku.findUnique({ where: { barcode: item.barcode }, include: { product: { include: { media: true } } } }) : null;
      const enrichment = item.enrichment as any;
      const media = (sku?.product.media || []).map(m => {
        let byteLength: number | null = null;
        try {
          const local = storage.getFilePath(new URL(m.url).pathname.slice('/storage/'.length));
          if (fs.existsSync(local)) byteLength = fs.statSync(local).size;
        } catch { /* Remote/missing storage object is not evidence of a verified image. */ }
        let reviewed = false;
        try {
          const receipt = requireMediaReview(m.generationMetadata);
          reviewed = receipt.skuId === sku!.id && receipt.barcode === sku!.barcode &&
            receipt.size === sku!.size?.toNumber() && receipt.sizeUnit === sku!.sizeUnit && receipt.variantName === sku!.variantName;
        } catch { /* Legacy verified label alone is insufficient. */ }
        return { id: m.id, url: m.url, storedOrigin: m.originType, byteLength, reviewed,
          actualStatus: byteLength !== null && byteLength <= 8 ? 'MOCK_INVALID_IMAGE' : reviewed ? 'REVIEWED' : 'UNVERIFIED_OR_MISSING' };
      });
      const prices = sku ? await prisma.sellingPrice.findMany({ where: { skuId: sku.id } }) : [];
      const offers = sku ? await prisma.supplierOffer.findMany({ where: { skuId: sku.id } }) : [];
      const beforePublished = sku?.product.isPublished || false;
      if (quarantine && sku && !media.some(m => m.reviewed) && !prices.length) {
        await catalog.updateProduct(sku.productId, { isPublished: false });
        quarantined.add(sku.productId);
        for (const offer of offers.filter(o => o.supplierId === latest.supplierId && !o.lastConfirmedAt)) {
          await sourcing.updateSupplierOffer(offer.id, { isAvailable: false });
        }
      }
      const currentOffers = sku ? await prisma.supplierOffer.findMany({ where: { skuId: sku.id } }) : [];
      const extracted = enrichment?.research?.extractedFacts || {};
      const sourceEvidence = (enrichment?.research?.fieldEvidences || []).map((e: any) => ({ field: e.fieldName,
        value: e.proposedValue, sourceUrl: e.sourceUrl, sourceType: e.sourceType, providerStatus: e.verificationStatus }));
      const customerVisible = sku ? !!(await views.getProductView(sku.productId)) : false;
      const commercial = sku ? await commerce.evaluateSellability(sku.id) : null;
      rows.push({ candidateId: item.id, candidateStatus: item.status, productId: sku?.productId || null,
        canonicalSku: sku ? { id: sku.id, code: sku.code, barcode: sku.barcode, size: sku.size, sizeUnit: sku.sizeUnit, variantName: sku.variantName } : null,
        supplierSkuCode: item.supplierSkuCode, brand: item.brand, name: item.name, extractedSize: extracted.size || null,
        verifiedProductFacts: media.some(m => m.reviewed) ? sourceEvidence.filter((e: any) => ['size', 'barcode'].includes(e.field)) : [], humanFactsReview: media.some(m => m.reviewed) ? 'RECORDED' : 'MISSING', sourceEvidence, media,
        sellingPrices: prices.map(p => ({ amount: p.amount, currency: p.currency, isActive: p.isActive, validFrom: p.validFrom, validUntil: p.validUntil })),
        supplierOffers: currentOffers.map(o => ({ id: o.id, demoCost: o.costPrice, currency: o.currency, isAvailable: o.isAvailable, lastConfirmedAt: o.lastConfirmedAt })),
        beforePublished: previous?.pilotJobId === latest.id ? (previous.items.find((r: any) => r.candidateId === item.id)?.beforePublished ?? beforePublished) : beforePublished, afterPublished: sku ? (await prisma.product.findUniqueOrThrow({ where: { id: sku.productId } })).isPublished : false,
        customerVisible, commerceReason: commercial?.reason || 'NO_CANONICAL_SKU', genuineSellable: media.some(m => m.reviewed) && customerVisible && commercial?.isSellable === true &&
          currentOffers.some(o => o.isAvailable && o.lastConfirmedAt !== null),
        blockers: ['authenticated supplier price and availability evidence', 'human-reviewed exact barcode/size/variant facts',
          'real licensed source packshot with review receipt', 'approved Commerce SellingPrice and listing'],
      });
    }
    const report = { inspectedAt: new Date().toISOString(), pilotJobId: latest.id, pilotStatus: latest.status,
      priorAttempts: jobs.map(j => ({ id: j.id, status: j.status, itemCount: j.items.length })),
      genuineSellableCount: rows.filter(r => r.genuineSellable).length, quarantinedProductIds: [...quarantined], items: rows };
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ pilotJobId: latest.id, items: rows.length, genuineSellable: report.genuineSellableCount,
      quarantined: quarantined.size, report: destination }));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('Pilot verification failed; inspect configuration and existing records locally.'); process.exitCode = 1; });
