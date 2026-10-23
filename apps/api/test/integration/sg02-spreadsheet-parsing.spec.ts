import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/platform/database/prisma.service';
import { createActor, Actor } from '../fixtures/actors';
import { IngestionService } from '../../src/modules/ingestion/services/ingestion.service';
import { SpreadsheetParserService } from '../../src/modules/ingestion/services/spreadsheet-parser.service';
import { FormatFingerprintService } from '../../src/modules/ingestion/services/format-fingerprint.service';
import { ExportProfileService } from '../../src/modules/ingestion/services/export-profile.service';
import { FILE_STORAGE_PORT, FileStoragePort } from '../../src/platform/storage/storage.port';
import { IngestionStatus, IngestionPriceType } from '@prisma/client';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';

describe('SG-02: Secure CSV/XLSX Parse, Format Fingerprints & Mapping Approval (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let ingestionService: IngestionService;
  let parserService: SpreadsheetParserService;
  let fingerprintService: FormatFingerprintService;
  let profileService: ExportProfileService;

  let supplier1Id: string;
  let supplier2Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    ingestionService = app.get(IngestionService);
    parserService = app.get(SpreadsheetParserService);
    fingerprintService = app.get(FormatFingerprintService);
    profileService = app.get(ExportProfileService);

    admin = await createActor(prisma, 'ADMIN');

    const s1 = await prisma.supplier.create({
      data: { name: `SG02 Supplier Alpha ${Date.now()}`, slug: `sg02-alpha-${Date.now()}` },
    });
    supplier1Id = s1.id;

    const s2 = await prisma.supplier.create({
      data: { name: `SG02 Supplier Beta ${Date.now()}`, slug: `sg02-beta-${Date.now()}` },
    });
    supplier2Id = s2.id;
  });

  afterAll(async () => {
    if (!app) return;
    const suppliers = [supplier1Id, supplier2Id].filter(Boolean);
    const storagePort = app.get<FileStoragePort>(FILE_STORAGE_PORT);
    for (const job of await prisma.ingestionJob.findMany({ where: { supplierId: { in: suppliers } } })) {
      if (job.sourceKey) await storagePort.delete(job.sourceKey);
    }
    await prisma.ingestionItem.deleteMany({ where: { job: { supplierId: { in: suppliers } } } });
    await prisma.ingestionJob.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.exportProfile.deleteMany({ where: { supplierId: { in: suppliers } } });
    await prisma.supplier.deleteMany({ where: { id: { in: suppliers } } });
    await prisma.session.deleteMany({ where: { customerId: admin.id } });
    await prisma.customer.deleteMany({ where: { id: admin.id } });
    await app.close();
  });

  describe('1. SpreadsheetParserService & Security Guards', () => {
    it('parses valid CSV and sanitizes formula injection attempts', () => {
      const csvContent =
        'كود الصنف,اسم المنتج,سعر الشراء,الكمية,ملاحظات\n' +
        'SKU-101,CeraVe Hydrating Cleanser,45.50,150,Safe note\n' +
        'SKU-102,La Roche-Posay Anthelios,85.00,75,=cmd|\'/C calc\'!A0\n' +
        'SKU-103,Ordinary Niacinamide,32.00,200,@dangerousFormula\n';

      const buffer = Buffer.from(csvContent, 'utf-8');
      const parsed = parserService.parseSpreadsheet(buffer, 'test-catalog.csv');

      expect(parsed.headers).toEqual(['كود الصنف', 'اسم المنتج', 'سعر الشراء', 'الكمية', 'ملاحظات']);
      expect(parsed.totalDataRows).toBe(3);
      expect(parsed.headerRowIndex).toBe(1);

      // Verify formula injection sanitization
      const row2 = parsed.rows[1].data;
      expect(row2['ملاحظات']).toBe('\'=cmd|\'/C calc\'!A0'); // sanitized with single quote

      const row3 = parsed.rows[2].data;
      expect(row3['ملاحظات']).toBe('\'@dangerousFormula'); // sanitized with single quote
    });

    it('parses native XLSX buffers and extracts traceable row coordinates', () => {
      const wb = XLSX.utils.book_new();
      const wsData = [
        ['', '', ''], // empty preamble rows
        ['Supplier SKU', 'Product Description', 'Verified Buy Cost', 'Available Qty', 'Barcode'],
        ['AL-001', 'Bioderma Sensibio H2O 500ml', 55.0, 120, '3401572288190'],
        ['AL-002', 'Vichy Mineral 89 Serum 50ml', 78.5, 60, '3337875543248'],
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'CatalogSheet');
      const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const parsed = parserService.parseSpreadsheet(xlsxBuffer, 'supplier_export.xlsx');

      expect(parsed.sheets).toEqual(['CatalogSheet']);
      expect(parsed.activeSheet).toBe('CatalogSheet');
      expect(parsed.headerRowIndex).toBe(2); // 1-indexed row 2 is the discovered header row
      expect(parsed.headers).toEqual(['Supplier SKU', 'Product Description', 'Verified Buy Cost', 'Available Qty', 'Barcode']);
      expect(parsed.totalDataRows).toBe(2);
      expect(parsed.rows[0].sourceRow).toBe(3); // line 3 in spreadsheet
      expect(parsed.rows[0].data['Supplier SKU']).toBe('AL-001');
    });

    it('rejects disguised executables, malformed archives, and empty files with actionable errors', () => {
      // Disguised PE (MZ header)
      const mzBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
      expect(() => parserService.parseSpreadsheet(mzBuffer, 'malicious.xlsx')).toThrow(BadRequestException);

      // Malformed XLSX (wrong magic bytes)
      const corruptXlsx = Buffer.from('Not a zip file at all, just text');
      expect(() => parserService.parseSpreadsheet(corruptXlsx, 'corrupt.xlsx')).toThrow(BadRequestException);

      // Null bytes in CSV
      const corruptCsv = Buffer.from([0x61, 0x62, 0x00, 0x63, 0x64]);
      expect(() => parserService.parseSpreadsheet(corruptCsv, 'bad.csv')).toThrow(BadRequestException);
    });
  });

  describe('2. Format Fingerprint & Mapping Heuristic Proposal', () => {
    it('generates deterministic format fingerprint that changes on column reordering or addition', () => {
      const headers1 = ['Supplier SKU', 'Product Name', 'Price', 'Qty'];
      const headers2 = ['Supplier SKU', 'Product Name', 'Price', 'Qty'];
      const headersReordered = ['Product Name', 'Supplier SKU', 'Price', 'Qty'];
      const headersWithExtra = ['Supplier SKU', 'Product Name', 'Price', 'Qty', 'Notes'];

      const fp1 = fingerprintService.computeFingerprint(headers1, ['Sheet1']);
      const fp2 = fingerprintService.computeFingerprint(headers2, ['Sheet1']);
      const fpReordered = fingerprintService.computeFingerprint(headersReordered, ['Sheet1']);
      const fpExtra = fingerprintService.computeFingerprint(headersWithExtra, ['Sheet1']);

      expect(fp1).toBe(fp2); // identical structure -> identical fingerprint
      expect(fp1).not.toBe(fpReordered); // reordered -> different fingerprint
      expect(fp1).not.toBe(fpExtra); // new header -> different fingerprint
    });

    it('proposes accurate rule-based column mapping across Arabic and English cues', () => {
      const headers = ['كود الصنف', 'اسم المنتج', 'سعر الشراء', 'الرصيد', 'الباركود', 'ملاحظات المستودع'];
      const proposal = profileService.proposeMapping(headers);

      expect(proposal.isComplete).toBe(false); // Currency must be approved when absent from the source headers.
      expect(proposal.mapping.supplierSku).toBe('كود الصنف');
      expect(proposal.mapping.name).toBe('اسم المنتج');
      expect(proposal.mapping.price).toBe('سعر الشراء');
      expect(proposal.mapping.quantity).toBe('الرصيد');
      expect(proposal.mapping.barcode).toBe('الباركود');
      expect(proposal.unmappedHeaders).toContain('ملاحظات المستودع');
    });
  });

  describe('3. End-to-End Ingestion Flow with Format Fingerprint & Approved Profiles', () => {
    const csvLayoutA1 =
      'كود الصنف,اسم المنتج,سعر الشراء,المخزون,الباركود\n' +
      'SKU-A01,Eucerin Sun Fluid SPF 50,68.00,80,4005800098765\n' +
      'SKU-A02,Bioderma Sebium Gel Moussant,42.50,110,3401578654321\n';

    const csvLayoutA2 =
      'كود الصنف,اسم المنتج,سعر الشراء,المخزون,الباركود\n' +
      'SKU-A03,Avene Thermal Spring Water 300ml,38.00,95,3282779003131\n' +
      'SKU-A04,La Roche-Posay Effaclar Duo+,59.00,70,3337872414084\n';

    let job1Id: string;
    let formatFingerprintA: string;
    let approvedProfileId: string;

    it('Upload 1 (Unknown Layout): transitions to review_required, proposes mapping, does NOT false-publish', async () => {
      const file: Express.Multer.File = {
        buffer: Buffer.from(csvLayoutA1, 'utf-8'),
        originalname: 'supplier_catalog_run1.csv',
        mimetype: 'text/csv',
        size: Buffer.byteLength(csvLayoutA1),
        fieldname: 'file',
        encoding: '7bit',
        destination: '',
        filename: '',
        path: '',
        stream: null as any,
      };

      const result = await ingestionService.uploadSupplierSpreadsheet(supplier1Id, file);

      expect(result.jobId).toBeDefined();
      expect(result.status).toBe(IngestionStatus.review_required);
      expect(result.requiresMapping).toBe(true);
      expect(result.formatFingerprint).toBeDefined();
      expect(result.proposedMapping?.supplierSku).toBe('كود الصنف');
      expect(result.proposedMapping?.name).toBe('اسم المنتج');
      expect(result.proposedMapping?.price).toBe('سعر الشراء');

      job1Id = result.jobId;
      formatFingerprintA = result.formatFingerprint!;

      // Verify no items were imported yet because mapping is unapproved
      const jobInDb = await prisma.ingestionJob.findUnique({
        where: { id: job1Id },
        include: { items: true },
      });
      expect(jobInDb?.status).toBe(IngestionStatus.review_required);
      expect(jobInDb?.items.length).toBe(0); // Zero items admitted without approval
    });

    it('Double click / Retry: returns existing job safely without duplicating side effects', async () => {
      const file: Express.Multer.File = {
        buffer: Buffer.from(csvLayoutA1, 'utf-8'),
        originalname: 'supplier_catalog_run1.csv',
        mimetype: 'text/csv',
        size: Buffer.byteLength(csvLayoutA1),
        fieldname: 'file',
        encoding: '7bit',
        destination: '',
        filename: '',
        path: '',
        stream: null as any,
      };

      const retryResult = await ingestionService.uploadSupplierSpreadsheet(supplier1Id, file);
      expect(retryResult.jobId).toBe(job1Id);
      expect(retryResult.reused).toBe(true);
    });

    it('Review & Approve Mapping: creates approved profile, transitions job to pending, imports items', async () => {
      const applyResult = await ingestionService.applyJobMapping(
        job1Id,
        supplier1Id,
        {
          mapping: {
            supplierSku: 'كود الصنف',
            name: 'اسم المنتج',
            price: 'سعر الشراء',
            currency: 'SAR',
            quantity: 'المخزون',
            barcode: 'الباركود',
            // GLO-274: an approving reviewer must state what the price and quantity columns mean.
            semantics: { documentKind: 'STOCK_FEED', priceBasis: 'UNIT_PURCHASE_COST', quantityBasis: 'ON_HAND' },
          },
          profileName: 'Supplier 1 Standard Arabic CSV Profile',
        },
        admin.id,
      );

      expect(applyResult.status).toBe(IngestionStatus.pending);
      expect(applyResult.importedItemsCount).toBe(2);
      expect(applyResult.profileId).toBeDefined();
      approvedProfileId = applyResult.profileId;

      // Verify items are now present in DB with traceable coordinates & raw row data
      const items = await prisma.ingestionItem.findMany({ where: { jobId: job1Id }, orderBy: { supplierSkuCode: 'asc' } });
      expect(items.length).toBe(2);
      expect(items[0].supplierSkuCode).toBe('SKU-A01');
      expect(items[0].price.toNumber()).toBe(68.0);
      expect(items[0].reportedQuantity).toBe(80);
      expect((items[0].enrichment as any)?.source?.rawRow['اسم المنتج']).toBe('Eucerin Sun Fluid SPF 50');
    });

    it('Upload 2 (New File, Same Layout): recognizes approved profile, auto-extracts items without AI', async () => {
      const file2: Express.Multer.File = {
        buffer: Buffer.from(csvLayoutA2, 'utf-8'),
        originalname: 'supplier_catalog_run2.csv',
        mimetype: 'text/csv',
        size: Buffer.byteLength(csvLayoutA2),
        fieldname: 'file',
        encoding: '7bit',
        destination: '',
        filename: '',
        path: '',
        stream: null as any,
      };

      const result2 = await ingestionService.uploadSupplierSpreadsheet(supplier1Id, file2);

      // Instantly matches approved profile!
      expect(result2.status).toBe(IngestionStatus.pending);
      expect(result2.requiresMapping).toBe(false);
      expect(result2.profileId).toBe(approvedProfileId);
      expect(result2.formatFingerprint).toBe(formatFingerprintA);
      expect(result2.importedItemsCount).toBe(2);

      // Verify items were extracted deterministically
      const itemsJob2 = await prisma.ingestionItem.findMany({ where: { jobId: result2.jobId } });
      expect(itemsJob2.length).toBe(2);
      expect(itemsJob2.map((i) => i.supplierSkuCode).sort()).toEqual(['SKU-A03', 'SKU-A04']);
    });

    it('Cross-Supplier Isolation: Supplier 2 uploading identical layout CANNOT reuse Supplier 1 profile', async () => {
      const fileSupplier2: Express.Multer.File = {
        buffer: Buffer.from(csvLayoutA1, 'utf-8'),
        originalname: 'supplier2_catalog.csv',
        mimetype: 'text/csv',
        size: Buffer.byteLength(csvLayoutA1),
        fieldname: 'file',
        encoding: '7bit',
        destination: '',
        filename: '',
        path: '',
        stream: null as any,
      };

      const resultS2 = await ingestionService.uploadSupplierSpreadsheet(supplier2Id, fileSupplier2);

      // Supplier 2 must go through their own review & approval, cannot use Supplier 1's profile!
      expect(resultS2.status).toBe(IngestionStatus.review_required);
      expect(resultS2.requiresMapping).toBe(true);
      expect(resultS2.profileId).toBeUndefined();

      // Supplier 2 cannot apply mapping to Supplier 1's job
      await expect(
        ingestionService.applyJobMapping(
          job1Id,
          supplier2Id, // mismatched supplier
          {
            mapping: { supplierSku: 'كود الصنف', name: 'اسم المنتج', price: 'سعر الشراء' },
          },
          'intruder',
        ),
      ).rejects.toThrow(ForbiddenException);

      // Supplier 2 cannot approve Supplier 1's profile
      await expect(
        ingestionService.approveProfile(supplier2Id, approvedProfileId, 'intruder'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
