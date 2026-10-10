import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/platform/database/prisma.service';
import { IngestionService } from '../src/modules/ingestion/services/ingestion.service';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const ingestionService = app.get(IngestionService);
  
  // 1. Setup a real supplier
  const supplier = await prisma.supplier.upsert({
    where: { name: 'Loreal Distribution SA' },
    update: {},
    create: { name: 'Loreal Distribution SA', slug: 'loreal-sa' },
  });

  const products = [
    { supplierSkuCode: 'CER-1001', name: 'CeraVe Moisturizing Cream', brand: 'CeraVe', barcode: '3606000537736', price: 95.0, currency: 'SAR' },
    { supplierSkuCode: 'LRP-2001', name: 'Anthelios UVmune 400 Invisible Fluid SPF50+', brand: 'La Roche-Posay', barcode: '3337875797597', price: 125.0, currency: 'SAR' },
    { supplierSkuCode: 'VIC-3001', name: 'Minéral 89 Hyaluronic Acid Booster', brand: 'Vichy', barcode: '3337875543248', price: 140.0, currency: 'SAR' },
    { supplierSkuCode: 'CER-1002', name: 'CeraVe Hydrating Facial Cleanser', brand: 'CeraVe', barcode: '3606000537743', price: 85.0, currency: 'SAR' },
    { supplierSkuCode: 'LRP-2002', name: 'La Roche-Posay Effaclar Purifying Foaming Gel', brand: 'La Roche-Posay', barcode: '3337872411083', price: 110.0, currency: 'SAR' },
    { supplierSkuCode: 'VIC-3002', name: 'Vichy Normaderm Phytosolution', brand: 'Vichy', barcode: '3337875660617', price: 135.0, currency: 'SAR' },
    { supplierSkuCode: 'EUC-4001', name: 'Eucerin Oil Control Sun Gel-Cream SPF 50+', brand: 'Eucerin', barcode: '4005800119339', price: 115.0, currency: 'SAR' },
    { supplierSkuCode: 'EUC-4002', name: 'Eucerin DermatoCLEAN Cleansing Gel', brand: 'Eucerin', barcode: '4005800270054', price: 90.0, currency: 'SAR' },
    { supplierSkuCode: 'AVE-5001', name: 'Avene Thermal Spring Water', brand: 'Avene', barcode: '3282779003126', price: 75.0, currency: 'SAR' },
    { supplierSkuCode: 'AVE-5002', name: 'Avene Cicalfate+ Cream', brand: 'Avene', barcode: '3282770204665', price: 85.0, currency: 'SAR' },
    { supplierSkuCode: 'BDR-6001', name: 'Bioderma Sensibio H2O Micellar Water', brand: 'Bioderma', barcode: '3401395376874', price: 105.0, currency: 'SAR' },
    { supplierSkuCode: 'BDR-6002', name: 'Bioderma Atoderm Intensive Baume', brand: 'Bioderma', barcode: '3401399373466', price: 145.0, currency: 'SAR' },
  ];

  console.log('--- STARTING GLO-78 PILOT BATCH ---');

  // 2. Create Job
  const job = await ingestionService.createJob({
    supplierId: supplier.id,
    items: products
  });
  console.log(`Created Job ID: ${job.id}`);
  
  // Wait for async matching
  await new Promise(r => setTimeout(r, 2000));

  const candidates = await ingestionService.getCandidates();
  
  for (const p of products) {
    const candidate = candidates.find(c => c.supplierSkuCode === p.supplierSkuCode);
    if (!candidate) {
      console.log(`❌ ${p.name} - Candidate not found`);
      continue;
    }

    try {
      const id = candidate.id as string;
      console.log(`\nProcessing: ${p.name}`);
      
      // 3. Research Evidence
      console.log(`- Fetching research evidence...`);
      await ingestionService.researchCandidate(id);
      
      // 4. Generate Content
      console.log(`- Generating content...`);
      await ingestionService.generateCandidateContent(id);
      
      // 5. Upload Verified Media (Mock file)
      console.log(`- Uploading media...`);
      const dummyPath = 'dummy.png';
      fs.writeFileSync(dummyPath, Buffer.from('89504E470D0A1A0A', 'hex'));
      const mockFile = { originalname: 'image.png', buffer: fs.readFileSync(dummyPath), mimetype: 'image/png' } as any;
      const uploaded = await ingestionService.uploadCandidateMedia(id, mockFile);
      fs.unlinkSync(dummyPath);
      
      // 6. Review & Approve
      console.log(`- Approving candidate...`);
      await ingestionService.approveItem(id, { verifiedMediaUrls: [uploaded.url] });
      
      // 7. Publish
      console.log(`- Publishing...`);
      const pubResult = await ingestionService.publishCandidate(id);
      
      console.log(`✅ SUCCESS: ${p.name} published as SKU ${pubResult.matchedSkuId}`);
    } catch (e) {
      console.log(`❌ BLOCKED: ${p.name} - ${(e as Error).message}`);
    }
  }

  await app.close();
  process.exit(0);
}
bootstrap();
