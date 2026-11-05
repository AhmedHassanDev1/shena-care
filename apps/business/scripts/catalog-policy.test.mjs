import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Use the project's existing compiler; no Node TypeScript loader or test dependency required.
const source = readFileSync(new URL('../lib/catalog-policy.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { brandMatches, fold, leafGroups, researchNote, sortBrands } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

const brand = (name, enabled, aliases = []) => ({ id: name, name, slug: name.toLowerCase(), enabled, aliases })
const cat = (id, name, parentId, extra = {}) => ({ id, name, slug: id, parentId, isActive: true, sortOrder: 0, isLeaf: true, ...extra })

test('brand search folds case, punctuation and Arabic letter forms, and sees aliases', () => {
  const b = brand('La Roche-Posay', true, ['لاروش بوزيه'])
  assert.ok(brandMatches(b, 'laroche posay'))
  assert.ok(brandMatches(b, 'لا روش'))
  assert.ok(brandMatches(brand('Eva', true, ['إيفا']), 'ايفا'))
  assert.ok(!brandMatches(b, 'cerave'))
  assert.ok(brandMatches(b, '  '))
  assert.equal(fold('أحمد-ة'), fold('احمدە'.replace('ە', 'ه')))
})

test('enabled brands lead, then name order', () => {
  const sorted = sortBrands([brand('Zed', false), brand('Beta', true), brand('Alpha', true), brand('Able', false)])
  assert.deepEqual(sorted.map(b => b.name), ['Alpha', 'Beta', 'Able', 'Zed'])
})

test('leaf choices are grouped under their top-level category; parents and inactive leaves are never choices', () => {
  const groups = leafGroups([
    cat('skin', 'Skin Care', null, { isLeaf: false, sortOrder: 1 }), cat('wash', 'Cleansers', 'skin', { sortOrder: 2 }), cat('cream', 'Moisturizers', 'skin', { sortOrder: 1 }),
    cat('old', 'Retired', 'skin', { isActive: false }), cat('hair', 'Hair Care', null, { isLeaf: false, sortOrder: 2 }), cat('shampoo', 'Shampoos', 'hair'), cat('misc', 'Gifts', null),
  ])
  assert.deepEqual(groups.map(g => [g.name, g.leaves.map(l => l.name)]), [['Skin Care', ['Moisturizers', 'Cleansers']], ['Hair Care', ['Shampoos']], ['تصنيفات أخرى', ['Gifts']]])
})

test('every research note is explained in words, and unknown site failures stay generic', () => {
  for (const note of ['SEARCH_UNAVAILABLE', 'NO_SITE_FOUND', 'DOMAIN_NOT_BRAND', 'NEEDS_LATIN_NAME', 'LOGO_NOT_FOUND', 'LOGO_UNUSABLE', 'SITE_ROBOTS_DISALLOWED', 'SITE_TIMEOUT']) {
    assert.match(researchNote(note), /[؀-ۿ]/, note)
  }
  assert.match(researchNote('SITE_SOMETHING_NEW'), /[؀-ۿ]/)
})
