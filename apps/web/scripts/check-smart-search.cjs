/** Real browser + HTTP + isolated PostgreSQL acceptance. Set NODE_PATH to an existing Playwright installation. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const origin = process.env.SEARCH_WEB_ORIGIN || 'http://127.0.0.1:3107';
const output = path.resolve(__dirname, '../../../output/playwright/smart-search');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, '.gitignore'), '*\n');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [], failures = [], steps = [], consoleErrors = [];
  let testingOffline = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !testingOffline && !message.location().url?.endsWith('/favicon.ico')) consoleErrors.push(message.text());
  });
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) failures.push(`${response.status()} ${response.url()}`); });
  async function step(name, fn) {
    const start = performance.now(); await fn(); steps.push({ name, passed: true, ms: Math.round(performance.now() - start) });
    console.log(`PASS ${name}`);
  }
  try {
    await page.goto(`${origin}/products`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.locator('article a[href]').first().waitFor();
    const input = page.locator('#site-search-d');
    await step('Desktop partial query, real autocomplete and approved product image', async () => {
      await input.click();
      await input.fill('cerav');
      const product = page.getByRole('option', { name: /CeraVe SA Smoothing Cleanser/ });
      await product.waitFor();
      await product.locator('img').waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[role="option"] img')].every(image => image.complete && image.naturalWidth > 0));
      await page.screenshot({ path: path.join(output, 'desktop-1440.png') });
    });
    await step('Keyboard selection opens the exact PDP and browser Back restores search', async () => {
      const target = page.getByRole('option', { name: /CeraVe SA Smoothing Cleanser/ });
      const href = await target.getAttribute('href');
      await input.press('End');
      assert.match(await input.getAttribute('aria-activedescendant'), /search:view-all$/);
      await input.press('Home');
      assert.match(await input.getAttribute('aria-activedescendant'), /brand:cerave$/);
      for (let index = 0; index < 6; index++) {
        await input.press('ArrowDown');
        const active = await input.getAttribute('aria-activedescendant');
        if (active && await page.locator(`[id="${active}"]`).getAttribute('href') === href) break;
      }
      await input.press('Enter'); await page.waitForURL(`${origin}${href}`, { timeout: 90000 });
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.goBack(); await input.waitFor();
    });
    await step('Arabic RTL query submits real results and filters preserve query state', async () => {
      await input.fill('سيرافي'); await input.press('Enter');
      await page.waitForURL(url => url.searchParams.get('q') === 'سيرافي');
      await page.locator('article a[href]').first().waitFor();
      assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
      const filter = page.getByRole('checkbox', { name: /غسول|cleansers/i });
      await filter.first().click();
      await page.waitForURL(url => url.searchParams.get('category') === 'cleansers' && url.searchParams.get('q') === 'سيرافي');
      await page.getByLabel('ترتيب النتايج').selectOption('price-asc');
      await page.waitForURL(url => url.searchParams.get('sort') === 'price-asc');
      await page.screenshot({ path: path.join(output, 'results-rtl-1440.png') });
    });
    await step('Verified suitability query excludes unsupported products', async () => {
      await input.fill('غسول للبشرة الدهنية'); await input.press('Enter');
      await page.waitForURL(url => url.searchParams.get('q') === 'غسول للبشرة الدهنية');
      await page.locator('article a[href]').first().waitFor();
      assert.equal(await page.locator('article').count(), 1);
    });
    await step('No results remains honest and permits another query', async () => {
      await input.fill('zzzzunmatched');
      await page.getByText('مفيش منتجات أو ماركات مطابقة للبحث ده', { exact: true }).waitFor();
      assert.equal(await page.locator('[role="listbox"] [role="option"]').count(), 0);
      await input.press('Enter'); await page.waitForURL(url => url.searchParams.get('q') === 'zzzzunmatched');
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.waitForFunction(() => !document.querySelector('article'));
    });
    await step('Rapid typing removes the previous query from keyboard navigation', async () => {
      await input.click(); await input.fill('cerave');
      await page.getByRole('option', { name: /CeraVe SA Smoothing Cleanser/ }).waitFor();
      await input.fill('capixy');
      assert.equal(await page.locator('[role="listbox"] [role="option"]').count(), 0);
      await page.getByRole('option', { name: /Capixy Hydrating Conditioner/ }).waitFor();
      assert.equal(await page.getByRole('option', { name: /CeraVe/ }).count(), 0);
    });
    await step('Mobile full-screen search, autofocus, real thumbnails and focus restoration', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const trigger = page.getByRole('button', { name: 'البحث في شينا كير', exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor();
      const mobileInput = dialog.getByRole('combobox');
      await dialog.getByRole('button', { name: 'مسح البحث', exact: true }).click();
      await dialog.getByRole('region', { name: 'آخر بحث في التبويب ده' }).waitFor();
      await dialog.getByRole('button', { name: 'مسح السجل', exact: true }).click();
      assert.equal(await context.pages()[0].evaluate(() => sessionStorage.getItem('shinacare.search.session.v1')), null);
      await mobileInput.fill('cerave');
      await dialog.getByRole('option', { name: /CeraVe SA Smoothing Cleanser/ }).waitFor();
      const box = await dialog.boundingBox(); assert.equal(Math.round(box.width), 390); assert.equal(Math.round(box.height), 844);
      assert.equal(await mobileInput.evaluate(element => document.activeElement === element), true);
      await page.screenshot({ path: path.join(output, 'mobile-390.png') });
      await dialog.getByRole('button', { name: 'إغلاق البحث', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' }); assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
    });
    await step('Mobile network failure shows recovery and removes stale suggestions', async () => {
      await page.getByRole('button', { name: 'البحث في شينا كير', exact: true }).click();
      testingOffline = true;
      await context.setOffline(true);
      await page.getByRole('dialog').getByRole('combobox').fill('networkfailure');
      await page.getByText('حصلت مشكلة في البحث دلوقتي', { exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog').getByRole('option').count(), 0);
      await context.setOffline(false);
      testingOffline = false;
      await page.getByRole('dialog').getByRole('button', { name: 'جرّب تاني', exact: true }).click();
      await page.getByRole('dialog').getByText('مفيش منتجات أو ماركات مطابقة للبحث ده', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'إغلاق البحث', exact: true }).click();
    });
    await step('English search and tablet layout', async () => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await context.addCookies([{ name: 'shena-locale', value: 'en', url: origin }]);
      await page.goto(`${origin}/products?q=cerave`);
      await page.locator('article a[href]').first().waitFor();
      assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
      await page.locator('#site-search-d').fill('cerave cleanser');
      await page.getByRole('option', { name: /CeraVe SA Smoothing Cleanser/ }).waitFor();
      await page.screenshot({ path: path.join(output, 'tablet-768.png') });
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    assert.deepEqual(consoleErrors, []);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, steps, errors, failures, consoleErrors }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: false, steps, errors, failures, consoleErrors, error: error.message }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
