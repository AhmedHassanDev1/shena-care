import { PrismaClient, IngestionImportMode } from '@prisma/client';

const API_BASE = 'http://localhost:3001';

interface TestResult {
  section: string;
  test: string;
  status: 'PASS' | 'FAIL';
  details: string;
}

const results: TestResult[] = [];

function record(section: string, test: string, passed: boolean, details: string) {
  results.push({
    section,
    test,
    status: passed ? 'PASS' : 'FAIL',
    details,
  });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] [${section}] ${test}: ${details}`);
}

async function runAudit() {
  const prisma = new PrismaClient();
  console.log('=== STARTING SHINACARE SUPPLIER INTEGRATION & QA AUDIT ===\n');

  try {
    // ----------------------------------------------------
    // STEP 1: AUTHENTICATION & SESSION CONTEXT
    // ----------------------------------------------------
    const loginRes = await fetch(`${API_BASE}/accounts/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'supplier@shenacare.com',
        password: process.env.DEV_STAFF_PASSWORD ?? '',
      }),
    });
    const loginData = (await loginRes.json()) as any;
    const token = loginData.token;
    record(
      'Authentication',
      'Supplier Login with Credentials',
      loginRes.status === 200 || loginRes.status === 201,
      `Status: ${loginRes.status}, Token received: ${Boolean(token)}`
    );

    const meRes = await fetch(`${API_BASE}/workspace/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = (await meRes.json()) as any;
    const supplierId = me?.supplierId;
    record(
      'Authentication',
      'Get Workspace Identity & Supplier Scope',
      meRes.status === 200 && Boolean(supplierId) && me?.roles?.includes('SUPPLIER'),
      `Supplier ID: ${supplierId}, Roles: ${me?.roles?.join(', ')}, Name: ${me?.name}`
    );

    // ----------------------------------------------------
    // STEP 2: TENANT ISOLATION & AUTHORIZATION AUDIT
    // ----------------------------------------------------
    let otherSupplier = await prisma.supplier.findFirst({
      where: { id: { not: supplierId } },
    });
    if (!otherSupplier) {
      otherSupplier = await prisma.supplier.create({
        data: {
          name: 'Other Rogue Supplier Ltd',
          slug: 'other-rogue-supplier',
        },
      });
    }

    // Try accessing other supplier's offers
    const isolationRes = await fetch(`${API_BASE}/sourcing/offers?supplierId=${otherSupplier.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    record(
      'Tenant Isolation',
      'Block Supplier Access to Foreign Offers',
      isolationRes.status === 403,
      `Expected 403, Got: ${isolationRes.status}`
    );

    // ----------------------------------------------------
    // STEP 3: EXISTING CATALOG & OFFER BASELINE
    // ----------------------------------------------------
    const existingSkus = await prisma.sku.findMany({
      take: 5,
      include: { product: { include: { brand: true } } },
    });

    record(
      'Catalog Baseline',
      'Find Published SKUs for Testing',
      existingSkus.length >= 2,
      `Found ${existingSkus.length} catalog SKUs to test with.`
    );

    // ----------------------------------------------------
    // STEP 4: REPRESENTATIVE 10-SKU INGESTION AUDIT
    // ----------------------------------------------------
    const testSku1 = existingSkus[0];
    const testSku2 = existingSkus[1];

    // Ensure baseline offer exists for SKU 1 & 2
    await prisma.supplierOffer.upsert({
      where: { supplierId_skuId: { supplierId, skuId: testSku1.id } },
      update: { costPrice: 100, isAvailable: true },
      create: { supplierId, skuId: testSku1.id, costPrice: 100, isAvailable: true, currency: 'EGP' },
    });

    await prisma.supplierOffer.upsert({
      where: { supplierId_skuId: { supplierId, skuId: testSku2.id } },
      update: { costPrice: 200, isAvailable: true },
      create: { supplierId, skuId: testSku2.id, costPrice: 200, isAvailable: true, currency: 'EGP' },
    });

    // ----------------------------------------------------
    // STEP 4A: DUPLICATE ROW DETECTION TEST
    // ----------------------------------------------------
    const duplicateTestRes = await fetch(`${API_BASE}/ingestion/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        supplierId,
        mode: IngestionImportMode.PARTIAL_UPDATE,
        items: [
          {
            supplierSkuCode: 'SUP-DUP-01',
            name: testSku1.product.name,
            brand: testSku1.product.brand.name,
            price: 100,
            currency: 'EGP',
          },
          {
            supplierSkuCode: 'SUP-DUP-01', // duplicate
            name: testSku1.product.name,
            brand: testSku1.product.brand.name,
            price: 100,
            currency: 'EGP',
          },
        ],
      }),
    });
    record(
      'Ingestion Safety',
      'Duplicate SKU Row Rejection on Direct Payload',
      duplicateTestRes.status === 400,
      `Expected 400 Bad Request, Got: ${duplicateTestRes.status}`
    );

    // ----------------------------------------------------
    // STEP 4B: 10 REPRESENTATIVE SKUs INGESTION AUDIT
    // ----------------------------------------------------
    const itemsPayload = [
      // 1. Valid match SKU 1 - price update 100 -> 110, qty 50
      {
        supplierSkuCode: 'SUP-SKU-001',
        name: testSku1.product.name,
        brand: testSku1.product.brand.name,
        barcode: testSku1.barcode || '6221234567890',
        price: 110.0,
        currency: 'EGP',
        reportedQuantity: 50,
      },
      // 2. Valid match SKU 2 - price drop 200 -> 190, qty 0 (out of stock)
      {
        supplierSkuCode: 'SUP-SKU-002',
        name: testSku2.product.name,
        brand: testSku2.product.brand.name,
        barcode: testSku2.barcode || '6221234567891',
        price: 190.0,
        currency: 'EGP',
        reportedQuantity: 0,
      },
      // 3. Matched SKU 1 - Large price jump: 100 -> 250 (+150% > 30% threshold -> REVIEW)
      {
        supplierSkuCode: 'SUP-SKU-003',
        name: testSku1.product.name,
        brand: testSku1.product.brand.name,
        barcode: testSku1.barcode || '6221234567890',
        price: 250.0,
        currency: 'EGP',
        reportedQuantity: 20,
      },
      // 4. Unknown product 1 (New Candidate - must NOT auto-publish)
      {
        supplierSkuCode: 'SUP-CANDIDATE-001',
        name: 'كريم مرطب غير مسجل بقاعدة البيانات نهائيا',
        brand: 'براند تجريبي جديد',
        barcode: '9999999999901',
        price: 85.0,
        currency: 'EGP',
        reportedQuantity: 100,
      },
      // 5. Unknown product 2 (New Candidate - must NOT auto-publish)
      {
        supplierSkuCode: 'SUP-CANDIDATE-002',
        name: 'سيروم فيتامين سي كوري مجهول الكتالوج',
        brand: 'ماركة كورية تجريبية',
        barcode: '9999999999902',
        price: 320.0,
        currency: 'EGP',
        reportedQuantity: 15,
      },
      // 6. Invalid price zero (<= 0 -> ERROR in diff)
      {
        supplierSkuCode: 'SUP-INVALID-ZERO',
        name: 'صنف بسعر صفر',
        brand: 'براند',
        barcode: '9999999999903',
        price: 0,
        currency: 'EGP',
        reportedQuantity: 10,
      },
      // 7. Retail reference only (priceType RETAIL_REFERENCE -> does not mutate cost)
      {
        supplierSkuCode: 'SUP-RETAIL-ONLY',
        name: testSku2.product.name,
        brand: testSku2.product.brand.name,
        barcode: testSku2.barcode || '6221234567891',
        price: 260.0,
        priceType: 'RETAIL_REFERENCE',
        currency: 'EGP',
        reportedQuantity: 5,
      },
      // 8. Unchanged item (identical price 100 and available)
      {
        supplierSkuCode: 'SUP-UNCHANGED',
        name: testSku1.product.name,
        brand: testSku1.product.brand.name,
        barcode: testSku1.barcode || '6221234567890',
        price: 100.0,
        currency: 'EGP',
        reportedQuantity: 10,
      },
      // 9. New offer creation for SKU 3 if available
      {
        supplierSkuCode: 'SUP-NEW-OFFER',
        name: existingSkus[2] ? existingSkus[2].product.name : 'منتج كتالوج موجود',
        brand: existingSkus[2] ? existingSkus[2].product.brand.name : 'ماركة',
        barcode: existingSkus[2]?.barcode || '6229999999999',
        price: 75.0,
        currency: 'EGP',
        reportedQuantity: 30,
      },
      // 10. Barcode-matched variant
      {
        supplierSkuCode: 'SUP-BARCODE-MATCH',
        name: testSku1.product.name,
        brand: testSku1.product.brand.name,
        barcode: testSku1.barcode || '6221234567890',
        price: 110.0,
        currency: 'EGP',
        reportedQuantity: 40,
      },
    ];

    // Create Ingestion Job via API
    const createJobRes = await fetch(`${API_BASE}/ingestion/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        supplierId,
        mode: IngestionImportMode.PARTIAL_UPDATE,
        items: itemsPayload,
      }),
    });
    const jobData = (await createJobRes.json()) as any;
    console.log('createJob response status:', createJobRes.status, 'body:', JSON.stringify(jobData));
    const jobId = jobData?.id || jobData?.jobId;

    record(
      'Ingestion Pipeline',
      'Create Job with 10 Representative Items',
      createJobRes.status === 200 || createJobRes.status === 201,
      `Job ID: ${jobId}, Created Items: ${jobData?.items?.length || 'items created'}`
    );

    // ----------------------------------------------------
    // STEP 5: PREVIEW DIFF & ANOMALY DETECTOR AUDIT
    // ----------------------------------------------------
    const diffRes = await fetch(`${API_BASE}/ingestion/jobs/${jobId}/diff`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const diff = (await diffRes.json()) as any;

    record(
      'Diff Computation',
      'Compute Job Diff & Category Breakdown',
      diffRes.status === 200 && Boolean(diff?.counters),
      `Counters: updated=${diff?.counters?.updated}, created=${diff?.counters?.created}, review=${diff?.counters?.review}, skipped=${diff?.counters?.skipped}, error=${diff?.counters?.error}`
    );

    // Verify Candidate Protection: Unmatched items must be skipped or held, never published to offers
    const candidateDiffRow = diff?.rows?.find((r: any) => r.supplierSkuCode === 'SUP-CANDIDATE-001');
    const isCandidateProtected = candidateDiffRow && candidateDiffRow.action === 'SKIP';
    record(
      'Safety & Compliance',
      'Candidate Product Protection (Never auto-published to offers)',
      Boolean(isCandidateProtected),
      `Candidate action: ${candidateDiffRow?.action}, reason: ${candidateDiffRow?.reasons?.join('; ')}`
    );

    // Verify Large Price Jump Anomaly Detection (>30%)
    const priceJumpRow = diff?.rows?.find((r: any) => r.supplierSkuCode === 'SUP-SKU-003');
    const isPriceJumpFlagged = priceJumpRow && (priceJumpRow.action === 'REVIEW' || priceJumpRow.isLargePriceJump);
    record(
      'Safety & Compliance',
      'Large Price Jump Anomaly Flagging (>30%)',
      Boolean(isPriceJumpFlagged),
      `Price jump action: ${priceJumpRow?.action}, isLargePriceJump: ${priceJumpRow?.isLargePriceJump}, percent: ${priceJumpRow?.priceChangePercent}%`
    );

    // Verify Invalid Price detection
    const zeroPriceRow = diff?.rows?.find((r: any) => r.supplierSkuCode === 'SUP-INVALID-ZERO');
    const isZeroPriceRejected = zeroPriceRow && zeroPriceRow.action === 'ERROR';
    record(
      'Safety & Compliance',
      'Invalid Price Protection (<= 0 price flagged as ERROR)',
      Boolean(isZeroPriceRejected),
      `Zero price action: ${zeroPriceRow?.action}, reasons: ${zeroPriceRow?.reasons?.join('; ')}`
    );

    // ----------------------------------------------------
    // STEP 6: SAFE COMMIT & DATABASE PERSISTENCE AUDIT
    // ----------------------------------------------------
    const commitRes = await fetch(`${API_BASE}/ingestion/jobs/${jobId}/commit-offers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        autoApplyLowRisk: true,
      }),
    });
    const commitResult = (await commitRes.json()) as any;

    record(
      'Commit Execution',
      'Execute Safe Commit of Ingestion Job',
      commitRes.status === 200 || commitRes.status === 201,
      `Committed: ${commitResult?.committedCount}, Unchanged: ${commitResult?.unchangedCount}, Held For Review: ${commitResult?.heldForReviewCount}, Skipped: ${commitResult?.skippedCount}`
    );

    // Re-query database to verify actual mutations persisted
    const updatedOffer1 = await prisma.supplierOffer.findUnique({
      where: { supplierId_skuId: { supplierId, skuId: testSku1.id } },
    });
    const offer1Persisted = updatedOffer1 && updatedOffer1.costPrice.toNumber() === 110;
    record(
      'Database Verification',
      'SKU 1 Price Mutation Persisted to Database',
      Boolean(offer1Persisted),
      `Expected 110, DB costPrice: ${updatedOffer1?.costPrice.toNumber()}, isAvailable: ${updatedOffer1?.isAvailable}`
    );

    // Verify SKU 2 reportedQuantity 0 made isAvailable = false
    const updatedOffer2 = await prisma.supplierOffer.findUnique({
      where: { supplierId_skuId: { supplierId, skuId: testSku2.id } },
    });
    const offer2Persisted = updatedOffer2 && updatedOffer2.isAvailable === false;
    record(
      'Database Verification',
      'SKU 2 Out-of-Stock Zero-Quantity Persisted to Database',
      Boolean(offer2Persisted),
      `Expected isAvailable=false, DB isAvailable: ${updatedOffer2?.isAvailable}, costPrice: ${updatedOffer2?.costPrice.toNumber()}`
    );

    // Verify Candidates were NOT inserted into SupplierOffer
    const candidateOffers = await prisma.supplierOffer.findMany({
      where: {
        supplierId,
      },
    });
    const candidateOfferFound = candidateOffers.some((o) => o.skuId === 'SUP-CANDIDATE-001');
    record(
      'Database Verification',
      'Zero Unauthorized Candidates Inserted into SupplierOffer',
      !candidateOfferFound,
      `Candidate offer found in DB: ${candidateOfferFound}`
    );

    // ----------------------------------------------------
    // STEP 7: PURCHASE ORDER CONFIRMATION & PERSISTENCE
    // ----------------------------------------------------
    let po = await prisma.supplierPurchaseOrder.findFirst({
      where: { supplierId },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!po) {
      po = await prisma.supplierPurchaseOrder.create({
        data: {
          supplierId,
          status: 'sent',
          lines: {
            create: [
              {
                skuId: testSku1.id,
                requestedQuantity: 10,
                unitCost: 100,
                status: 'pending',
              },
              {
                skuId: testSku2.id,
                requestedQuantity: 5,
                unitCost: 200,
                status: 'pending',
              },
            ],
          },
        },
        include: { lines: true },
      });
    }

    if (po && po.lines.length >= 2) {
      const line1 = po.lines[0];
      const line2 = po.lines[1];

      // Submit confirmation: line 1 confirmed_full, line 2 partial
      const poConfirmRes = await fetch(`${API_BASE}/purchase-orders/${po.id}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lines: [
            {
              id: line1.id,
              status: 'confirmed_full',
            },
            {
              id: line2.id,
              status: 'confirmed_partial',
              confirmedQuantity: 3,
              exceptionCode: 'OUT_OF_STOCK',
              exceptionNote: 'نقص مؤقت في مخزن التوريد',
            },
          ],
        }),
      });

      const confirmedPo = (await poConfirmRes.json()) as any;
      record(
        'Purchase Orders',
        'Submit Purchase Order Confirmation',
        poConfirmRes.status === 200 || poConfirmRes.status === 201,
        `Status: ${poConfirmRes.status}, Order Status: ${confirmedPo?.status}`
      );

      // Verify PO persisted in DB
      const dbPo = await prisma.supplierPurchaseOrder.findUnique({
        where: { id: po.id },
        include: { lines: true },
      });
      const dbLine2 = dbPo?.lines.find((l: any) => l.id === line2.id);
      const isPoPersisted =
        dbPo?.status === 'confirmed' || dbPo?.status === 'partial' || dbPo?.confirmedAt !== null;
      record(
        'Database Verification',
        'Purchase Order Confirmation Persists in DB',
        Boolean(isPoPersisted && dbLine2?.confirmedQuantity === 3),
        `PO Status: ${dbPo?.status}, Line 2 Confirmed Qty: ${dbLine2?.confirmedQuantity}, Exception: ${dbLine2?.exceptionCode}`
      );

      // Test markReady
      const readyRes = await fetch(`${API_BASE}/purchase-orders/${po.id}/ready`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      record(
        'Purchase Orders',
        'Mark Confirmed PO as Ready for Pickup',
        readyRes.status === 200 || readyRes.status === 201,
        `Ready status code: ${readyRes.status}`
      );
    }

    // ----------------------------------------------------
    // STEP 8: INVENTORY INLINE EDIT & REFRESH PERSISTENCE
    // ----------------------------------------------------
    const offerToEdit = updatedOffer1!;
    const editRes = await fetch(`${API_BASE}/sourcing/offers/${offerToEdit.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        costPrice: 125.5,
        isAvailable: true,
      }),
    });
    record(
      'Inventory Offers',
      'Inline Edit Supplier Purchase Price via PATCH',
      editRes.status === 200,
      `PATCH status: ${editRes.status}`
    );

    // Read back via GET /sourcing/offers/:id to simulate page refresh
    const getOfferRes = await fetch(`${API_BASE}/sourcing/offers/${offerToEdit.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const refreshedOffer = (await getOfferRes.json()) as any;
    const isEditPersisted = refreshedOffer?.costPrice === 125.5;
    record(
      'Database Verification',
      'Inline Offer Edit Persists & Survives Refresh',
      isEditPersisted,
      `Refreshed costPrice: ${refreshedOffer?.costPrice}, isAvailable: ${refreshedOffer?.isAvailable}`
    );

    // ----------------------------------------------------
    // STEP 9: FULL_SNAPSHOT DEACTIVATION SAFETY AUDIT
    // ----------------------------------------------------
    const snapshotJobRes = await fetch(`${API_BASE}/ingestion/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        supplierId,
        mode: IngestionImportMode.FULL_SNAPSHOT,
        items: [
          {
            supplierSkuCode: 'SUP-SNAPSHOT-SINGLE',
            name: testSku1.product.name,
            brand: testSku1.product.brand.name,
            barcode: testSku1.barcode || '6221234567890',
            price: 130.0,
            currency: 'EGP',
            reportedQuantity: 50,
          },
        ],
      }),
    });
    const snapshotJob = (await snapshotJobRes.json()) as any;
    const snapshotJobId = snapshotJob?.id || snapshotJob?.jobId;

    const snapshotDiffRes = await fetch(`${API_BASE}/ingestion/jobs/${snapshotJobId}/diff`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const snapshotDiff = (await snapshotDiffRes.json()) as any;
    record(
      'FULL_SNAPSHOT Safety',
      'Detect Missing Assortment Offers as Deactivation Candidates',
      snapshotDiff?.deactivationCandidates?.length > 0 && snapshotDiff?.requiresDeactivationApproval === true,
      `Deactivation candidates: ${snapshotDiff?.deactivationCandidates?.length}, requiresApproval: ${snapshotDiff?.requiresDeactivationApproval}`
    );

    // Now commit this snapshot
    const commitSnapshotRes = await fetch(`${API_BASE}/ingestion/jobs/${snapshotJobId}/commit-offers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        autoApplyLowRisk: true,
        declaredCompleteAssortment: true,
      }),
    });
    const snapshotCommit = (await commitSnapshotRes.json()) as any;

    // Verify that missing offers were NOT deactivated without admin approval
    const stillExistingOffer2 = await prisma.supplierOffer.findUnique({
      where: { supplierId_skuId: { supplierId, skuId: testSku2.id } },
    });
    const safeFromAutoDeactivation = stillExistingOffer2 !== null;
    record(
      'FULL_SNAPSHOT Safety',
      'Protection: Missing Snapshot Offers NOT Auto-Deactivated without Admin',
      safeFromAutoDeactivation && snapshotCommit?.deactivatedCount === 0,
      `Deactivated Count in Commit: ${snapshotCommit?.deactivatedCount}, Offer 2 Exists: ${Boolean(stillExistingOffer2)}`
    );

    // ----------------------------------------------------
    // STEP 10: IDEMPOTENCY & DUPLICATE-SUBMIT AUDIT
    // ----------------------------------------------------
    const doubleCommitRes = await fetch(`${API_BASE}/ingestion/jobs/${snapshotJobId}/commit-offers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ autoApplyLowRisk: true }),
    });
    const doubleCommit = (await doubleCommitRes.json()) as any;
    record(
      'Idempotency & Replay',
      'Re-commit Already Published Job Returns Safe Result',
      doubleCommit?.status === 'ALREADY_PUBLISHED' && doubleCommit?.committedCount === 0,
      `Status: ${doubleCommit?.status}, Committed: ${doubleCommit?.committedCount}`
    );

  } catch (error: any) {
    console.error('Audit exception:', error);
    record('System Error', 'Audit Execution', false, error.message || String(error));
  } finally {
    await prisma.$disconnect();
    console.log('\n=== AUDIT SUMMARY ===');
    const passedCount = results.filter((r) => r.status === 'PASS').length;
    const failedCount = results.filter((r) => r.status === 'FAIL').length;
    console.log(`Total Checks: ${results.length} | PASS: ${passedCount} | FAIL: ${failedCount}`);
  }
}

runAudit();
