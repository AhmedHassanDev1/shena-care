import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Use the project's existing compiler; no Node TypeScript loader or test dependency required.
const source = readFileSync(new URL('../lib/ingestion-policy.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { createDraft, policyChanges, previewRequest, categoryGroup } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

const brand = { id: 'b', name: 'CeraVe', isActive: true, effect: 'ALLOW', aliases: ['سيرافي'] }
const skin = { id: 'skin', name: 'Skincare', slug: 'skincare', parentId: null, isActive: true, effect: 'DENY', aliases: [] }
const leaf = { id: 'wash', name: 'Facial Cleansers', parentId: 'skin', isActive: true, effect: 'ALLOW', aliases: ['غسول'] }
const mapping = { supplierId: 's', label: 'غسول بشرة', categoryIds: ['wash'] }
const current = { id: 'p', version: 7, document: { brands: [brand], categories: [skin, leaf], mappings: [mapping] } }
const options = { brands: [brand, { ...brand, id: 'other', name: 'Other', aliases: [] }], categories: [skin, leaf], suppliers: [] }

test('a loaded policy is clean; cancelling or reverting a toggle returns to clean', () => {
  const draft = createDraft(current, options)
  assert.equal(policyChanges(current, draft).length, 0)
  draft.brands[0].effect = null
  assert.equal(policyChanges(current, draft).length, 1)
  draft.brands[0].effect = 'ALLOW'
  assert.equal(policyChanges(current, draft).length, 0)
  assert.equal(current.document.brands[0].effect, 'ALLOW')
})
test('one mixed preview preserves parent DENY, aliases, category rules and mappings', () => {
  const draft = createDraft(current, options)
  draft.brands[0].effect = null
  draft.brands[0].aliases.push('سرافي')
  const request = previewRequest(current, draft, 'سبب مراجعة صحيح')
  assert.equal(request.path, '/ingestion/eligibility/preview')
  assert.equal(request.body.expectedVersion, 7)
  assert.deepEqual(request.body.brands[0], { id: 'b', effect: null, aliases: ['سيرافي', 'سرافي'] })
  assert.equal(request.body.categories[0].effect, 'DENY')
  assert.deepEqual(request.body.mappings, [mapping])
  assert.deepEqual(current.document.brands[0].aliases, ['سيرافي'])
})
test('name-only drafts use the existing mapping-only endpoint with no rule fields', () => {
  const draft = createDraft(current, options)
  draft.brands[0].aliases.push('سرافي')
  const request = previewRequest(current, draft, 'مراجعة اسم متكرر')
  assert.equal(request.path, '/ingestion/eligibility/mappings/preview')
  assert.equal('effect' in request.body.brands[0], false)
  assert.deepEqual(request.body.mappings, [mapping])
})
test('removing a brand and mapping is visible in review and survives payload construction', () => {
  const draft = createDraft(current, options)
  draft.brands[0].effect = null
  draft.mappings = []
  const changes = policyChanges(current, draft)
  assert.equal(changes.length, 2)
  assert.ok(changes.some(c => c.kind === 'mapping' && c.after === 'إزالة الربط'))
  assert.deepEqual(previewRequest(current, draft, 'تعطيل وربط').body.mappings, [])
})
test('whitespace and alias order alone do not create a draft', () => {
  const draft = createDraft(current, options)
  draft.brands[0].aliases = ['  سيرافي ', '']
  assert.equal(policyChanges(current, draft).length, 0)
})
test('new canonical brand plus alias uses full preview; missing policy starts at version zero', () => {
  const draft = createDraft(null, options)
  draft.brands[1].effect = 'ALLOW'
  draft.brands[1].aliases = ['اسم جديد']
  const request = previewRequest(null, draft, 'اعتماد مبدئي')
  assert.equal(request.path, '/ingestion/eligibility/preview')
  assert.equal(request.body.expectedVersion, 0)
  assert.equal(request.body.brands.find(b => b.id === 'other').effect, 'ALLOW')
})
test('display groups follow real ancestors; unfamiliar taxonomy stays unclassified', () => {
  assert.equal(categoryGroup(leaf, [skin, leaf]), 'البشرة')
  const hair = { ...skin, id: 'hair', name: 'العناية بالشعر', slug: 'haircare', effect: null }
  assert.equal(categoryGroup({ ...leaf, parentId: 'hair' }, [hair]), 'الشعر')
  assert.equal(categoryGroup({ ...leaf, name: 'Unfamiliar', parentId: null }, []), 'تصنيفات أخرى')
  assert.equal(categoryGroup({ ...leaf, id: 'loop', name: 'Unfamiliar', parentId: 'loop' }, [{ ...leaf, id: 'loop', name: 'Unfamiliar', parentId: 'loop' }]), 'تصنيفات أخرى')
})
