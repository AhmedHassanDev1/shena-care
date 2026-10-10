# GLO-183 product detail contract

No Linear specification was supplied. The contract extends the existing product composition without frontend changes.

`GET /products/:slugOrId` and `GET /products/:slugOrId/detail` return the same additive detail representation. Missing/incomplete/unpublished products return 404. They use the same gates as discovery; unreviewed sibling variants cannot leak through another variant's media approval.

- Canonical Product ID/slug, brand, category, product line; eligible SKU ID/code/barcode/exact size/unit/variant.
- Exact-SKU approved media with public URL and origin; no raw review metadata or ingestion enrichment.
- Independent current Commerce price, currency and compare-at amount; no supplier cost/identity.
- Per-SKU availability, freshness, confirmedAt, observedAt and validUntil. Default confirmation window is 24 hours, configurable as documented in GLO-182. Missing/stale stock cannot make a detail publicly sellable.
- `verifiedFacts` contains reviewed identity facts (barcode, size, sizeUnit, variantName), source URL/type and verification timestamp, limited to visible SKUs. Reviewer/customer identities are withheld.
- `factVerification.content = "unavailable"`: the existing schema has no human-approved structured clinical/content facts. Descriptions/usage/warnings remain existing catalog content, not certified facts. Provider SUPPORTED suggestions and raw scraped ingredients are never relabeled verified. Genuine content review remains a business blocker.
- `routinePlacements` contains only manual/expert recommendations from active template routines. Private/customer routines, inactive templates and AI/rule-engine recommendations are excluded. No customer profile is queried or exposed. Empty array means no public placement exists.

The detail describes current orderability; it does not reserve stock or certify media licensing/supplier authenticity from a database flag. The 12-item real pilot remains hidden until external evidence and explicit business approvals are recorded.

PostgreSQL HTTP verification covers exact identity/media, price versus procurement cost, stock freshness, source-backed identity facts, content-review absence, private/generated routine exclusion, missing placement, all incomplete states, and identity edits invalidating reviewed media.
