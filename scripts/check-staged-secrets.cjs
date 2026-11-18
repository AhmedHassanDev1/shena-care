#!/usr/bin/env node
/*
 * Refuses to let live-looking credentials into a commit. Scans the staged files (or the files named as arguments) for
 *   - a session/bearer token assigned from a UUID literal (`adminToken = '…'`, `Authorization: Bearer <uuid>`),
 *   - a database URL carrying a password, an `sk-…` API key, or a long JWT-like string.
 * It prints the file and line only, never the value. Run `npm run check:secrets` before committing, or wire it as a pre-commit hook:
 *   echo 'node scripts/check-staged-secrets.cjs' > .git/hooks/pre-commit
 * Known public development defaults (e.g. the dev-only label secret) are not matched.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RULES = [
  ['session token literal', new RegExp(`\\b\\w*token\\w*\\s*[:=]\\s*['"\`]${UUID}['"\`]`, 'i')],
  ['bearer token literal', new RegExp(`Bearer\\s+${UUID}`, 'i')],
  ['database URL with password', /postgres(?:ql)?:\/\/[^\s'":@/]+:[^\s'"@]{4,}@(?!127\.0\.0\.1|localhost)/i],
  ['API key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['JWT-like string', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
];
const SKIP = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|pdf|lock)$/i;

const files = process.argv.length > 2
  ? process.argv.slice(2)
  : execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' }).split('\n').filter(Boolean);

let problems = 0;
for (const file of files) {
  if (SKIP.test(file) || !fs.existsSync(file)) continue;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  if (text.length > 2_000_000) continue;
  text.split('\n').forEach((line, index) => {
    for (const [label, rule] of RULES) {
      if (rule.test(line)) { console.error(`SECRET? ${label} in ${file}:${index + 1}`); problems++; break; }
    }
  });
}
if (problems) {
  console.error(`\n${problems} possible credential(s) found. Remove them (load from the environment) before committing.`);
  process.exit(1);
}
console.log(`no credentials found in ${files.length} file(s)`);
