import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(
  new URL('../app/(workspace)/admin/catalog/catalog-helpers.ts', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const {
  resolveCatalogMediaUrl,
  readinessIssueLabel,
  policyReasonLabel,
  flattenCategories,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`
)

test('resolveCatalogMediaUrl prefixes API-relative storage paths and preserves external CDN URLs', () => {
  assert.equal(
    resolveCatalogMediaUrl('/storage/public/media/packshot.webp', 'http://localhost:3001/'),
    'http://localhost:3001/storage/public/media/packshot.webp',
  )
  assert.equal(
    resolveCatalogMediaUrl('https://res.cloudinary.com/demo/image/upload/v1/p.png'),
    'https://res.cloudinary.com/demo/image/upload/v1/p.png',
  )
  assert.equal(resolveCatalogMediaUrl(''), null)
  assert.equal(resolveCatalogMediaUrl(null), null)
})

test('readinessIssueLabel and policyReasonLabel map backend codes to clear Arabic copy', () => {
  assert.match(readinessIssueLabel('PRIMARY_PACKSHOT_MISSING'), /[\u0600-\u06FF]/)
  assert.match(readinessIssueLabel('SELLING_PRICE_MISSING'), /[\u0600-\u06FF]/)
  assert.match(policyReasonLabel('OUT_OF_SCOPE_MEDICINE'), /الأدوية/)
  assert.match(policyReasonLabel('BRAND_NOT_IN_ALLOWLIST'), /قائمة السماح/)
})

test('flattenCategories keeps root parents followed by their nested subcategories', () => {
  const flat = flattenCategories([
    {
      id: 'root-1',
      name: 'العناية بالبشرة',
      slug: 'skincare',
      description: null,
      parentId: null,
      sortOrder: 1,
      isActive: true,
      directProductCount: 2,
      totalProductCount: 5,
      children: [
        {
          id: 'child-1',
          name: 'الغسول',
          slug: 'cleansers',
          description: null,
          parentId: 'root-1',
          sortOrder: 1,
          isActive: true,
          directProductCount: 3,
        },
      ],
    },
  ])
  assert.deepEqual(
    flat.map((c) => [c.id, c.parentName]),
    [
      ['root-1', null],
      ['child-1', 'العناية بالبشرة'],
    ],
  )
})
