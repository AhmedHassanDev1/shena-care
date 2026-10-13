# GLO-183 product detail contract

No Linear specification was supplied. The contract extends the existing product composition without frontend changes.

`GET /products/:slugOrId` and `GET /products/:slugOrId/detail` return the same additive detail representation. Both accept optional `?skuId=<uuid>`. Missing/incomplete/unpublished products and foreign/ineligible selected variants return 404; malformed or unknown query fields return 400. They use the same gates as discovery; unreviewed sibling variants cannot leak through another variant's media approval.

- Canonical Product ID/slug, brand, category, product line; eligible SKU ID/code/barcode/exact size/unit/variant.
- Exact-SKU approved media with public URL and origin; no raw review metadata or ingestion enrichment.
- Independent current Commerce price, currency and compare-at amount; no supplier cost/identity.
- Per-SKU availability, freshness, confirmedAt, observedAt and validUntil. Default confirmation window is 24 hours, configurable as documented in GLO-182. Missing/stale stock cannot make a detail publicly sellable.
- `verifiedFacts` contains reviewed identity facts (barcode, size, sizeUnit, variantName), source URL/type and verification timestamp, limited to visible SKUs. Reviewer/customer identities are withheld.
- `selectedSkuId` and `selectedVariant` identify the selection. Every eligible SKU now has its own media, identity facts, Arabic content and automatic order-promotion preview. Without a selection, the first eligible SKU in stable ID order is selected. Shared canonical Product/Brand/Category/ProductLine data remain product-level.
- `content` is nullable and contains only fields recorded through authorized human Arabic content review, backed by stored source evidence and the exact barcode/size/unit/variant. Fields are `name`, `description`, `ingredients`, `usage`, `warnings`, plus public source facts. Missing fields stay null. Content verification describes the selected variant; unavailable content does not block factual publication.
- Legacy Catalog description/usage/warnings have no review provenance and are withheld from public catalog projections. PDP top-level description/usage/warnings mirror the selected variant's reviewed content. AI suggestions never populate new canonical product descriptions. Provider SUPPORTED suggestions alone do not constitute published content approval.
- `price` remains the current Commerce SellingPrice. `promotions` is an explicitly scoped `single_item_order_preview` using Commerce's existing automatic order-discount evaluator. It excludes coupon codes, shipping benefits and unsupported item-targeting rules. `requiresCheckoutConfirmation` is true; the preview never replaces SellingPrice or promises delivery/policy terms. Checkout confirms final basket eligibility.
- `routinePlacements` contains only manual/expert recommendations from active template routines. Private/customer routines, inactive templates and AI/rule-engine recommendations are excluded. No customer profile is queried or exposed. Empty array means no public placement exists.

The detail describes current orderability; it does not reserve stock or certify media licensing/supplier authenticity from a database flag. Real pilot acceptance requires external evidence and explicit business approvals. The October 13 read-only audit found no published candidates or published media review receipts in the currently configured database; the earlier pilot ID in historical repository evidence was absent there.

PostgreSQL HTTP verification covers exact identity/media, price versus procurement cost, stock freshness, source-backed identity facts, Arabic content review, private/generated routine exclusion, missing placement, incomplete states, selected-SKU switching, and identity edits invalidating reviewed media. Swagger declares both selection and the nested public detail response.

The source/review path is documented in [PDP backend readiness report](pdp-backend-readiness-report.md). No schema migration or frontend change accompanies this contract.
