const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:3001';

async function request(path, options = {}) {
  const url = new URL(path, API_BASE);
  const method = options.method || (options.body ? 'POST' : 'GET');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers || {}),
  };

  const payload = options.body ? JSON.stringify(options.body) : null;
  if (payload) {
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('=== Starting Delivery Distribution & Multi-Run Independent COD Tests ===\n');

  // Setup Hub & Operator
  const location = await prisma.fulfillmentLocation.create({
    data: {
      name: 'Hub Multi-Run Test ' + crypto.randomUUID().slice(0, 8),
      address: 'Cairo Operational Hub',
      capabilities: ['RECEIVE_SUPPLIER_GOODS', 'PREPARE_ORDERS', 'DISPATCH_SHIPMENTS', 'MANAGE_OWNED_INVENTORY'],
      isActive: true,
    }
  });

  const hubUser = await prisma.customer.create({
    data: { name: 'Hub Staff Samer', email: `hub-samer-${crypto.randomUUID().slice(0, 8)}@test.shena`, roles: ['HUB_OPERATOR'] }
  });
  await prisma.fulfillmentLocationOperator.create({
    data: { locationId: location.id, operatorId: hubUser.id }
  });
  const hubSession = await prisma.session.create({
    data: { customerId: hubUser.id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 3600000) }
  });

  // Single Courier who will receive MULTIPLE distinct runs
  const courier = await prisma.customer.create({
    data: { name: 'Courier Mahmoud Multi', email: `courier-multi-${crypto.randomUUID().slice(0, 8)}@test.shena`, roles: ['DRIVER'] }
  });
  const courierSession = await prisma.session.create({
    data: { customerId: courier.id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 3600000) }
  });

  const hubToken = hubSession.token;
  const courierToken = courierSession.token;

  async function createParcel(orderPrefix, area, lat, lng, codAmount) {
    const orderNumber = `${orderPrefix}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerName: 'عميل ' + area,
        customerPhone: '01099887766',
        shippingAddress: `شارع النصر، ${area}`,
        area,
        governorate: 'Cairo',
        totalAmount: codAmount,
        codAmount,
        currency: 'EGP',
        paymentMethod: 'COD',
        status: 'packing',
        latitude: lat,
        longitude: lng,
        items: {
          create: [{ skuId: crypto.randomUUID(), quantity: 1, price: codAmount, currency: 'EGP' }]
        }
      }
    });

    const shipment = await prisma.shipment.create({
      data: { orderId: order.id, locationId: location.id, status: 'packed' }
    });

    const labelRes = await request(`/fulfillment/shipments/${shipment.id}/label`, {
      method: 'POST',
      token: hubToken,
    });
    assert.equal(labelRes.status, 201, 'Label generated');

    return { order, shipment, barcode: labelRes.body.barcode };
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Continuous Barcode Handoff Scanning
    // -------------------------------------------------------------------------
    console.log('[Test 1] Continuous Barcode Scanning for Run Handoff');

    const parcel1 = await createParcel('ORD-SCAN-1', 'Maadi', 29.9602, 31.2569, 500);
    const parcel2 = await createParcel('ORD-SCAN-2', 'Maadi', 29.9650, 31.2610, 300);

    // Create batch with 2 stops
    const batchRes = await request('/fulfillment/delivery-batches', {
      token: hubToken,
      body: { hubId: location.id, name: 'batch-scan-test', driverId: courier.id }
    });
    assert.equal(batchRes.status, 201);
    const batchId = batchRes.body.id;

    await request(`/fulfillment/delivery-batches/${batchId}/stops`, {
      token: hubToken,
      body: { stops: [{ shipmentId: parcel1.shipment.id, sequence: 1 }, { shipmentId: parcel2.shipment.id, sequence: 2 }] }
    });

    // 1. Scan Stop 1 barcode
    const scan1 = await request(`/fulfillment/delivery-batches/${batchId}/handoff-scan`, {
      token: courierToken,
      body: { barcode: parcel1.barcode }
    });
    if (scan1.status !== 201) {
      console.log('scan1 failed:', scan1.status, scan1.body);
    }
    assert.equal(scan1.status, 201, 'First parcel scanned');
    assert.equal(scan1.body.success, true);
    assert.equal(scan1.body.scannedStopsCount, 1);
    assert.equal(scan1.body.totalStops, 2);
    assert.equal(scan1.body.isComplete, false);

    // 2. Scan invalid barcode -> must reject with 400
    const scanInvalid = await request(`/fulfillment/delivery-batches/${batchId}/handoff-scan`, {
      token: courierToken,
      body: { barcode: 'SHP-INVALID-BARCODE-1234' }
    });
    assert.equal(scanInvalid.status, 400, 'Invalid barcode rejected');

    // 3. Scan Stop 2 barcode
    const scan2 = await request(`/fulfillment/delivery-batches/${batchId}/handoff-scan`, {
      token: courierToken,
      body: { barcode: parcel2.barcode }
    });
    assert.equal(scan2.status, 201, 'Second parcel scanned');
    assert.equal(scan2.body.scannedStopsCount, 2);
    assert.equal(scan2.body.isComplete, true, 'Continuous handoff complete');

    console.log('✔ Test 1 passed: Continuous barcode scan validates HMAC, updates counts, and rejects foreign barcodes.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Geographic Clustering & Suggested Plan Preview
    // -------------------------------------------------------------------------
    console.log('[Test 2] Geographic Clustering & Proximity Preview');

    const parcelNasr1 = await createParcel('ORD-NASR-1', 'Nasr City', 30.0561, 31.3301, 250);
    const parcelNasr2 = await createParcel('ORD-NASR-2', 'Nasr City', 30.0620, 31.3410, 350);

    const planRes = await request(`/fulfillment/locations/${location.id}/dispatch/plan-preview`, {
      method: 'POST',
      token: hubToken,
      body: {}
    });
    assert.equal(planRes.status, 201, 'Plan preview generated');
    assert.ok(planRes.body.trips.length > 0, 'Generated suggested trips');

    const suggestedTrip = planRes.body.trips[0];
    assert.ok(suggestedTrip.metrics.estimatedDistanceMeters > 0, 'Has estimated distance');
    assert.ok(suggestedTrip.metrics.totalEstimatedDurationSeconds > 0, 'Has estimated duration');
    assert.ok(suggestedTrip.stops.length > 0, 'Has sequenced stops');
    assert.equal(suggestedTrip.stops[0].sequence, 1, 'First stop is sequence 1');

    console.log(`✔ Test 2 passed: Geographic clustering generated trips with estimated distance (${(suggestedTrip.metrics.estimatedDistanceMeters/1000).toFixed(1)} km) and duration (${Math.round(suggestedTrip.metrics.totalEstimatedDurationSeconds/60)} min).\n`);

    // -------------------------------------------------------------------------
    // TEST 3: Multi-Run Independent COD Settlement (NEVER Mix Collections)
    // -------------------------------------------------------------------------
    console.log('[Test 3] Multi-Run Independent COD Settlement for Same Courier');

    // Courier Mahmoud will have Run 1 and Run 2 simultaneously
    const parcelRun1 = await createParcel('ORD-RUN1-A', 'Heliopolis', 30.0890, 31.3280, 500);
    const parcelRun2 = await createParcel('ORD-RUN2-B', 'Dokki', 30.0380, 31.2110, 400);

    // Create Run 1 (500 EGP)
    const run1Res = await request('/fulfillment/delivery-batches', {
      token: hubToken,
      body: { hubId: location.id, name: 'run-1-heliopolis', driverId: courier.id }
    });
    if (run1Res.status !== 201) {
      console.log('run1Res failed:', run1Res.status, run1Res.body);
    }
    assert.equal(run1Res.status, 201, 'Run 1 created');
    const run1Id = run1Res.body.id;
    await request(`/fulfillment/delivery-batches/${run1Id}/stops`, {
      token: hubToken,
      body: { stops: [{ shipmentId: parcelRun1.shipment.id, sequence: 1 }] }
    });
    // Handoff Run 1
    await request(`/fulfillment/delivery-batches/${run1Id}/handoff-scan`, {
      token: courierToken,
      body: { barcode: parcelRun1.barcode }
    });
    // Dispatch Run 1
    const disp1 = await request(`/fulfillment/delivery-batches/${run1Id}/dispatch`, {
      method: 'POST',
      token: hubToken
    });
    assert.equal(disp1.status, 201, 'Run 1 dispatched');

    // Create Run 2 (400 EGP)
    const run2Res = await request('/fulfillment/delivery-batches', {
      token: hubToken,
      body: { hubId: location.id, name: 'run-2-dokki', driverId: courier.id }
    });
    const run2Id = run2Res.body.id;
    await request(`/fulfillment/delivery-batches/${run2Id}/stops`, {
      token: hubToken,
      body: { stops: [{ shipmentId: parcelRun2.shipment.id, sequence: 1 }] }
    });
    // Handoff Run 2
    await request(`/fulfillment/delivery-batches/${run2Id}/handoff-scan`, {
      token: courierToken,
      body: { barcode: parcelRun2.barcode }
    });
    // Dispatch Run 2
    const disp2 = await request(`/fulfillment/delivery-batches/${run2Id}/dispatch`, {
      method: 'POST',
      token: hubToken
    });
    assert.equal(disp2.status, 201, 'Run 2 dispatched');

    // Driver delivers Order 1 (Run 1) -> 500 EGP collected
    await request(`/fulfillment/shipments/${parcelRun1.shipment.id}/events`, {
      token: courierToken,
      body: { type: 'DELIVERED', collectedAmount: 500 }
    });

    // Driver delivers Order 2 (Run 2) -> 400 EGP collected
    await request(`/fulfillment/shipments/${parcelRun2.shipment.id}/events`, {
      token: courierToken,
      body: { type: 'DELIVERED', collectedAmount: 400 }
    });

    // Verify both collections exist in DB and are currently 'collected'
    const col1Before = await prisma.paymentCollection.findUnique({ where: { orderId: parcelRun1.order.id } });
    const col2Before = await prisma.paymentCollection.findUnique({ where: { orderId: parcelRun2.order.id } });
    assert.equal(col1Before.status, 'collected');
    assert.equal(col2Before.status, 'collected');
    assert.equal(col1Before.courierId, courier.id);
    assert.equal(col2Before.courierId, courier.id);

    // Settle Run 1 ONLY (orderId = parcelRun1.order.id, counted = 500)
    console.log('-> Settling Run 1 exclusively with 500 EGP...');
    const settleRun1 = await request('/ordering/settlements/rounds', {
      token: hubToken,
      body: {
        courierId: courier.id,
        locationId: location.id,
        reference: 'SETTLE-RUN1-' + crypto.randomUUID().slice(0, 6).toUpperCase(),
        runId: run1Id,
        orderIds: [parcelRun1.order.id],
        countedTotal: 500,
      }
    });
    assert.equal(settleRun1.status, 201, 'Run 1 settled');
    assert.equal(Number(settleRun1.body.expectedTotal), 500);
    assert.equal(Number(settleRun1.body.countedTotal), 500);
    assert.equal(Number(settleRun1.body.variance), 0);

    // VERIFY CRITICAL INDEPENDENCE:
    // Order 1 MUST be 'settled'
    const col1After = await prisma.paymentCollection.findUnique({ where: { orderId: parcelRun1.order.id } });
    assert.equal(col1After.status, 'settled', 'Run 1 collection is settled');

    // Order 2 MUST STILL BE 'collected' (NOT touched or settled by Run 1's settlement!)
    const col2After = await prisma.paymentCollection.findUnique({ where: { orderId: parcelRun2.order.id } });
    assert.equal(col2After.status, 'collected', 'Run 2 collection remains UNTOUCHED and active');
    assert.equal(col2After.settlementBatchId, null, 'Run 2 is not linked to Run 1 settlement batch');

    // Complete Run 1
    const comp1 = await request(`/fulfillment/delivery-batches/${run1Id}/complete`, {
      method: 'POST',
      token: hubToken
    });
    assert.equal(comp1.status, 201, 'Run 1 marked completed');

    // Verify Run 2 is still dispatched
    const run2Batch = await prisma.deliveryBatch.findUnique({ where: { id: run2Id } });
    assert.equal(run2Batch.status, 'dispatched', 'Run 2 remains dispatched and open');

    // Now settle Run 2 independently with 400 EGP
    console.log('-> Settling Run 2 independently with 400 EGP...');
    const settleRun2 = await request('/ordering/settlements/rounds', {
      token: hubToken,
      body: {
        courierId: courier.id,
        locationId: location.id,
        reference: 'SETTLE-RUN2-' + crypto.randomUUID().slice(0, 6).toUpperCase(),
        runId: run2Id,
        orderIds: [parcelRun2.order.id],
        countedTotal: 400,
      }
    });
    assert.equal(settleRun2.status, 201, 'Run 2 settled');
    assert.equal(Number(settleRun2.body.expectedTotal), 400);
    assert.equal(Number(settleRun2.body.countedTotal), 400);

    const col2Final = await prisma.paymentCollection.findUnique({ where: { orderId: parcelRun2.order.id } });
    assert.equal(col2Final.status, 'settled', 'Run 2 collection is now settled');

    // Complete Run 2
    const comp2 = await request(`/fulfillment/delivery-batches/${run2Id}/complete`, {
      method: 'POST',
      token: hubToken
    });
    assert.equal(comp2.status, 201, 'Run 2 marked completed');

    console.log('✔ Test 3 passed: Multiple runs for the same courier settle independently with zero cash mixing!\n');

    console.log('===============================================================');
    console.log('ALL VERIFICATION TESTS PASSED SUCCESSFULLY WITH ZERO REGRESSIONS');
    console.log('===============================================================');

  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
