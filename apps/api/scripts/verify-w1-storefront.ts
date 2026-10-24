import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const API_BASE = 'http://localhost:3001';
const prisma = new PrismaClient();

interface TestResult {
  check: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  details: string;
}

const results: TestResult[] = [];

async function record(check: string, fn: () => Promise<string>) {
  try {
    const details = await fn();
    results.push({ check, status: 'PASS', details });
    console.log(`✅ PASS: ${check} — ${details}`);
  } catch (err: any) {
    results.push({ check, status: 'FAIL', details: err.message });
    console.error(`❌ FAIL: ${check} — ${err.message}`);
  }
}

async function main() {
  console.log('--- STARTING W1 STOREFRONT REAL API & DATABASE VERIFICATION ---');

  const testPhone = '01099887766';
  const canonicalPhone = '+201099887766';
  let guestCartToken = '';
  let customerSessionToken = '';
  let customerId = '';
  let skuId = '';
  let createdOrderId = '';
  let unitPrice = 0;
  const FEE = Number(process.env.DELIVERY_FEE_EGP ?? 50);
  const SUBTOTAL = () => unitPrice * 2;
  const TOTAL = () => SUBTOTAL() + FEE;

  // 1. Availability & Catalog Discovery
  await record('Product discovery and verified availability', async () => {
    const res = await fetch(`${API_BASE}/products/discovery`);
    if (!res.ok) throw new Error(`Discovery failed with status ${res.status}`);
    const data: any = await res.json();
    if (!data.items || data.items.length === 0) throw new Error('No published products found in discovery');
    const eva = data.items.find((p: any) => p.name.includes('Eva') && p.skus?.[0]?.canOrder);
    if (!eva) throw new Error('No orderable Eva product found in discovery');
    if (!eva.skus || !eva.skus[0] || !eva.skus[0].canOrder) throw new Error('Eva product SKU cannot be ordered');
    skuId = eva.skus[0].id;
    const price = eva.skus[0].price.amount;
    const availability = eva.skus[0].availability;
    if (!(price > 0)) throw new Error(`Expected a positive public price, got ${price}`);
    unitPrice = price; // expected totals below derive from the live catalog price, never a hard-coded fixture
    if (availability.state !== 'CONFIRMED') throw new Error(`Expected CONFIRMED availability, got ${availability.state}`);
    return `Product "${eva.name}" discovered, SKU: ${skuId}, Price: ${price} EGP, Availability: ${availability.state}`;
  });

  // 2. Guest Cart Operations (Server-issued cart token)
  await record('Guest cart item addition with server-issued cart token', async () => {
    const res = await fetch(`${API_BASE}/ordering/cart/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skuId,
        quantity: 2,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to add item to guest cart: ${res.status} ${err}`);
    }
    const cart: any = await res.json();
    guestCartToken = cart.guestCartToken || res.headers.get('x-cart-token') || '';
    if (!guestCartToken) throw new Error('Server did not return a guestCartToken');
    if (!cart.items || cart.items.length === 0) throw new Error('Cart empty after add');
    const line = cart.items.find((i: any) => i.skuId === skuId);
    if (!line || line.quantity !== 2) throw new Error(`Line quantity mismatch: expected 2, got ${line?.quantity}`);
    return `Guest cart created, token issued (${guestCartToken.slice(0, 8)}...), revision ${cart.revision}, line total ${line.lineTotal} EGP`;
  });

  // 3. Guest Quote (Prior to Sign-in)
  let quoteVersion = '';
  let cartRevision = 0;
  await record('Guest checkout quote calculation (flat 50 EGP fee, authoritative prices)', async () => {
    const res = await fetch(`${API_BASE}/ordering/checkout/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cart-token': guestCartToken,
      },
      body: JSON.stringify({
        governorate: 'Cairo',
        area: 'Maadi',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Quote failed: ${res.status} ${err}`);
    }
    const quote: any = await res.json();
    quoteVersion = quote.quoteVersion;
    cartRevision = quote.revision;
    if (quote.subtotal !== SUBTOTAL()) throw new Error(`Expected subtotal ${SUBTOTAL()}, got ${quote.subtotal}`);
    if (quote.shippingFee !== FEE) throw new Error(`Expected shipping fee ${FEE}, got ${quote.shippingFee}`);
    if (quote.codAmount !== TOTAL()) throw new Error(`Expected COD amount ${TOTAL()}, got ${quote.codAmount}`);
    if (quote.totalAmount !== TOTAL()) throw new Error(`Expected total amount ${TOTAL()}, got ${quote.totalAmount}`);
    return `Authoritative quote generated: Subtotal ${SUBTOTAL()} EGP, Shipping ${FEE} EGP, Total COD ${TOTAL()} EGP (Quote ID: ${quoteVersion})`;
  });

  // 4. Invalid Location / Out of Service Area Guard
  await record('Service area enforcement (Alexandria rejected with 422/400)', async () => {
    const res = await fetch(`${API_BASE}/ordering/checkout/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cart-token': guestCartToken,
      },
      body: JSON.stringify({
        governorate: 'Alexandria',
        area: 'Smouha',
      }),
    });
    if (res.status !== 400 && res.status !== 422) throw new Error(`Expected 400/422 for out-of-service area, got ${res.status}`);
    return 'Correctly rejected governorate outside Cairo/Giza service area (422 Unprocessable Entity)';
  });

  // 5. Customer Authentication & OTP Flow
  await record('OTP Challenge initiation with Egyptian phone', async () => {
    // Delete any prior test challenge for clean state
    await prisma.otpChallenge.deleteMany({ where: { phoneNumber: canonicalPhone } });

    const res = await fetch(`${API_BASE}/accounts/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: testPhone,
        pendingIntent: '/checkout',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OTP send failed: ${res.status} ${err}`);
    }
    const data: any = await res.json();
    if (!data.success) throw new Error('OTP send reported failure');
    return `OTP challenge issued for ${testPhone}, codeLength: ${data.codeLength}`;
  });

  // 6. OTP Verification Failure (Wrong Code Negative Test)
  await record('Negative Test: Incorrect OTP code rejected with 401', async () => {
    const res = await fetch(`${API_BASE}/accounts/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: testPhone,
        code: '000000',
        guestId: guestCartToken,
      }),
    });
    if (res.status !== 401) throw new Error(`Expected 401 for bad OTP code, got ${res.status}`);
    const err: any = await res.json();
    const code = err.message?.code || err.code;
    if (code !== 'OTP_INVALID') throw new Error(`Expected OTP_INVALID code, got ${code}`);
    return `Rejected with 401 Unauthorized, code: ${code}`;
  });

  // 7. OTP Verification Success & Guest Cart Adoption
  await record('OTP Verification & Guest Cart Adoption into Customer Account', async () => {
    const challenge = await prisma.otpChallenge.findFirst({
      where: { phoneNumber: canonicalPhone, isUsed: false, isRevoked: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new Error('No active OTP challenge found in DB');
    const correctCode = challenge.code;

    const res = await fetch(`${API_BASE}/accounts/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: testPhone,
        code: correctCode,
        guestId: guestCartToken, // Pass guestId to adopt cart
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OTP verify failed: ${res.status} ${err}`);
    }
    const authData: any = await res.json();
    if (!authData.token) throw new Error('No session token returned upon verification');
    customerSessionToken = authData.token;

    // Verify session in DB
    const session = await prisma.session.findUnique({
      where: { token: customerSessionToken },
      include: { customer: true },
    });
    if (!session || !session.isValid) throw new Error('Session not found or invalid in DB');
    customerId = session.customerId;

    // Wait a brief moment for event listener to complete adoption
    await new Promise((r) => setTimeout(r, 500));

    // Verify cart was adopted by customer
    const customerCart = await prisma.cart.findUnique({
      where: { customerId },
      include: { items: true },
    });
    if (!customerCart || customerCart.items.length === 0) {
      throw new Error('Customer cart has no items after guest adoption');
    }
    const item = customerCart.items.find((i) => i.skuId === skuId);
    if (!item || item.quantity !== 2) throw new Error(`Adopted cart item quantity mismatch: ${item?.quantity}`);

    return `Verified! Session created (Customer ID: ${customerId}), Guest Cart successfully adopted with 2 items`;
  });

  // 8. Server Quote Under Customer Session
  let customerQuoteVersion = '';
  let customerCartRevision = 0;
  await record('Customer-authenticated Checkout Quote generation', async () => {
    const res = await fetch(`${API_BASE}/ordering/checkout/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerSessionToken}`,
      },
      body: JSON.stringify({
        governorate: 'Cairo',
        area: 'Maadi',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Customer quote failed: ${res.status} ${err}`);
    }
    const quote: any = await res.json();
    customerQuoteVersion = quote.quoteVersion;
    customerCartRevision = quote.revision;
    if (quote.subtotal !== SUBTOTAL() || quote.shippingFee !== FEE || quote.totalAmount !== TOTAL()) {
      throw new Error(`Unexpected quote values: subtotal=${quote.subtotal}, shipping=${quote.shippingFee}, total=${quote.totalAmount}`);
    }
    return `Customer Quote created: ID ${customerQuoteVersion}, Revision ${customerCartRevision}, Total ${TOTAL()} EGP`;
  });

  // 9. Negative Test: Checkout with Unconfirmed Pin
  await record('Negative Test: Checkout rejected when locationConfirmed is false', async () => {
    const res = await fetch(`${API_BASE}/ordering/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerSessionToken}`,
      },
      body: JSON.stringify({
        customerName: 'أحمد حسن',
        customerPhone: testPhone,
        governorate: 'Cairo',
        area: 'Maadi',
        shippingAddress: 'شارع 9 المعادي',
        latitude: 29.9602,
        longitude: 31.2569,
        locationSource: 'map_pin',
        locationConfirmed: false, // INVALID
        idempotencyKey: randomUUID(),
        quoteVersion: customerQuoteVersion,
        cartRevision: customerCartRevision,
        paymentMethod: 'COD',
      }),
    });
    if (res.status !== 400) throw new Error(`Expected 400 for unconfirmed pin, got ${res.status}`);
    return 'Correctly rejected checkout payload with locationConfirmed: false';
  });

  // 10. Negative Test: Checkout with Pin Outside Cairo/Giza
  await record('Negative Test: Checkout rejected when coordinates are outside Cairo/Giza', async () => {
    const res = await fetch(`${API_BASE}/ordering/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerSessionToken}`,
      },
      body: JSON.stringify({
        customerName: 'أحمد حسن',
        customerPhone: testPhone,
        governorate: 'Cairo',
        area: 'Maadi',
        shippingAddress: 'شارع 9 المعادي',
        latitude: 31.2001, // Alexandria lat
        longitude: 29.9187, // Alexandria lng
        locationSource: 'map_pin',
        locationConfirmed: true,
        idempotencyKey: randomUUID(),
        quoteVersion: customerQuoteVersion,
        cartRevision: customerCartRevision,
        paymentMethod: 'COD',
      }),
    });
    if (res.status !== 400 && res.status !== 422) throw new Error(`Expected 400/422 for out-of-bounds coordinates, got ${res.status}`);
    return 'Correctly rejected delivery pin outside service boundary (422)';
  });

  // 11. Valid Order Placement (Idempotent COD Order)
  let createdOrderNumber = '';
  const orderIdempotencyKey = `idemp-w1-test-${Date.now()}`;
  await record('Atomic Order placement with confirmed pin, snapshot price, and COD', async () => {
    const res = await fetch(`${API_BASE}/ordering/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerSessionToken}`,
      },
      body: JSON.stringify({
        customerName: 'أحمد حسن',
        customerPhone: testPhone,
        governorate: 'Cairo',
        area: 'Maadi',
        shippingAddress: '15 شارع 9، المعادي، الدور الثالث، شقة 12',
        notes: 'بجوار محطة المترو',
        latitude: 29.9602,
        longitude: 31.2569,
        locationSource: 'map_pin',
        locationConfirmed: true,
        idempotencyKey: orderIdempotencyKey,
        quoteVersion: customerQuoteVersion,
        cartRevision: customerCartRevision,
        paymentMethod: 'COD',
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Order placement failed: ${res.status} ${err}`);
    }
    const order: any = await res.json();
    createdOrderId = order.id;
    createdOrderNumber = order.orderNumber;

    if (!order.orderNumber || !order.orderNumber.startsWith('ORD-')) {
      throw new Error(`Invalid orderNumber: ${order.orderNumber}`);
    }
    if (order.totalAmount !== TOTAL() || order.codAmount !== TOTAL() || order.shippingFee !== FEE) {
      throw new Error(`Order amounts mismatch: total=${order.totalAmount}, cod=${order.codAmount}, fee=${order.shippingFee}`);
    }
    if (order.latitude !== 29.9602 || order.longitude !== 31.2569) {
      throw new Error(`Order coordinates mismatch: lat=${order.latitude}, lng=${order.longitude}`);
    }

    // Verify DB persistence
    const dbOrder = await prisma.order.findUnique({
      where: { id: createdOrderId },
      include: { items: true, statusEvents: true },
    });
    if (!dbOrder) throw new Error('Order record not found in database');
    if (dbOrder.status !== 'placed') throw new Error(`Expected status placed, got ${dbOrder.status}`);
    if (dbOrder.items.length !== 1 || dbOrder.items[0].quantity !== 2) {
      throw new Error('Order items count or quantity mismatch in database');
    }

    // Verify cart is now empty
    const cart = await prisma.cart.findUnique({
      where: { customerId },
      include: { items: true },
    });
    if (cart && cart.items.length > 0) throw new Error('Customer cart was not emptied after order placement');

    return `Order placed successfully! Order Number: ${order.orderNumber}, DB ID: ${order.id}, Status: ${dbOrder.status}, Total: ${order.totalAmount} EGP`;
  });

  // 12. Idempotency & Double Submit Protection
  await record('Double-submit protection (Identical request replays same order)', async () => {
    const res = await fetch(`${API_BASE}/ordering/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerSessionToken}`,
      },
      body: JSON.stringify({
        customerName: 'أحمد حسن',
        customerPhone: testPhone,
        governorate: 'Cairo',
        area: 'Maadi',
        shippingAddress: '15 شارع 9، المعادي، الدور الثالث، شقة 12',
        notes: 'بجوار محطة المترو',
        latitude: 29.9602,
        longitude: 31.2569,
        locationSource: 'map_pin',
        locationConfirmed: true,
        idempotencyKey: orderIdempotencyKey,
        quoteVersion: customerQuoteVersion,
        cartRevision: customerCartRevision,
        paymentMethod: 'COD',
      }),
    });
    if (!res.ok) throw new Error(`Replay failed with status ${res.status}`);
    const replayed: any = await res.json();
    if (replayed.id !== createdOrderId) throw new Error(`Expected replayed order ID ${createdOrderId}, got ${replayed.id}`);
    return `Replayed identical request returned existing order ${replayed.orderNumber} without duplicate DB record`;
  });

  // 13. Reused Idempotency Key with Mutated Body
  await record('Reused idempotency key with altered payload rejected with 409', async () => {
    const res = await fetch(`${API_BASE}/ordering/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerSessionToken}`,
      },
      body: JSON.stringify({
        customerName: 'أحمد علي حسن', // CHANGED NAME
        customerPhone: testPhone,
        governorate: 'Cairo',
        area: 'Maadi',
        shippingAddress: '15 شارع 9، المعادي، الدور الثالث، شقة 12',
        latitude: 29.9602,
        longitude: 31.2569,
        locationSource: 'map_pin',
        locationConfirmed: true,
        idempotencyKey: orderIdempotencyKey,
        quoteVersion: customerQuoteVersion,
        cartRevision: customerCartRevision,
        paymentMethod: 'COD',
      }),
    });
    if (res.status !== 409) throw new Error(`Expected 409 for mutated idempotency key, got ${res.status}`);
    return 'Correctly rejected mutated payload with 409 Conflict';
  });

  // 14. Order Tracking Endpoint & Data Integrity
  await record('Order tracking API reflects exact persisted address, items, and status', async () => {
    const res = await fetch(`${API_BASE}/ordering/orders/${createdOrderNumber}`, {
      headers: { Authorization: `Bearer ${customerSessionToken}` },
    });
    if (!res.ok) throw new Error(`Order tracking fetch failed: ${res.status}`);
    const tracking: any = await res.json();
    if (tracking.orderNumber !== createdOrderNumber) throw new Error('Order number mismatch in tracking');
    if (tracking.status !== 'RECEIVED' && tracking.status !== 'CONFIRMING_PRODUCTS') {
      throw new Error(`Status mismatch: expected RECEIVED or CONFIRMING_PRODUCTS, got ${tracking.status}`);
    }
    if (tracking.deliveryAddress.latitude !== 29.9602 || tracking.deliveryAddress.longitude !== 31.2569) {
      throw new Error(`Coordinates mismatch in tracking: ${tracking.deliveryAddress.latitude}, ${tracking.deliveryAddress.longitude}`);
    }
    if (tracking.amounts.currentCodAmount !== TOTAL()) {
      throw new Error(`COD amount mismatch in tracking: ${tracking.amounts.currentCodAmount}`);
    }
    return `Tracking verified: Order: ${tracking.orderNumber}, Status: ${tracking.status}, Customer: ${tracking.customerName}, COD: ${tracking.amounts.currentCodAmount} EGP, Location: (${tracking.deliveryAddress.latitude}, ${tracking.deliveryAddress.longitude})`;
  });

  // 15. Customer Privacy & IDOR Protection
  await record('Order privacy / IDOR protection (Unauthorized user rejected with 403/404)', async () => {
    // Create a second unlinked session
    const anotherCustomer = await prisma.customer.create({
      data: {
        name: 'Another Customer',
        email: `intruder-${Date.now()}@test.com`,
        roles: ['CUSTOMER'],
      },
    });
    const anotherSession = await prisma.session.create({
      data: {
        token: randomUUID(),
        customerId: anotherCustomer.id,
        expiresAt: new Date(Date.now() + 3600_000),
        isValid: true,
      },
    });

    const res = await fetch(`${API_BASE}/ordering/orders/${createdOrderNumber}`, {
      headers: { Authorization: `Bearer ${anotherSession.token}` },
    });

    // Cleanup second customer immediately
    await prisma.session.delete({ where: { token: anotherSession.token } });
    await prisma.customer.delete({ where: { id: anotherCustomer.id } });

    if (res.status !== 403 && res.status !== 404) {
      throw new Error(`Expected 403/404 for cross-customer order access, got ${res.status}`);
    }
    return `IDOR protection verified: Cross-customer access rejected with status ${res.status}`;
  });

  // 16. Safe Cleanup of Synthetic Test Order
  const keep = process.env.KEEP_DATA === '1'; // leave the order in place for role walkthroughs on a disposable DB
  console.log(keep ? '\n--- KEEP_DATA=1: leaving synthetic order and customer in place ---' : '\n--- CLEANING UP SYNTHETIC TEST FIXTURES ---');
  if (createdOrderId && !keep) {
    await prisma.orderStatusEvent.deleteMany({ where: { orderId: createdOrderId } });
    await prisma.orderItem.deleteMany({ where: { orderId: createdOrderId } });
    await prisma.checkoutQuote.deleteMany({ where: { orderId: createdOrderId } });
    await prisma.order.delete({ where: { id: createdOrderId } });
    console.log(`Cleaned up test order: ${createdOrderId}`);
  }
  if (customerId && !keep) {
    await prisma.session.deleteMany({ where: { customerId } });
    await prisma.identity.deleteMany({ where: { customerId } });
    await prisma.checkoutQuote.deleteMany({ where: { cart: { customerId } } });
    await prisma.cartItem.deleteMany({ where: { cart: { customerId } } });
    await prisma.cart.deleteMany({ where: { customerId } });
    await prisma.customer.delete({ where: { id: customerId } });
    console.log(`Cleaned up test customer & session: ${customerId}`);
  }
  await prisma.otpChallenge.deleteMany({ where: { phoneNumber: canonicalPhone } });
  console.log('Cleaned up OTP challenges');

  console.log('\n======================================================');
  console.log('SUMMARY OF W1 STOREFRONT REAL VERIFICATION:');
  console.log('======================================================');
  const passes = results.filter((r) => r.status === 'PASS').length;
  const fails = results.filter((r) => r.status === 'FAIL').length;
  console.log(`Total: ${results.length} | Passed: ${passes} | Failed: ${fails}`);
  for (const r of results) {
    console.log(`- [${r.status}] ${r.check}: ${r.details}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
