const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

async function run() {
  console.log('--- Shena Care Full Operational Journey ---');
  
  // 1. Get seed data
  const sku = await prisma.sku.findFirst({ where: { barcode: { not: null } } });
  if (!sku) throw new Error('No SKU found in DB');
  console.log(`[Seed] Using SKU ${sku.barcode} (${sku.id})`);

  // Ensure test bypass user exists (since API needs it for foreign keys like customerId)
  const testUserId = '343f1cb1-0b53-4876-90e8-07e1bf1f8d42';
  const existingUser = await prisma.customer.findUnique({ where: { id: testUserId } });
  if (!existingUser) {
    await prisma.customer.create({
      data: {
        id: testUserId,
        name: 'Test Bypass User',
        email: 'testbypass' + Date.now() + '@example.com',
        roles: ['CUSTOMER', 'ADMIN', 'HUB_OPERATOR', 'SUPPLIER']
      }
    });
    console.log('[Seed] Created Test Bypass User');
  }

  const BASE_URL = 'http://localhost:3001';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer test-token' // Will hit TEST_BYPASS_AUTH condition
  };

  async function apiPost(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`API ${path} failed: ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  }

  async function apiPatch(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`API ${path} failed: ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  }

  async function apiGet(path) {
    const res = await fetch(`${BASE_URL}${path}`, { headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`API ${path} failed: ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  }

  // 2. Checkout
  console.log('\n--- 1. Checkout Phase ---');
  await apiPost('/ordering/cart/add', { skuId: sku.id, quantity: 1 });
  console.log('[Cart] Item added to cart');
  
  const quote = await apiPost('/ordering/checkout/quote', { governorate: 'Cairo', area: 'Maadi' });
  console.log(`[Quote] Generated version: ${quote.quoteVersion}`);
  
  const order = await apiPost('/ordering/checkout', {
    customerName: 'Full Journey Tester',
    customerPhone: '+201001234567',
    shippingAddress: '10 Test Street, Cairo',
    governorate: 'Cairo',
    area: 'Maadi',
    quoteVersion: quote.quoteVersion,
    cartRevision: quote.revision,
    idempotencyKey: `journey-${Date.now()}`
  });
  console.log(`[Checkout] COD Order Placed: ${order.orderNumber} (${order.id})`);

  // Wait for outbox processors or something if needed?
  // Let's force order to confirmed status just in case (sometimes it's placed -> confirmed)
  // According to e2e tests, "checkout produces an Order in status 'placed'" which is enough for allocation.

  // 3. Supply Request
  console.log('\n--- 2. Supply Request Phase ---');
  const supplyPlan = await apiPost(`/sourcing/supply-plans/orders/${order.id}/initiate`, {});
  console.log(`[Supply] Plan initiated: ${supplyPlan.id}`);
  
  const line = supplyPlan.lines.find(l => l.skuId === sku.id);
  if (!line || !line.allocations.length) throw new Error('No allocation for SKU found in supply plan');
  const allocation = line.allocations[0];
  console.log(`[Supply] Allocation created: ${allocation.id}`);

  // 4. Supplier Confirmation
  console.log('\n--- 3. Supplier Confirmation Phase ---');
  await apiPost(`/sourcing/supply-plans/allocations/${allocation.id}/confirm`, {
    result: 'confirmed_full',
    confirmedQuantity: 1
  });
  console.log(`[Supply] Allocation confirmed`);

  // 5. Hub Receiving
  console.log('\n--- 4. Hub Receiving Phase ---');
  // First we need a location
  let locationId;
  try {
    const locRes = await apiPost('/fulfillment/locations', { name: `Hub-${Date.now()}`, address: '1 Warehouse St' });
    locationId = locRes.id;
  } catch(e) {
    // If it fails, maybe we can just query an existing one
    const loc = await prisma.location.findFirst();
    locationId = loc.id;
  }
  console.log(`[Hub] Using location: ${locationId}`);

  // The order has order items.
  const orderRecord = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true }});
  const orderItemId = orderRecord.items[0].id;

  const receipt = await apiPost('/fulfillment/receipts', {
    locationId,
    allocationId: allocation.id,
    orderId: order.id,
    orderItemId,
    skuId: sku.id,
    variantName: sku.variantName || 'Default', // Fallback just in case, but sku should have it
    quantity: 1,
    condition: 'ACCEPTABLE',
    idempotencyKey: crypto.randomUUID()
  });
  console.log(`[Hub] Goods received: Receipt ${receipt.id}`);

  // Wait, does receiving automatically create a shipment? Let's allocate shipment manually if not.
  console.log('\n--- 5. Shipment Allocation ---');
  let shipmentId;
  try {
    const allocShipment = await apiPost('/fulfillment/shipments/allocate', { orderId: order.id, locationId });
    shipmentId = allocShipment.id;
    console.log(`[Hub] Shipment allocated: ${shipmentId}`);
  } catch(e) {
    // Maybe it was auto-allocated
    console.log(`[Hub] Allocation failed (maybe already auto-allocated?): ${e.message}`);
    const ship = await prisma.shipment.findFirst({ where: { orderId: order.id } });
    if (!ship) throw e;
    shipmentId = ship.id;
    console.log(`[Hub] Found existing shipment: ${shipmentId}`);
  }

  // 6. Preparation / SKU Scan
  console.log('\n--- 6. Preparation Phase ---');
  const session = await apiPost(`/fulfillment/shipments/${shipmentId}/preparation`, { operatorId: 'op-1' });
  console.log(`[Hub] Preparation session started: ${session.id}`);

  await apiPost(`/fulfillment/preparation-sessions/${session.id}/scan`, {
    barcodeScanned: sku.barcode
  });
  console.log(`[Hub] SKU Scanned successfully`);

  await apiPost(`/fulfillment/preparation-sessions/${session.id}/complete`, {});
  console.log(`[Hub] Preparation session completed`);

  // 7. Packing & Label
  console.log('\n--- 7. Packing & Label Phase ---');
  await apiPost(`/fulfillment/shipments/${shipmentId}/events`, {
    type: 'PACKED',
    actorId: 'op-1'
  });
  console.log(`[Hub] Shipment Packed`);

  const label = await apiPost(`/fulfillment/shipments/${shipmentId}/label`, {});
  console.log(`[Hub] Shipment Label Generated: ${label.url}`);

  // 8. Delivery Dispatch
  console.log('\n--- 8. Dispatch & Delivery Phase ---');
  // Create batch
  const batch = await apiPost('/fulfillment/delivery-batches', {
    hubId: locationId,
    name: `Run-${Date.now()}`
  });
  console.log(`[Delivery] Batch created: ${batch.id}`);

  // Add stop
  await apiPost(`/fulfillment/delivery-batches/${batch.id}/stops`, {
    stops: [{ shipmentId, sequence: 1 }]
  });
  console.log(`[Delivery] Stop added to batch`);

  // Dispatch batch
  await apiPost(`/fulfillment/delivery-batches/${batch.id}/dispatch`, {});
  console.log(`[Delivery] Batch dispatched`);

  // Delivered
  await apiPost(`/fulfillment/shipments/${shipmentId}/events`, {
    type: 'DELIVERED',
    actorId: 'driver-1'
  });
  console.log(`[Delivery] Shipment Delivered`);

  // 9. Customer Tracking
  console.log('\n--- 9. Customer Tracking Phase ---');
  const trackData = await apiGet(`/ordering/orders/${order.orderNumber}/tracking`);
  console.log(`[Tracking] RAW DATA:`, trackData);
  if (trackData.status) {
    console.log(`[Tracking] Tracking status: ${trackData.status}`);
  }
}

run().then(() => {
  console.log('\nAll done!');
  prisma.$disconnect();
}).catch(e => {
  console.error('\nERROR:', e);
  prisma.$disconnect();
});
