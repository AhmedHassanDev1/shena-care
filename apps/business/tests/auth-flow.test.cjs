const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (mod, file) =>
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    file,
  );
const { safeNextPath, workspacePrefixes } = require('../lib/auth/safe-redirect.ts');
const { nationalDigits, isCompleteEgyptianMobile, formatNational, toInternational } = require('../lib/auth/phone.ts');
const { emailLoginMessage, otpVerifyOutcome, phoneSendMessage } = require('../lib/auth/messages.ts');
const { NotAuthorizedError } = require('../lib/auth/errors.ts');
const { ApiError } = require('../lib/api.ts');

test('safeNextPath keeps only in-app paths inside a workspace the roles may use', () => {
  assert.equal(safeNextPath('/admin/orders?status=placed', ['ADMIN']), '/admin/orders?status=placed');
  assert.equal(safeNextPath('/hub/pack', ['HUB_OPERATOR']), '/hub/pack');
  assert.equal(safeNextPath('/hub/pack', ['ADMIN']), '/hub/pack'); // admins may use hub screens (RoleShell)
  assert.equal(safeNextPath('/driver', ['DRIVER']), '/driver');
});

test('safeNextPath refuses other roles, absolute URLs and tricks', () => {
  const bad = [
    'https://evil.example/admin',
    '//evil.example/admin',
    '/' + String.fromCharCode(92) + 'evil.example',
    '/admin' + String.fromCharCode(92) + '..' + String.fromCharCode(92) + 'evil',
    'javascript:alert(1)',
    '/login',
    '/admin/../login',
    '/adminx',
    '/admin\n/evil',
    '',
    null,
    undefined,
    '/' + 'a'.repeat(600),
  ];
  for (const next of bad) assert.equal(safeNextPath(next, ['ADMIN']), null, String(next));
  assert.equal(safeNextPath('/admin', ['DRIVER']), null);
  assert.equal(safeNextPath('/supplier/po/1', ['DRIVER']), null);
  assert.equal(safeNextPath('/admin', ['CUSTOMER']), null);
  assert.deepEqual(workspacePrefixes(['CUSTOMER']), []);
});

test('encoded newlines cannot escape: the path stays a plain in-app path', () => {
  const out = safeNextPath('/admin%0d%0aSet-Cookie:a=b', ['ADMIN']);
  assert.ok(out === null || (out.startsWith('/admin') && !/[\r\n]/.test(out)));
});

test('phone helpers normalise what people type', () => {
  assert.equal(nationalDigits('0101 234 5678'), '1012345678');
  assert.equal(nationalDigits('+20 101 234 5678'), '1012345678');
  assert.equal(nationalDigits('٠١٠١٢٣٤٥٦٧٨'), '1012345678');
  assert.equal(formatNational('01012345678'), '010 1234 5678');
  assert.equal(toInternational('010 1234 5678'), '+201012345678');
  assert.equal(isCompleteEgyptianMobile('010 1234 5678'), true);
  assert.equal(isCompleteEgyptianMobile('010 1234'), false);
  assert.equal(isCompleteEgyptianMobile('013 1234 5678'), false);
});

test('sign-in copy is generic and never exposes roles or account existence', () => {
  const wrong = emailLoginMessage(new ApiError('Invalid credentials', 401));
  assert.match(wrong, /غير صحيحة/);
  assert.equal(emailLoginMessage(new ApiError('x', 401, 'ANY')), wrong);
  assert.match(emailLoginMessage(new ApiError('x', 429)), /محاولات كثيرة/);
  assert.match(emailLoginMessage(new ApiError('x', 0, 'NETWORK')), /الاتصال/);
  assert.match(emailLoginMessage(new NotAuthorizedError()), /لا يمكن الدخول/);
  for (const text of [wrong, emailLoginMessage(new NotAuthorizedError())]) assert.doesNotMatch(text, /ADMIN|HUB|SUPPLIER|DRIVER|مدير|مورد|مندوب/);
});

test('code outcomes map to distinct, honest feedback', () => {
  const invalid = otpVerifyOutcome(new ApiError('x', 401, 'OTP_INVALID', { attemptsRemaining: 2 }));
  assert.equal(invalid.kind, 'invalid');
  assert.equal(invalid.attemptsRemaining, 2);
  assert.match(invalid.message, /2/);
  assert.equal(otpVerifyOutcome(new ApiError('x', 401, 'OTP_EXPIRED')).kind, 'expired');
  assert.equal(otpVerifyOutcome(new ApiError('x', 401, 'OTP_LOCKED')).kind, 'locked');
  assert.equal(otpVerifyOutcome(new ApiError('x', 429, 'RATE_LIMITED')).kind, 'other');
  assert.equal(otpVerifyOutcome(new Error('boom')).kind, 'other');
  assert.match(phoneSendMessage(new ApiError('x', 503, 'OTP_UNAVAILABLE')), /غير متاح/);
  assert.match(phoneSendMessage(new ApiError('x', 429, 'OTP_RATE_LIMITED', { retryAfterSeconds: 1800 })), /30 دقيقة/);
});

/* ── Contrast: the sign-in palette (components/auth/auth.css) ─────────────── */
const css = fs.readFileSync(require('node:path').join(__dirname, '../components/auth/auth.css'), 'utf8');
const color = Object.fromEntries([...css.matchAll(/--bwa-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => (Math.max(lum(color[a]), lum(color[b])) + 0.05) / (Math.min(lum(color[a]), lum(color[b])) + 0.05);

test('sign-in text pairs reach 4.5:1', () => {
  const pairs = [
    ['text', 'canvas'], ['text', 'surface'], ['text', 'elevated'],
    ['text-2', 'surface'], ['text-2', 'elevated'], ['text-2', 'canvas'],
    ['placeholder', 'elevated'], ['link', 'surface'], ['link', 'canvas'],
    ['on-primary', 'primary'], ['on-primary', 'primary-hover'],
    ['ok', 'ok-soft'], ['danger', 'danger-soft'], ['warn', 'warn-soft'],
    ['danger', 'surface'], ['primary', 'surface'],
  ];
  for (const [fg, bg] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
});

test('sign-in field borders and focus reach 3:1', () => {
  for (const [fg, bg] of [['field-border', 'elevated'], ['field-border', 'surface'], ['focus', 'surface'], ['focus', 'elevated'], ['primary', 'elevated']]) {
    assert.ok(ratio(fg, bg) >= 3, `${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
  }
});
