/**
 * Capture Desktop and Mobile screenshots for Hub Courier Handoff & Cash Settlement
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const API_BASE = 'http://127.0.0.1:3001';
const BUSINESS_BASE = 'http://127.0.0.1:3002';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUTPUT_DIR = path.resolve(__dirname, '../output/playwright');

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function request(endpoint, options = {}) {
  const url = new URL(endpoint, API_BASE);
  const method = options.method || (options.body ? 'POST' : 'GET');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers || {}),
  };
  const payload = options.body ? JSON.stringify(options.body) : null;
  if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

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

async function runBrowserCDP(port, callback) {
  const userData = path.join(process.env.TEMP, 'chrome-cdp-hub-' + Date.now());
  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    `--user-data-dir=${userData}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank'
  ]);

  let targets;
  for (let i = 0; i < 30; i++) {
    await wait(400);
    try {
      targets = await getJson(`http://127.0.0.1:${port}/json`);
      if (targets?.length) break;
    } catch {}
  }

  if (!targets?.length) {
    chrome.kill();
    throw new Error('Chrome failed to start or open debugging port.');
  }

  const pageTarget = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let idCounter = 1;
  const callbacks = new Map();
  ws.onmessage = (event) => {
    const res = JSON.parse(event.data);
    if (res.id && callbacks.has(res.id)) {
      callbacks.get(res.id)(res);
      callbacks.delete(res.id);
    }
  };

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      callbacks.set(id, (res) => {
        if (res.error) reject(new Error(res.error.message || JSON.stringify(res.error)));
        else resolve(res.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await callback({ send, wait });
  } finally {
    ws.close();
    chrome.kill();
  }
}

async function main() {
  console.log('=== Seeding Visual Data for Hub Dispatch & Cash Settlement ===');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. Setup Hub Location
  const location = await prisma.fulfillmentLocation.create({
    data: {
      name: 'مخزن المعادي للتوزيع ' + crypto.randomUUID().slice(0, 6),
      address: 'المعادي، القاهرة',
      capabilities: ['RECEIVE_SUPPLIER_GOODS', 'PREPARE_ORDERS', 'DISPATCH_SHIPMENTS', 'MANAGE_OWNED_INVENTORY'],
      isActive: true,
    }
  });

  const hubUser = await prisma.customer.create({
    data: { name: 'أحمد سعيد (مشرف التوزيع)', email: `hub-lead-${Date.now()}@test.shena`, roles: ['HUB_OPERATOR', 'ADMIN'] }
  });
  await prisma.fulfillmentLocationOperator.create({
    data: { locationId: location.id, operatorId: hubUser.id }
  });
  const hubSession = await prisma.session.create({
    data: { customerId: hubUser.id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 86400000) }
  });

  const courier1 = await prisma.customer.create({
    data: { name: 'محمود علي (مندوب المعادي)', email: `courier-m-${Date.now()}@test.shena`, roles: ['DRIVER'] }
  });
  const courier1Session = await prisma.session.create({
    data: { customerId: courier1.id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 86400000) }
  });

  const courier2 = await prisma.customer.create({
    data: { name: 'عمر خالد (مندوب مدينة نصر)', email: `courier-o-${Date.now()}@test.shena`, roles: ['DRIVER'] }
  });
  const courier2Session = await prisma.session.create({
    data: { customerId: courier2.id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 86400000) }
  });

  const hubToken = hubSession.token;
  const driver1Token = courier1Session.token;
  const driver2Token = courier2Session.token;

  async function createTestParcel(codAmount = 350, customerName = 'عميل تجريبي') {
    const order = await prisma.order.create({
      data: {
        orderNumber: 'ORD-' + crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase(),
        customerName,
        customerPhone: '01012345678',
        shippingAddress: 'شارع المعز، القاهرة',
        area: 'Cairo',
        governorate: 'Cairo',
        totalAmount: codAmount,
        codAmount: codAmount,
        currency: 'EGP',
        paymentMethod: 'COD',
        status: 'packing',
        latitude: 30.0444,
        longitude: 31.2357,
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

    return { order, shipment, barcode: labelRes.body.barcode };
  }

  // 1. Ready parcels (Tab 1: جاهزة للتسليم)
  console.log('Seeding Tab 1 (جاهزة للتسليم)...');
  await createTestParcel(420, 'سارة أحمد — المعادي');
  await createTestParcel(280, 'محمد كمال — دجلة');

  // 2. Awaiting pickup trip (Tab 2: بانتظار الاستلام)
  console.log('Seeding Tab 2 (بانتظار الاستلام)...');
  const p2_1 = await createTestParcel(350, 'هدى إبراهيم — شارع 9');
  const p2_2 = await createTestParcel(480, 'كريم طارق — اللاسلكي');
  const run1 = (await request('/fulfillment/delivery-batches', {
    token: hubToken,
    body: { hubId: location.id, name: 'رحلة المعادي الصباحية 01', driverId: courier1.id }
  })).body.id;
  await request(`/fulfillment/delivery-batches/${run1}/stops`, {
    token: hubToken,
    body: { stops: [{ shipmentId: p2_1.shipment.id }, { shipmentId: p2_2.shipment.id }] }
  });

  // 3. Active delivery trip (Tab 3: جاري التوصيل)
  console.log('Seeding Tab 3 (جاري التوصيل)...');
  const p3_1 = await createTestParcel(550, 'إسلام فهمي — الطيران');
  const p3_2 = await createTestParcel(320, 'منى زكي — عباس العقاد');
  const run2 = (await request('/fulfillment/delivery-batches', {
    token: hubToken,
    body: { hubId: location.id, name: 'رحلة مدينة نصر 02', driverId: courier2.id }
  })).body.id;
  await request(`/fulfillment/delivery-batches/${run2}/stops`, {
    token: hubToken,
    body: { stops: [{ shipmentId: p3_1.shipment.id }, { shipmentId: p3_2.shipment.id }] }
  });
  await request(`/fulfillment/shipments/${p3_1.shipment.id}/events`, {
    token: driver2Token,
    body: { type: 'HANDOFF_SCANNED', barcode: p3_1.barcode }
  });
  await request(`/fulfillment/shipments/${p3_2.shipment.id}/events`, {
    token: driver2Token,
    body: { type: 'HANDOFF_SCANNED', barcode: p3_2.barcode }
  });
  await request(`/fulfillment/delivery-batches/${run2}/dispatch`, {
    method: 'POST',
    token: hubToken,
  });

  // 4. Trip Awaiting Settlement (Tab 4: بانتظار التسوية)
  console.log('Seeding Tab 4 (بانتظار التسوية)...');
  const p4_1 = await createTestParcel(450, 'ياسر مصطفى — دجلة');
  const p4_2 = await createTestParcel(350, 'رانيا يوسف — النصر');
  const p4_3 = await createTestParcel(200, 'طارق حسام — حدائق المعادي');
  const run3 = (await request('/fulfillment/delivery-batches', {
    token: hubToken,
    body: { hubId: location.id, name: 'رحلة المعادي المسائية 03', driverId: courier1.id }
  })).body.id;
  await request(`/fulfillment/delivery-batches/${run3}/stops`, {
    token: hubToken,
    body: { stops: [{ shipmentId: p4_1.shipment.id }, { shipmentId: p4_2.shipment.id }, { shipmentId: p4_3.shipment.id }] }
  });
  await request(`/fulfillment/shipments/${p4_1.shipment.id}/events`, { token: driver1Token, body: { type: 'HANDOFF_SCANNED', barcode: p4_1.barcode } });
  await request(`/fulfillment/shipments/${p4_2.shipment.id}/events`, { token: driver1Token, body: { type: 'HANDOFF_SCANNED', barcode: p4_2.barcode } });
  await request(`/fulfillment/shipments/${p4_3.shipment.id}/events`, { token: driver1Token, body: { type: 'HANDOFF_SCANNED', barcode: p4_3.barcode } });
  await request(`/fulfillment/delivery-batches/${run3}/dispatch`, { method: 'POST', token: hubToken });

  // Deliver p4_1 and p4_2
  await request(`/fulfillment/shipments/${p4_1.shipment.id}/events`, { token: driver1Token, body: { type: 'DELIVERED', collectedAmount: 450 } });
  await request(`/fulfillment/shipments/${p4_2.shipment.id}/events`, { token: driver1Token, body: { type: 'DELIVERED', collectedAmount: 350 } });
  // Fail p4_3
  await request(`/fulfillment/shipments/${p4_3.shipment.id}/events`, { token: driver1Token, body: { type: 'DELIVERY_FAILED', notes: 'العميل رفض الاستلام' } });

  // 5. Closed trip (Tab 5: المغلقة)
  console.log('Seeding Tab 5 (المغلقة)...');
  const p5_1 = await createTestParcel(300, 'ماجد عبد الله');
  const run4 = (await request('/fulfillment/delivery-batches', {
    token: hubToken,
    body: { hubId: location.id, name: 'رحلة المعادي المغلقة 00', driverId: courier2.id }
  })).body.id;
  await request(`/fulfillment/delivery-batches/${run4}/stops`, { token: hubToken, body: { stops: [{ shipmentId: p5_1.shipment.id }] } });
  await request(`/fulfillment/shipments/${p5_1.shipment.id}/events`, { token: driver2Token, body: { type: 'HANDOFF_SCANNED', barcode: p5_1.barcode } });
  await request(`/fulfillment/delivery-batches/${run4}/dispatch`, { method: 'POST', token: hubToken });
  await request(`/fulfillment/shipments/${p5_1.shipment.id}/events`, { token: driver2Token, body: { type: 'DELIVERED', collectedAmount: 300 } });
  // Settle driver2 cash
  await request('/ordering/settlements/rounds', {
    token: hubToken,
    body: {
      courierId: courier2.id,
      hubLocationId: location.id,
      reference: 'SET-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
      countedTotal: 300,
    }
  });
  // Complete trip
  await request(`/fulfillment/delivery-batches/${run4}/complete`, { method: 'POST', token: hubToken });

  console.log('✔ All operational scenarios seeded in database.');

  // Launch Chrome and capture views
  await runBrowserCDP(9229, async ({ send, wait }) => {
    console.log('Configuring browser session...');
    await send('Page.navigate', { url: `${BUSINESS_BASE}/login` });
    await wait(1500);

    await send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('bw.session.v1', '${hubToken}');
        localStorage.setItem('bw.hub.v1', '${location.id}');
        true;
      `
    });

    // -------------------------------------------------------------
    // Viewport 1: Desktop (1280x800)
    // -------------------------------------------------------------
    console.log('\n--- Capturing Desktop Screenshots (1280x800) ---');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    });

    // 1. Desktop Overview
    await send('Page.navigate', { url: `${BUSINESS_BASE}/hub/dispatch` });
    await wait(3000);

    const shot1 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'hub-dispatch-desktop-overview.png'), Buffer.from(shot1.data, 'base64'));
    console.log('✔ Saved: output/playwright/hub-dispatch-desktop-overview.png');

    // 2. Click "بانتظار التسوية" Tab and open Settlement Drawer
    await send('Runtime.evaluate', {
      expression: `
        const tabs = Array.from(document.querySelectorAll('button'));
        const tab = tabs.find(b => b.textContent && b.textContent.includes('بانتظار التسوية'));
        if (tab) tab.click();
      `
    });
    await wait(1500);

    // Click "تسوية عهدة المندوب"
    await send('Runtime.evaluate', {
      expression: `
        const btns = Array.from(document.querySelectorAll('button'));
        const settleBtn = btns.find(b => b.textContent && b.textContent.includes('تسوية عهدة المندوب'));
        if (settleBtn) settleBtn.click();
      `
    });
    await wait(2000);

    // Enter counted amount 750 (shortfall by 50 EGP) to demonstrate discrepancy display
    await send('Runtime.evaluate', {
      expression: `
        const input = document.querySelector('input[type="number"]');
        if (input) {
          input.value = '750';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      `
    });
    await wait(1000);

    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'hub-dispatch-desktop-settlement-drawer.png'), Buffer.from(shot2.data, 'base64'));
    console.log('✔ Saved: output/playwright/hub-dispatch-desktop-settlement-drawer.png');

    // 3. Close Settlement Drawer and open History Drawer ("سجل التسويات")
    await send('Runtime.evaluate', {
      expression: `
        const closeBtn = document.querySelector('button[aria-label="إغلاق"]');
        if (closeBtn) closeBtn.click();
      `
    });
    await wait(1000);

    await send('Runtime.evaluate', {
      expression: `
        const btns = Array.from(document.querySelectorAll('button'));
        const histBtn = btns.find(b => b.textContent && b.textContent.includes('سجل التسويات'));
        if (histBtn) histBtn.click();
      `
    });
    await wait(2000);

    const shot3 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'hub-dispatch-desktop-history-drawer.png'), Buffer.from(shot3.data, 'base64'));
    console.log('✔ Saved: output/playwright/hub-dispatch-desktop-history-drawer.png');

    // -------------------------------------------------------------
    // Viewport 2: Mobile (390x844 iPhone Standard)
    // -------------------------------------------------------------
    console.log('\n--- Capturing Mobile Screenshots (390x844) ---');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
      screenOrientation: { angle: 0, type: 'portraitPrimary' }
    });

    // 4. Mobile Overview of /hub/dispatch
    await send('Page.navigate', { url: `${BUSINESS_BASE}/hub/dispatch` });
    await wait(3000);

    const shot4 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'hub-dispatch-mobile-390px.png'), Buffer.from(shot4.data, 'base64'));
    console.log('✔ Saved: output/playwright/hub-dispatch-mobile-390px.png');

    // 5. Mobile Tab "بانتظار التسوية" & Open Bottom Sheet
    await send('Runtime.evaluate', {
      expression: `
        const tabs = Array.from(document.querySelectorAll('button'));
        const tab = tabs.find(b => b.textContent && b.textContent.includes('بانتظار التسوية'));
        if (tab) tab.click();
      `
    });
    await wait(1200);

    await send('Runtime.evaluate', {
      expression: `
        const btns = Array.from(document.querySelectorAll('button'));
        const settleBtn = btns.find(b => b.textContent && b.textContent.includes('تسوية عهدة المندوب'));
        if (settleBtn) settleBtn.click();
      `
    });
    await wait(2000);

    const shot5 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'hub-dispatch-mobile-settlement-sheet.png'), Buffer.from(shot5.data, 'base64'));
    console.log('✔ Saved: output/playwright/hub-dispatch-mobile-settlement-sheet.png');

    console.log('\n✔ All 5 desktop and mobile screenshots captured successfully in output/playwright/!');
  });
}

main().catch(err => {
  console.error('Error during screenshot capture:', err);
  process.exit(1);
});
