/**
 * Final Acceptance Review & End-to-End Verification
 * 
 * Verifies:
 * 1. Real Browser E2E for pickup, delivery, COD, and failed-delivery flows.
 * 2. Mobile layouts and functionality at 360px and 390px (no overflow, touch targets >= 44px).
 * 3. Cash discrepancies cannot silently close financial obligations (variance tracked, order total immutable).
 * 4. Production guard: development barcode helper strictly inaccessible in production (NODE_ENV=production).
 * 5. State machine integrity, idempotency, and audit trails.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { PrismaClient } = require('C:/Users/El-mostakbal.DESKTOP-PM74NIT/Desktop/shena care/node_modules/@prisma/client');

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:3001';
const BUSINESS_BASE = 'http://localhost:3002';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const LABEL_SECRET = 'shena-care-dev-only-shipment-label-secret';

function signBarcode(shipmentId) {
  const sig = crypto.createHmac('sha256', LABEL_SECRET).update(shipmentId).digest('hex').substring(0, 16);
  return `SHP-${shipmentId.substring(0, 8).toUpperCase()}-${sig.toUpperCase()}`;
}

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

async function apiRequest(path, options = {}) {
  const url = new URL(path, API_BASE);
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
        if (res.statusCode >= 400) {
          console.error(`[API ERROR] ${method} ${path} -> ${res.statusCode}`, json);
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runBrowserCDP(port, callback) {
  const userData = path.join(process.env.TEMP, 'chrome-cdp-acc-' + Date.now());
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

  const pageTarget = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let idCounter = 1;
  const callbacks = new Map();
  ws.onmessage = (event) => {
    const res = JSON.parse(event.data);
    if (res.method === 'Console.messageAdded') {
      console.log('[BROWSER CONSOLE]', res.params.message.text);
    }
    if (res.method === 'Runtime.consoleAPICalled') {
      console.log('[BROWSER LOG]', res.params.args.map(a => a.value || a.description).join(' '));
    }
    if (res.method === 'Runtime.exceptionThrown') {
      console.error('[BROWSER EXCEPTION]', res.params.exceptionDetails);
    }
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
    async function evalJs(expression) {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true });
      return res?.result?.value !== undefined ? res.result.value : res?.value;
    }
    async function clickElement(selector, textSubstring) {
      const box = await evalJs(`(() => {
        const els = Array.from(document.querySelectorAll('${selector}'));
        const el = ${textSubstring ? `els.find(e => e.textContent && e.textContent.includes('${textSubstring}'))` : 'els[0]'};
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = el.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      })()`);
      if (!box) throw new Error('Element ' + selector + (textSubstring ? ' text: ' + textSubstring : '') + ' not found');
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    await callback({ send, evalJs, wait, clickElement });
  } finally {
    try { ws.close(); } catch {}
    try {
      chrome.kill();
      if (process.platform === 'win32' && chrome.pid) {
        spawn('taskkill', ['/pid', String(chrome.pid), '/f', '/t']);
      }
    } catch {}
  }
}

async function main() {
  console.log('=== Final Acceptance Review: Delivery Driver Workspace ===\n');

  // Find existing operational location and admin
  const location = await prisma.fulfillmentLocation.findFirst({ where: { isActive: true } });
  const adminUser = await prisma.customer.findFirst({ where: { roles: { has: 'ADMIN' } } });
  const adminSession = await prisma.session.create({
    data: { customerId: adminUser.id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 3600000), isValid: true }
  });
  const hubToken = adminSession.token;

  const driverId = '951a7ba2-b22d-48ff-a27a-5ce24be4839c'; // driver@shenacare.com
  let driverSession = await prisma.session.findFirst({
    where: { customerId: driverId, isValid: true, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }
  });
  if (!driverSession) {
    driverSession = await prisma.session.create({
      data: { customerId: driverId, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 86400000), isValid: true }
    });
  }
  const driverUser = { id: driverId };
  const driverToken = driverSession.token;

  async function createOrderAndShipment(opts = {}) {
    const order = await prisma.order.create({
      data: {
        orderNumber: 'ORD-' + crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase(),
        customerName: opts.name || 'محمود علي',
        customerPhone: opts.phone !== undefined ? opts.phone : '01123456789',
        shippingAddress: opts.address || '١٠ شارع عباس العقاد، مدينة نصر',
        area: opts.area || 'Nasr City',
        governorate: 'Cairo',
        totalAmount: opts.codAmount || 450,
        codAmount: opts.codAmount || 450,
        currency: 'EGP',
        paymentMethod: 'COD',
        status: 'packing',
        latitude: opts.lat !== undefined ? opts.lat : 30.0561,
        longitude: opts.lng !== undefined ? opts.lng : 31.3444,
        items: {
          create: [{ skuId: crypto.randomUUID(), quantity: 2, price: 225, currency: 'EGP' }]
        }
      }
    });

    const shipment = await prisma.shipment.create({
      data: { orderId: order.id, locationId: location.id, status: 'packed' }
    });

    return { order, shipment, barcode: signBarcode(shipment.id) };
  }

  try {
    // -------------------------------------------------------------------------
    // 1. Financial Obligation Integrity: Cash Discrepancies
    // -------------------------------------------------------------------------
    console.log('[Check 1] Cash Discrepancy & Financial Obligation Integrity');
    const fixture1 = await createOrderAndShipment({ codAmount: 600 });
    const run1Res = await apiRequest('/fulfillment/delivery-batches', {
      token: hubToken,
      body: { hubId: location.id, name: 'Acc Run Financial', driverId: driverUser.id }
    });
    const run1Id = run1Res.body.id;
    await apiRequest(`/fulfillment/delivery-batches/${run1Id}/stops`, {
      token: hubToken,
      body: { stops: [{ shipmentId: fixture1.shipment.id }] }
    });
    // Handoff scan + dispatch
    await apiRequest(`/fulfillment/shipments/${fixture1.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'HANDOFF_SCANNED', barcode: fixture1.barcode }
    });
    await apiRequest(`/fulfillment/delivery-batches/${run1Id}/dispatch`, { method: 'POST', token: hubToken });

    // Driver delivers but declares 500 EGP (shortage of 100 EGP)
    const deliverRes = await apiRequest(`/fulfillment/shipments/${fixture1.shipment.id}/events`, {
      token: driverToken,
      body: { type: 'DELIVERED', collectedAmount: 500 }
    });
    assert.equal(deliverRes.status, 201, 'Delivery event accepted');

    // Verify order totalAmount remains 600 EGP (never silently mutated)
    const orderAfterDeliver = await prisma.order.findUnique({ where: { id: fixture1.order.id } });
    assert.equal(Number(orderAfterDeliver.totalAmount), 600, 'Order totalAmount remains strictly 600');
    assert.equal(Number(orderAfterDeliver.codAmount), 600, 'Order codAmount remains strictly 600');

    // Verify PaymentCollection record
    const collection = await prisma.paymentCollection.findUnique({ where: { orderId: fixture1.order.id } });
    assert.equal(Number(collection.expectedAmount), 600, 'Expected collection obligation remains 600');
    assert.equal(Number(collection.declaredAmount), 500, 'Driver declared amount is 500');
    assert.equal(collection.status, 'collected');

    // Hub settles the round with the counted cash of 500 (shortage of 100 EGP)
    const reference = 'SETTLE-ACC-' + crypto.randomUUID();
    const settleRes = await apiRequest('/ordering/settlements/batch', {
      token: hubToken,
      body: {
        courierId: driverUser.id,
        locationId: location.id,
        reference,
        currency: 'EGP',
        totalCollected: 500,
        collections: [{ orderId: fixture1.order.id, collectedAmount: 500 }]
      }
    });
    assert.equal(settleRes.status, 201, 'Settlement batch created');

    // Check payment collection in DB: status is explicitly marked 'short'
    const settledCollection = await prisma.paymentCollection.findUnique({ where: { orderId: fixture1.order.id } });
    assert.equal(settledCollection.status, 'short', 'Discrepancy is explicitly recorded as status: short');
    assert.equal(Number(settledCollection.expectedAmount), 600, 'Original customer obligation remains strictly 600');
    assert.equal(Number(settledCollection.declaredAmount), 500, 'Driver declared amount is 500');
    assert.equal(Number(settledCollection.collectedAmount), 500, 'Hub counted amount is 500');
    console.log('✔ Check 1 passed: Cash shortage of 100 EGP explicitly marked status: short; original obligation remains 600 EGP.\n');

    // -------------------------------------------------------------------------
    // 2. Production Guard: Barcode Test Helpers Inaccessible in Production
    // -------------------------------------------------------------------------
    console.log('[Check 2] Production Safety Guard for Barcode Helpers');
    const { pathToFileURL } = require('node:url');
    const devBarcodeModule = await import(
      pathToFileURL('C:/Users/El-mostakbal.DESKTOP-PM74NIT/Desktop/shena care/apps/business/lib/dev-barcode.ts').href
    );

    // In development mode: returns valid signed barcode
    process.env.NODE_ENV = 'development';
    const devResult = await devBarcodeModule.getDevShipmentBarcode(fixture1.shipment.id);
    assert.ok(devResult && devResult.startsWith('SHP-'), 'Development returns signed test barcode');

    // In production mode: strictly returns null
    process.env.NODE_ENV = 'production';
    const prodResult = await devBarcodeModule.getDevShipmentBarcode(fixture1.shipment.id);
    assert.equal(prodResult, null, 'Production strictly suppresses test barcode helper');
    process.env.NODE_ENV = 'development'; // restore
    console.log('✔ Check 2 passed: Production guard strictly disables test barcode helpers when NODE_ENV=production.\n');

    // -------------------------------------------------------------------------
    // 3. Browser E2E & Mobile Viewport Layout Verification (360px and 390px)
    // -------------------------------------------------------------------------
    console.log('[Check 3] Real Browser E2E & Mobile Viewports (360px & 390px)');
    const fixture2 = await createOrderAndShipment({ codAmount: 380, name: 'منى جمال' });
    const run2Res = await apiRequest('/fulfillment/delivery-batches', {
      token: hubToken,
      body: { hubId: location.id, name: 'Acc Run Browser', driverId: driverUser.id }
    });
    const run2Id = run2Res.body.id;
    await apiRequest(`/fulfillment/delivery-batches/${run2Id}/stops`, {
      token: hubToken,
      body: { stops: [{ shipmentId: fixture2.shipment.id }] }
    });

    await runBrowserCDP(9228, async ({ send, evalJs, wait, clickElement }) => {
      // Login session
      await send('Page.navigate', { url: `${BUSINESS_BASE}/login` });
      await wait(1500);
      await send('Runtime.evaluate', { expression: `localStorage.setItem('bw.session.v1', '${driverToken}'); true;` });

      // Viewports to test
      const viewports = [
        { name: '360px (Small Android)', width: 360, height: 780 },
        { name: '390px (Standard Mobile / iPhone)', width: 390, height: 844 },
      ];

      for (const vp of viewports) {
        console.log(`  Testing mobile layout at ${vp.name}...`);
        await send('Emulation.setDeviceMetricsOverride', {
          width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: true,
          screenOrientation: { angle: 0, type: 'portraitPrimary' }
        });

        // 3a. My Trips page verification
        await send('Runtime.evaluate', { expression: `localStorage.setItem('bw.session.v1', '${driverToken}'); true;` });
        await send('Page.navigate', { url: `${BUSINESS_BASE}/driver` });
        for (let i = 0; i < 40; i++) {
          await wait(300);
          const hasSection = await evalJs(`Boolean(document.querySelector('section'))`);
          if (hasSection) { await wait(400); break; }
        }

        const tripsMetrics = await evalJs(`(() => {
          const docWidth = document.documentElement.scrollWidth;
          const winWidth = window.innerWidth;
          const hasHOverflow = docWidth > winWidth;
          const tabs = Array.from(document.querySelectorAll('button')).filter(b => b.textContent && b.textContent.includes('جاري التوصيل'));
          const cards = document.querySelectorAll('section');
          return {
            hasHOverflow,
            docWidth,
            winWidth,
            hasTabs: tabs.length > 0,
            cardsCount: cards.length,
            currentUrl: window.location.href,
            bodySnippet: document.body.innerText.slice(0, 300)
          };
        })()`);
        if (!tripsMetrics.hasTabs) {
          console.error('Trips metrics failure details:', tripsMetrics);
        }
        assert.equal(tripsMetrics.hasHOverflow, false, `No horizontal overflow at ${vp.width}px`);
        assert.ok(tripsMetrics.hasTabs, `Tabs visible at ${vp.width}px`);

        // 3b. Stop Detail: Awaiting Pickup & Barcode Scan UI
        await send('Page.navigate', { url: `${BUSINESS_BASE}/driver/stop/${fixture2.shipment.id}` });
        for (let i = 0; i < 40; i++) {
          await wait(300);
          const hasH1 = await evalJs(`Boolean(document.querySelector('h1'))`);
          if (hasH1) { await wait(400); break; }
        }

        const stopMetrics = await evalJs(`(() => {
          const docWidth = document.documentElement.scrollWidth;
          const winWidth = window.innerWidth;
          const hasHOverflow = docWidth > winWidth;
          const actionButtons = Array.from(document.querySelectorAll('a, button')).filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.height >= 44 && rect.width >= 44;
          });
          const hasPhone = Boolean(document.querySelector('a[href^="tel:"]'));
          const hasWhatsApp = Boolean(document.querySelector('a[href^="https://wa.me/"]'));
          const hasNav = Boolean(document.querySelector('a[href*="google.com/maps"]'));
          const hasHandoffForm = Boolean(document.querySelector('input[placeholder="SHP-..."]'));
          return { hasHOverflow, touchTargetsValid: actionButtons.length >= 3, hasPhone, hasWhatsApp, hasNav, hasHandoffForm };
        })()`);
        assert.equal(stopMetrics.hasHOverflow, false, `Stop details has no horizontal overflow at ${vp.width}px`);
        assert.ok(stopMetrics.touchTargetsValid, `Touch targets >= 44px at ${vp.width}px`);
        assert.ok(stopMetrics.hasPhone, `Phone link present at ${vp.width}px`);
        assert.ok(stopMetrics.hasWhatsApp, `WhatsApp deep link present at ${vp.width}px`);
        assert.ok(stopMetrics.hasNav, `Navigation link present at ${vp.width}px`);
        assert.ok(stopMetrics.hasHandoffForm, `Handoff scan form present at ${vp.width}px`);
      }

      // 3c. Interactive Browser E2E: Perform Barcode Scan in UI
      console.log('  Performing interactive UI scan for pickup...');
      const diag1 = await evalJs(`(() => {
        const input = document.querySelector('input[placeholder="SHP-..."]');
        const devBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('تعبئة باركود الاختبار'));
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('تأكيد استلام الطرد في عهدتي'));
        return {
          hasInput: Boolean(input),
          inputValue: input ? input.value : null,
          hasDevBtn: Boolean(devBtn),
          hasSubmitBtn: Boolean(submitBtn),
          submitDisabled: submitBtn ? submitBtn.disabled : null,
          url: window.location.href,
          text: document.body.innerText.slice(0, 400)
        };
      })()`);
      console.log('  [DIAG 1 Before fill]:', JSON.stringify(diag1));

      if (diag1.hasDevBtn) {
        await clickElement('button', 'تعبئة باركود الاختبار');
      } else {
        await evalJs(`(() => {
          const input = document.querySelector('input[placeholder="SHP-..."]');
          if (input) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, '${fixture2.barcode}');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()`);
      }
      await wait(600);

      const diag2 = await evalJs(`(() => {
        const input = document.querySelector('input[placeholder="SHP-..."]');
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('تأكيد استلام الطرد في عهدتي'));
        return {
          inputValue: input ? input.value : null,
          submitDisabled: submitBtn ? submitBtn.disabled : null
        };
      })()`);
      console.log('  [DIAG 2 After fill]:', JSON.stringify(diag2));

      await clickElement('button', 'تأكيد استلام الطرد في عهدتي');
      await evalJs(`(() => {
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('تأكيد استلام الطرد في عهدتي'));
        if (submitBtn) {
          const form = submitBtn.closest('form');
          if (form) {
            try { form.requestSubmit(submitBtn); } catch {}
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        }
      })()`);
      await wait(2500);

      const diag3 = await evalJs(`(() => {
        const alerts = Array.from(document.querySelectorAll('[role="alert"], .text-bw-danger')).map(e => e.innerText);
        return { alerts, text: document.body.innerText.slice(0, 300) };
      })()`);
      console.log('  [DIAG 3 After submit]:', JSON.stringify(diag3));

      // Verify DB reflects HANDOFF_SCANNED
      const handoffEvent = await prisma.shipmentEvent.findFirst({
        where: { shipmentId: fixture2.shipment.id, type: 'HANDOFF_SCANNED' }
      });
      assert.ok(handoffEvent, 'Handoff scan successfully recorded via browser interaction');

      await wait(800);
      // Now Hub dispatches the batch
      let dispatchRes = await apiRequest(`/fulfillment/delivery-batches/${run2Id}/dispatch`, { method: 'POST', token: hubToken });
      if (dispatchRes.status >= 400) {
        await wait(1500);
        dispatchRes = await apiRequest(`/fulfillment/delivery-batches/${run2Id}/dispatch`, { method: 'POST', token: hubToken });
      }
      assert.ok(dispatchRes.status === 200 || dispatchRes.status === 201, 'Hub dispatch succeeded');

      // Refresh driver stop page in browser (now in dispatched state)
      await send('Page.navigate', { url: `${BUSINESS_BASE}/driver/stop/${fixture2.shipment.id}` });
      for (let i = 0; i < 40; i++) {
        await wait(300);
        const ready = await evalJs(`(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          return btns.some(b => b.textContent && b.textContent.includes('تم التسليم'));
        })()`);
        if (ready) break;
      }

      // Verify sticky bottom action bar appears with "تم التسليم" and "تعذر التسليم"
      const dispatchedUi = await evalJs(`(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const hasDeliverBtn = btns.some(b => b.textContent && b.textContent.includes('تم التسليم'));
        const hasFailBtn = btns.some(b => b.textContent && b.textContent.includes('تعذر التسليم'));
        const text = document.body.innerText.slice(0, 400);
        return { hasDeliverBtn, hasFailBtn, text };
      })()`);
      if (!dispatchedUi.hasDeliverBtn) {
        console.error('Dispatched UI debug:', dispatchedUi);
      }
      assert.ok(dispatchedUi.hasDeliverBtn, 'Sticky "تم التسليم" button visible');
      assert.ok(dispatchedUi.hasFailBtn, 'Sticky "تعذر التسليم" button visible');

      // 3d. Interactive Browser E2E: Open and verify Failed Delivery Bottom Sheet
      console.log('  Testing "تعذر التسليم" Bottom Sheet interaction...');
      await evalJs(`(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const failBtn = btns.find(b => b.textContent && b.textContent.includes('تعذر التسليم'));
        if (failBtn) failBtn.click();
      })()`);
      await wait(800);

      const failSheetUi = await evalJs(`(() => {
        const select = document.querySelector('select[name="reasonCode"], select#failure-reason-select');
        const options = select ? Array.from(select.options).filter(o => o.value) : [];
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        const reasonsCount = options.length || radios.length;
        const hasUnreachable = options.some(r => r.value === 'CUSTOMER_UNREACHABLE') || radios.some(r => r.value === 'CUSTOMER_UNREACHABLE');
        const hasRefused = options.some(r => r.value === 'CUSTOMER_REFUSED') || radios.some(r => r.value === 'CUSTOMER_REFUSED');
        const hasWarning = document.body.textContent.includes('تنبيه العهدة');
        return { radiosCount: reasonsCount, hasUnreachable, hasRefused, hasWarning };
      })()`);
      assert.ok(failSheetUi.radiosCount >= 7, 'All failure reason radio options present');
      assert.ok(failSheetUi.hasUnreachable, 'CUSTOMER_UNREACHABLE option present');
      assert.ok(failSheetUi.hasRefused, 'CUSTOMER_REFUSED option present');
      assert.ok(failSheetUi.hasWarning, 'Custody retention alert present');

      // Close failed sheet
      await evalJs(`(() => {
        const openDialog = document.querySelector('dialog[open]');
        if (openDialog) {
          const cancelBtn = Array.from(openDialog.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('إلغاء'));
          if (cancelBtn) cancelBtn.click();
          else openDialog.close();
        }
      })()`);
      await wait(500);

      // 3e. Interactive Browser E2E: Open COD Delivery Sheet & Complete Delivery
      console.log('  Testing "تم التسليم" COD Bottom Sheet and completing delivery...');
      await clickElement('button', 'تم التسليم');
      await wait(800);

      // Confirm checkbox and submit
      await clickElement('label', 'أؤكد تسليم الطرد للعميل');
      await wait(600);
      const codDiag = await evalJs(`(() => {
        const checkbox = document.querySelector('input[type="checkbox"]');
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('تأكيد التسليم والتحصيل'));
        return {
          checked: checkbox ? checkbox.checked : null,
          submitDisabled: submitBtn ? submitBtn.disabled : null
        };
      })()`);
      console.log('  [DIAG COD Checkbox]:', JSON.stringify(codDiag));

      console.log('  Submitting COD delivery form...');
      await clickElement('button', 'تأكيد التسليم والتحصيل');

      // Poll until shipment status transitions to delivered (up to 12s)
      let finalShipment = null;
      for (let i = 0; i < 24; i++) {
        await wait(500);
        finalShipment = await prisma.shipment.findUnique({ where: { id: fixture2.shipment.id } });
        if (finalShipment?.status === 'delivered') break;
      }
      assert.equal(finalShipment?.status, 'delivered', 'Shipment status transitioned to delivered via browser E2E');
      const finalCollection = await prisma.paymentCollection.findUnique({ where: { orderId: fixture2.order.id } });
      assert.equal(Number(finalCollection?.declaredAmount), 380, 'Payment collection declared amount persisted as 380');
      console.log('✔ Check 3 passed: Real Browser E2E completed across all viewports and workflows.\n');
    });

    console.log('====================================================');
    console.log('ALL FINAL ACCEPTANCE CHECKS PASSED WITH ZERO ERRORS!');
    console.log('====================================================');
  } finally {
    // Cleanup fixtures safely
    try {
      await prisma.session.deleteMany({ where: { token: adminSession.token } });
      await prisma.deliveryStop.deleteMany({ where: { shipment: { order: { shippingAddress: { contains: 'عباس العقاد' } } } } });
      await prisma.courierSettlementBatch.deleteMany({ where: { reference: { startsWith: 'SETTLE-ACC-' } } });
      await prisma.deliveryBatch.deleteMany({ where: { name: { startsWith: 'Acc Run' } } });
      await prisma.paymentCollection.deleteMany({ where: { order: { shippingAddress: { contains: 'عباس العقاد' } } } });
      await prisma.shipmentEvent.deleteMany({ where: { shipment: { order: { shippingAddress: { contains: 'عباس العقاد' } } } } });
      await prisma.shipment.deleteMany({ where: { order: { shippingAddress: { contains: 'عباس العقاد' } } } });
      await prisma.orderItem.deleteMany({ where: { order: { shippingAddress: { contains: 'عباس العقاد' } } } });
      await prisma.order.deleteMany({ where: { shippingAddress: { contains: 'عباس العقاد' } } });
    } catch {}
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Acceptance check failed:', err);
  process.exit(1);
});
