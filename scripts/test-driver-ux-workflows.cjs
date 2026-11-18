/**
 * Test Driver UX & Workflow Improvements (Journeys 1 to 7)
 * Verifies all state transitions, custody verification, idempotency, COD collection,
 * and security boundaries against the running NestJS API.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

const API_BASE = 'http://localhost:3001';
const LABEL_SECRET = 'shena-care-dev-only-shipment-label-secret';

function signBarcode(shipmentId) {
  const sig = crypto.createHmac('sha256', LABEL_SECRET).update(shipmentId).digest('hex').substring(0, 16);
  return `SHP-${shipmentId.substring(0, 8).toUpperCase()}-${sig.toUpperCase()}`;
}

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

const { PrismaClient } = require('C:/Users/El-mostakbal.DESKTOP-PM74NIT/Desktop/shena care/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting Driver UX & Workflow Acceptance Tests ---');

  // Setup actors and test location with full capabilities
  const location = await prisma.fulfillmentLocation.create({
    data: {
      name: 'Driver UX Hub ' + crypto.randomUUID().slice(0, 8),
      address: 'Cairo Test Hub',
      capabilities: ['RECEIVE_SUPPLIER_GOODS', 'PREPARE_ORDERS', 'DISPATCH_SHIPMENTS', 'MANAGE_OWNED_INVENTORY'],
      isActive: true,
    }
  });

  const hubUser = await prisma.customer.create({
    data: { name: 'Hub Op', email: `hub-${crypto.randomUUID().slice(0, 8)}@test.shena`, roles: ['HUB_OPERATOR', 'ADMIN'] }
  });
  await prisma.fulfillmentLocationOperator.create({
    data: { locationId: location.id, operatorId: hubUser.id }
  });
  const hubSession = await prisma.session.create({
    data: { customerId: hubUser.id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 3600000) }
  });

  const driverUser = await prisma.customer.create({
    data: { name: 'Driver Samir', email: `driver-${crypto.randomUUID().slice(0, 8)}@test.shena`, roles: ['DRIVER'] }
  });
  const driverSession = await prisma.session.create({
    data: { customerId: driverUser.id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 3600000) }
  });

  const hubToken = hubSession.token;
  const driverToken = driverSession.token;

  async function createTestStop(orderOptions = {}) {
    const order = await prisma.order.create({
      data: {
        orderNumber: 'ORD-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
        customerName: orderOptions.name || 'عميل تجريبي',
        customerPhone: orderOptions.phone !== undefined ? orderOptions.phone : '01012345678',
        shippingAddress: orderOptions.address !== undefined ? orderOptions.address : '١٥ شارع النصر، المعادي',
        area: orderOptions.area || 'Maadi',
        governorate: 'Cairo',
        totalAmount: orderOptions.codAmount || 350,
        codAmount: orderOptions.codAmount || 350,
        currency: 'EGP',
        paymentMethod: 'COD',
        status: 'packing',
        latitude: orderOptions.lat !== undefined ? orderOptions.lat : 29.9602,
        longitude: orderOptions.lng !== undefined ? orderOptions.lng : 31.2569,
        items: {
          create: [{ skuId: crypto.randomUUID(), quantity: 2, price: 175, currency: 'EGP' }]
        }
      }
    });

    const shipment = await prisma.shipment.create({
      data: { orderId: order.id, locationId: location.id, status: 'packed' }
    });

    return { order, shipment, barcode: signBarcode(shipment.id) };
  }

  try {
    // -------------------------------------------------------------
    // Journey 1: Assigned trip -> parcel scan -> pickup confirmation
    // -------------------------------------------------------------
    console.log('\n[Journey 1] Assigned trip -> parcel scan -> pickup confirmation');
    const stop1 = await createTestStop({ codAmount: 400 });

    // Hub creates delivery batch and assigns to driver
    const createBatchRes = await request('/fulfillment/delivery-batches', {
      token: hubToken,
      body: { hubId: location.id, name: 'Run J1', driverId: driverUser.id }
    });
    assert.equal(createBatchRes.status, 201, 'Batch created');
    const batchId = createBatchRes.body.id;

    // Add stop to batch
    const addStopRes = await request(`/fulfillment/delivery-batches/${batchId}/stops`, {
      token: hubToken,
      body: { stops: [{ shipmentId: stop1.shipment.id }] }
    });
    assert.equal(addStopRes.status, 201, 'Stop added to batch');

    // Driver inspects manifest: awaiting pickup (handedOver: false)
    const manifestRes1 = await request('/fulfillment/driver/runs', { token: driverToken });
    assert.equal(manifestRes1.status, 200);
    const myRun1 = manifestRes1.body.find(r => r.id === batchId);
    assert.ok(myRun1, 'Run is in driver manifest');
    assert.equal(myRun1.status, 'planning');
    const myStop1 = myRun1.stops.find(s => s.shipmentId === stop1.shipment.id);
    assert.equal(myStop1.handedOver, false, 'Stop is not handed over yet (awaiting pickup)');

    // Driver scans shipping barcode
    const handoffRes = await request(`/fulfillment/shipments/${stop1.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'HANDOFF_SCANNED', barcode: stop1.barcode }
    });
    assert.equal(handoffRes.status, 201, 'Handoff scan recorded');

    // Re-check manifest: handedOver is now true
    const manifestRes2 = await request('/fulfillment/driver/runs', { token: driverToken });
    const myStop1Updated = manifestRes2.body.find(r => r.id === batchId).stops.find(s => s.shipmentId === stop1.shipment.id);
    assert.equal(myStop1Updated.handedOver, true, 'Stop is now handed over into driver custody');
    console.log('✔ Journey 1 passed: Stop assigned, scanned, and confirmed in driver custody.');

    // -------------------------------------------------------------
    // Journey 2: Pickup -> start delivery -> successful delivery -> COD collection
    // -------------------------------------------------------------
    console.log('\n[Journey 2] Pickup -> start delivery -> successful delivery -> COD collection');
    // Hub dispatches batch
    const dispatchRes = await request(`/fulfillment/delivery-batches/${batchId}/dispatch`, {
      method: 'POST',
      token: hubToken,
    });
    if (dispatchRes.status !== 201) {
      console.error('Dispatch error details:', dispatchRes.status, dispatchRes.body);
    }
    assert.equal(dispatchRes.status, 201, 'Batch dispatched');

    // Driver sees trip as active (dispatched)
    const manifestDispatched = await request('/fulfillment/driver/runs', { token: driverToken });
    const activeRun = manifestDispatched.body.find(r => r.id === batchId);
    assert.equal(activeRun.status, 'dispatched', 'Trip is now active (dispatched)');
    assert.equal(activeRun.stops[0].status, 'out_for_delivery', 'Shipment is out_for_delivery');

    // Driver records successful delivery with declared cash
    const deliverRes = await request(`/fulfillment/shipments/${stop1.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'DELIVERED', collectedAmount: 400 }
    });
    assert.equal(deliverRes.status, 201, 'Delivered recorded');

    // Check payment collection in DB
    const collection = await prisma.paymentCollection.findUnique({ where: { orderId: stop1.order.id } });
    assert.equal(collection.status, 'collected');
    assert.equal(collection.courierId, driverUser.id);
    assert.equal(Number(collection.declaredAmount), 400);
    assert.equal(Number(collection.expectedAmount), 400, 'Original expected amount preserved');

    // Replay with same amount is idempotent
    const replayRes = await request(`/fulfillment/shipments/${stop1.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'DELIVERED', collectedAmount: 400 }
    });
    assert.equal(replayRes.status, 201, 'Idempotent replay succeeds');

    // Attempting conflicting amount rewrite is rejected (409)
    const conflictRes = await request(`/fulfillment/shipments/${stop1.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'DELIVERED', collectedAmount: 350 }
    });
    assert.equal(conflictRes.status, 409, 'Rewrite of collectedAmount rejected with 409 Conflict');
    console.log('✔ Journey 2 passed: Delivery and COD collection persisted with idempotency & audit.');

    // -------------------------------------------------------------
    // Journey 3: Customer unreachable -> failed attempt
    // -------------------------------------------------------------
    console.log('\n[Journey 3] Customer unreachable -> failed attempt');
    const stop2 = await createTestStop({ codAmount: 250 });
    const batch2Res = await request('/fulfillment/delivery-batches', {
      token: hubToken,
      body: { hubId: location.id, name: 'Run J3', driverId: driverUser.id }
    });
    const batch2Id = batch2Res.body.id;
    await request(`/fulfillment/delivery-batches/${batch2Id}/stops`, {
      token: hubToken,
      body: { stops: [{ shipmentId: stop2.shipment.id }] }
    });
    await request(`/fulfillment/shipments/${stop2.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'HANDOFF_SCANNED', barcode: stop2.barcode }
    });
    await request(`/fulfillment/delivery-batches/${batch2Id}/dispatch`, { method: 'POST', token: hubToken });

    // Failed attempt without reasonCode -> 400
    const failNoReason = await request(`/fulfillment/shipments/${stop2.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'FAILED' }
    });
    assert.equal(failNoReason.status, 400, 'Failed delivery requires reasonCode');

    // Driver marks failed with CUSTOMER_UNREACHABLE
    const failRes = await request(`/fulfillment/shipments/${stop2.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'FAILED', reasonCode: 'CUSTOMER_UNREACHABLE', notes: 'العميل لا يرد بعد 3 اتصالات' }
    });
    assert.equal(failRes.status, 201, 'Failed attempt recorded');

    // Shipment is now 'failed', order stays 'shipped' (not cancelled), parcel stays in driver custody
    const updatedShipment2 = await prisma.shipment.findUnique({ where: { id: stop2.shipment.id } });
    assert.equal(updatedShipment2.status, 'failed');
    const updatedOrder2 = await prisma.order.findUnique({ where: { id: stop2.order.id } });
    assert.equal(updatedOrder2.status, 'shipped', 'Order remains open pending Hub decision');
    console.log('✔ Journey 3 passed: Failed attempt recorded with reasonCode and audit notes.');

    // -------------------------------------------------------------
    // Journey 4: Customer refusal -> pending return -> Hub return confirmation
    // -------------------------------------------------------------
    console.log('\n[Journey 4] Customer refusal -> pending return -> Hub return confirmation');
    const stop3 = await createTestStop({ codAmount: 300 });
    const batch3Res = await request('/fulfillment/delivery-batches', {
      token: hubToken,
      body: { hubId: location.id, name: 'Run J4', driverId: driverUser.id }
    });
    const batch3Id = batch3Res.body.id;
    await request(`/fulfillment/delivery-batches/${batch3Id}/stops`, {
      token: hubToken,
      body: { stops: [{ shipmentId: stop3.shipment.id }] }
    });
    await request(`/fulfillment/shipments/${stop3.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'HANDOFF_SCANNED', barcode: stop3.barcode }
    });
    await request(`/fulfillment/delivery-batches/${batch3Id}/dispatch`, { method: 'POST', token: hubToken });

    // Customer refusal
    const refusalRes = await request(`/fulfillment/shipments/${stop3.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'FAILED', reasonCode: 'CUSTOMER_REFUSED', notes: 'رفض الاستلام لعدم توفر سيولة' }
    });
    assert.equal(refusalRes.status, 201, 'Customer refusal recorded');

    // Driver CANNOT record RECEIVED_BACK (403 Forbidden)
    const driverReceivedBack = await request(`/fulfillment/shipments/${stop3.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'RECEIVED_BACK', barcode: stop3.barcode }
    });
    assert.equal(driverReceivedBack.status, 403, 'Driver cannot record RECEIVED_BACK');

    // Hub scans barcode to confirm physical return
    const hubReceivedBack = await request(`/fulfillment/shipments/${stop3.shipment.id}/events`, {
      token: hubToken,
      body: { type: 'RECEIVED_BACK', barcode: stop3.barcode }
    });
    if (hubReceivedBack.status !== 201) {
      console.log('hubReceivedBack status:', hubReceivedBack.status, hubReceivedBack.body);
    }
    assert.equal(hubReceivedBack.status, 201, 'Hub confirms parcel return with barcode');

    // Shipment status returns to packed (available for re-routing or return to supplier)
    const shipment3AfterReturn = await prisma.shipment.findUnique({ where: { id: stop3.shipment.id } });
    assert.equal(shipment3AfterReturn.status, 'packed', 'Shipment safely returned to hub custody');
    console.log('✔ Journey 4 passed: Customer refusal recorded, return verified at Hub.');

    // -------------------------------------------------------------
    // Journey 5: Invalid barcode and duplicate scans
    // -------------------------------------------------------------
    console.log('\n[Journey 5] Invalid barcode and duplicate scans');
    const stop4 = await createTestStop();
    const batch4Res = await request('/fulfillment/delivery-batches', {
      token: hubToken,
      body: { hubId: location.id, name: 'Run J5', driverId: driverUser.id }
    });
    await request(`/fulfillment/delivery-batches/${batch4Res.body.id}/stops`, {
      token: hubToken,
      body: { stops: [{ shipmentId: stop4.shipment.id }] }
    });

    // Invalid barcode
    const invalidScan = await request(`/fulfillment/shipments/${stop4.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'HANDOFF_SCANNED', barcode: 'SHP-INVALID-1234' }
    });
    assert.equal(invalidScan.status, 400, 'Invalid barcode is rejected');

    // Valid scan
    const validScan1 = await request(`/fulfillment/shipments/${stop4.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'HANDOFF_SCANNED', barcode: stop4.barcode }
    });
    assert.equal(validScan1.status, 201);

    // Duplicate valid scan returns existing event idempotently
    const validScan2 = await request(`/fulfillment/shipments/${stop4.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'HANDOFF_SCANNED', barcode: stop4.barcode }
    });
    assert.equal(validScan2.status, 201);
    assert.equal(validScan1.body.id, validScan2.body.id, 'Duplicate handoff returns existing record');
    console.log('✔ Journey 5 passed: Barcode HMAC signature verified, replay is idempotent.');

    // -------------------------------------------------------------
    // Journey 6: Missing customer phone or delivery coordinates
    // -------------------------------------------------------------
    console.log('\n[Journey 6] Missing customer phone or delivery coordinates');
    const stop5 = await createTestStop({ phone: '', lat: 29.9602, lng: 31.2569, address: '١٥ شارع النصر، المعادي' });
    const batch5Res = await request('/fulfillment/delivery-batches', {
      token: hubToken,
      body: { hubId: location.id, name: 'Run J6', driverId: driverUser.id }
    });
    const addStop5 = await request(`/fulfillment/delivery-batches/${batch5Res.body.id}/stops`, {
      token: hubToken,
      body: { stops: [{ shipmentId: stop5.shipment.id }] }
    });
    assert.equal(addStop5.status, 201, 'Stop added to batch');

    const manifest6 = await request('/fulfillment/driver/runs', { token: driverToken });
    const myRun6 = manifest6.body.find(r => r.id === batch5Res.body.id);
    assert.ok(myRun6, 'Run J6 found in driver manifest');
    const myStop6 = myRun6.stops.find(s => s.shipmentId === stop5.shipment.id);
    assert.ok(myStop6, 'Stop found in Run J6');
    assert.equal(myStop6.recipientPhone, '');

    // Test UI action helpers handling missing/null phone and missing coordinates
    const { pathToFileURL } = require('node:url');
    const { formatPhoneUrl, formatWhatsAppUrl, formatNavigationUrl } = await import(
      pathToFileURL('C:/Users/El-mostakbal.DESKTOP-PM74NIT/Desktop/shena care/apps/business/lib/courier-actions.ts').href
    );

    // Missing phone: call and whatsapp links are null (disabled in UI)
    assert.equal(formatPhoneUrl(myStop6.recipientPhone), null);
    assert.equal(formatWhatsAppUrl(myStop6.recipientPhone), null);
    assert.equal(formatPhoneUrl(null), null);
    assert.equal(formatWhatsAppUrl(null), null);

    // Missing coordinates: falls back gracefully to address search
    const navFallback = formatNavigationUrl(null, myStop6.address);
    assert.equal(navFallback.isCoordinates, false);
    assert.ok(navFallback.url.includes('google.com/maps/search'), 'Falls back to address search when coordinates null');
    assert.ok(navFallback.url.includes(encodeURIComponent(myStop6.address)));

    // Present coordinates: uses direct navigation
    const navCoords = formatNavigationUrl(myStop6.location, myStop6.address);
    assert.equal(navCoords.isCoordinates, true);
    assert.ok(navCoords.url.includes('dir/?api=1&destination='));

    // Both missing: returns { url: null, isCoordinates: false } safely
    const emptyNav = formatNavigationUrl(null, null);
    assert.equal(emptyNav.url, null);
    assert.equal(emptyNav.isCoordinates, false);

    console.log('✔ Journey 6 passed: Missing phone and location handled gracefully without crashing.');

    // -------------------------------------------------------------
    // Journey 7: Repeated requests, network errors, and invalid state transitions
    // -------------------------------------------------------------
    console.log('\n[Journey 7] Invalid state transitions');
    // Try to mark DELIVERED when the run is still in planning
    const stop6 = await createTestStop();
    const batch6Res = await request('/fulfillment/delivery-batches', {
      token: hubToken,
      body: { hubId: location.id, name: 'Run J7', driverId: driverUser.id }
    });
    await request(`/fulfillment/delivery-batches/${batch6Res.body.id}/stops`, {
      token: hubToken,
      body: { stops: [{ shipmentId: stop6.shipment.id }] }
    });

    const prematureDeliver = await request(`/fulfillment/shipments/${stop6.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'DELIVERED', collectedAmount: 100 }
    });
    assert.equal(prematureDeliver.status, 400, 'Cannot deliver shipment before dispatch');
    console.log('✔ Journey 7 passed: State machine guards prevented invalid delivery attempt.');

    console.log('\n========================================');
    console.log('ALL 7 WORKFLOW JOURNEYS PASSED SUCCESSFULLY!');
    console.log('========================================');
  } finally {
    // Cleanup fixtures safely
    await prisma.deliveryStop.deleteMany({ where: { batch: { locationId: location.id } } });
    await prisma.deliveryBatch.deleteMany({ where: { locationId: location.id } });
    await prisma.paymentCollection.deleteMany({ where: { order: { shippingAddress: { contains: 'المعادي' } } } });
    await prisma.shipmentEvent.deleteMany({ where: { shipment: { locationId: location.id } } });
    await prisma.shipment.deleteMany({ where: { locationId: location.id } });
    await prisma.orderItem.deleteMany({ where: { order: { customerName: 'عميل تجريبي' } } });
    await prisma.order.deleteMany({ where: { customerName: 'عميل تجريبي' } });
    await prisma.fulfillmentLocationOperator.deleteMany({ where: { locationId: location.id } });
    await prisma.fulfillmentLocation.deleteMany({ where: { id: location.id } });
    await prisma.session.deleteMany({ where: { customerId: { in: [hubUser.id, driverUser.id] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [hubUser.id, driverUser.id] } } });
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
