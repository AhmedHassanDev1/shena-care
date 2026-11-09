# Supplier / Admin product pipeline: closure (2026-11-07)

Scope: the one product pipeline, used by Admin product lists to fill the catalog (supplier-facing uploads stay frozen, owner decision today). Everything ran on a throwaway local PostgreSQL in the session scratchpad (`127.0.0.1:55531`, fresh `*_test` database per suite). No shared or Supabase database was read or written. No migration was added. Nothing is committed or pushed.

## Owner decisions taken today

| Question | Decision |
|---|---|
| A list row whose brand the catalog does not hold | Create it automatically **only** when its official website is verified (domain = brand name, and the site states the name), from verified fields only, enabled for exactly the leaf categories its rows need. Otherwise one hold. |
| Product line | Automatic, only when the brand's **own** site names it (breadcrumb step that is part of the product name, or an explicit "Collection:/Range:/Line:" label). Marketing words, categories, product types, brand names and navigation are never a line. Otherwise `null`. |
| Supplier-facing uploads | Stay frozen. |

## What changed

| Area | Change |
|---|---|
| Import matching (`admin-catalog-import.service.ts`) | A stated brand that the policy does not know at all, with no close spelling of an allowed brand, is now `HOLD POLICY_BRAND_NEW` (with the leaf resolved from the category cell or the product type) instead of `SKIP BRAND_NOT_IN_ALLOWLIST`. A leaf that no brand brings in yet is also onboarded this way. A misspelling of an allowed brand behaves as before. New `newBrandGroup()` gathers every row of the file waiting on the same brand. |
| Policy (`ingestion-eligibility.policy.ts`) | `leafFor()` settles a row's leaf without a brand, using the same category resolution as `evaluate()`. A denied/inactive branch → SKIP; unknown/ambiguous/parent-only → HOLD. |
| Brand onboarding (`brand-research.service.ts`, `onboardFromImport`) | Reuses Smart Add Brand research and the server-side verified-field save. Looks at a row URL on the brand's own domain first, else the configured search. Creates the brand only with `site.verifiedOfficial` and a VERIFIED name; stores only VERIFIED description/country/parent/aliases/logo (an address country is never stored as origin; no logo published → `logoUrl = null`). Enables the brand for exactly the leaves of its rows in one policy version. Outcomes: `CREATED`, `EXISTS`, `HOLD` (`BRAND_NOT_VERIFIED`, `BRAND_MATCHES_EXISTING`, `BRAND_EXISTS_NOT_ENABLED`), `RETRY` (search/site transiently down). With no search configured and no own-domain URL → immediate hold, never endless retries. The interactive rate limit does not apply to the pipeline. |
| Autopilot (`catalog-autopilot.service.ts`) | Runs onboarding before a `POLICY_BRAND_NEW` row is decided; on success re-matches all that brand's rows of the file and continues the normal pipeline (page verification → SKU intake → research → fact verification → media → profile). On a hold, every row of that brand in the file gets the same answer at once (the site is researched once, not once per row). Audit: `BRAND_AUTO_ONBOARDED` on the brand, `BRAND_NOT_ONBOARDED` on rows. |
| New schema facts (`product-fact-extractor.ts`) | `attributes.spf`, `attributes.broadSpectrum`, `attributes.waterResistanceMinutes`, `attributes.uvFilterType`, `attributes.nonComedogenic`, `merchandising.productLine`. SPF from the title, else the product's own description/sections (not short page tiles); several values → unknown. Broad spectrum, water resistance and filter type only for a product that states an SPF; filter type from the single INCI list (mineral / organic / both); TiO₂ in a non-SPF product is a colourant. Non-comedogenic only when stated; silence is unknown, never `false`. |
| Decision rules / write-through | SPF disagreement between trusted sources is a critical exception. Retailer-only → stays unknown (existing rule). Each value is written through Catalog with its provenance in `claimsEvidence`; an existing different value is never overwritten. Product line is written only from a brand-site page (`LINE_NEEDS_BRAND_SITE` otherwise). |
| Catalog owner (`catalog-intake.service.ts`) | `assignProductLine()`: one line per brand and folded name (advisory lock), created with description/image empty; a product already in a different line is refused, never moved. |

## Schema field map: where each catalog value comes from, and what "unknown" is

| Model.field | Filled from | When not stated |
|---|---|---|
| Brand.name / slug | Official site's own name (VERIFIED) | brand not created → hold |
| Brand.websiteUrl | Verified official site | brand not created |
| Brand.description / countryOfOrigin | Official site, VERIFIED only (country from founding location, never an address) | `null` |
| Brand.logoUrl / logoMetadata | Official site logo, validated and re-encoded PNG | `null` |
| Brand.profile | Rebuilt from verified SKUs + research (never claimed complete) | partial, labelled |
| ProductLine.name / brandId / slug | Brand's own page (breadcrumb in name, or explicit label) | product `productLineId = null` |
| ProductLine.description / imageUrl | not researched | `null` |
| Category | Never created; leaf chosen by the Catalog Policy (cell → parent+type → type) | hold `CATEGORY_UNKNOWN` |
| Product.name | Row name, normalised | row rejected without a name |
| Product.description | Trusted page description (medical wording rejected) | `null` |
| Product.usage / ProductUsageRule | Instruction sentences only (not marketing under "How to use") | `null` / `UNKNOWN` enums |
| Product.warnings / ProductSafetyWarning | Manufacturer/trusted warnings, accumulated | `null` / none |
| Product.targetArea / texture | Product title | `null` |
| Product.suitableSkinTypes / suitableHairTypes | Stated suitability lines | `[]` |
| Product.spf / broadSpectrum / uvFilterType / waterResistanceMinutes | **New**: stated on the page (see above) | `null` |
| Product.isNonComedogenic | **New**: stated claim | `null` |
| Product.isFragranceFree | INCI (outranks a claim) or stated claim | `null` |
| Product.concerns | **Not automated** on purpose: care-taxonomy slugs drive routine eligibility, a merchandising decision, not a page fact | `[]` |
| Product.productType / subtype / classification | Rule-derived from the name/category, labelled RULE_DERIVED | `null` |
| Product.isPublished | Never by the pipeline | `false` |
| Sku.code | `IMP-` + hash(brand, name key, size): the same product can only ever get one code | n/a |
| Sku.size / sizeUnit | Row, confirmed by the page title/text | hold `SIZE_NOT_CONFIRMED` |
| Sku.barcode / barcodeStatus | Only the manufacturer's structured data → VERIFIED; a row barcode is a claim and is not written | `null` / `UNKNOWN` |
| Sku.hasOuterCarton | Owner decision per SKU | `null` |
| Sku.estimatedDaysOfUse | never stated by sources | `null` |
| ProductIngredient | Single INCI list → reviewed ingredients; concentration only when stated | none / `UNKNOWN` |
| MediaAsset / ProductMedia | Authentic manufacturer/trusted image ≥ 400 px; clean derivative; never generated identity images | missing → publication blocker, not invented |
| Commerce (listing, price, offer, stock) | **Never** by an import | — |

## No-duplicate guarantees (each one tested)

1. Same file uploaded again → same job (`reused: true`), nothing redone.
2. Same product twice in one file (any spelling/case) → one candidate, the repeat links to it (`DUPLICATE_OF_ROW` → `AUTO_LINK`).
3. Against the catalog: exact identity, the same verified page, pipeline provenance or a verified barcode link; name and size alone never link.
4. SKU code is a hash of the identity key, so a race resolves to the same SKU; the same brand+name+size under another record → `IDENTITY_UNCONFIRMED` hold, never a second SKU.
5. Brand: name and approved aliases checked (folded) before creation; an official name that is already held → `BRAND_MATCHES_EXISTING` hold.
6. Product line: one per brand and folded name, under a lock.

## Tests (local scratch PostgreSQL, one fresh DB per suite)

- New `test/unit/supplier-pipeline-closure.spec.ts`: **16/16** (line from breadcrumb/label; category, type, brand, marketing never a line; two readings unknown; SPF/broad spectrum/water/filter type; no SPF → all unknown; two SPFs → unknown; TiO₂ colourant; non-comedogenic stated vs silence; SPF conflict critical; retailer-only SPF unknown; `leafFor` incl. denied branch, unknown type, parent-only).
- New `test/integration/supplier-pipeline-closure.e2e-spec.ts` (real HTTP, real DB, recorded pages, search stubbed): **2/2**. A 6-row file: new brand Lumora verified on its own site → created (website, description, country Egypt, **no logo** because none is published), enabled for exactly Shampoos + Sunscreens; 2 SKUs AUTO_ACCEPT; the capitals repeat AUTO_LINK to the same SKU; Silk Repair line created and linked; sunscreen SPF 50 / broad spectrum / 80 min / HYBRID / non-comedogenic with evidence; shampoo has no sun claims; 0 barcode, 0 commerce, 0 published. Nomara (no site) and Velora (only a shop site) → `BRAND_NOT_VERIFIED`, not created, Nomara searched **once** for two rows, 3 open exceptions. Second file: lowercase spelling links, a conditioner row skips through the policy, no new SKU/line/brand; re-uploading the first file is the same job and changes nothing.
- All unit + architecture suites: **742/742** (46 suites).
- Related integration suites, each alone on a fresh DB: admin-catalog-import 7/7, catalog-autopilot 12/12, brand-research 12/12, brand-product-line 14/14, catalog-publication 6/6, glo-121 2/2, glo285-matching 31/31, glo285-identity-safety 53/53, glo285-research-resilience 7/7, glo285-candidate-review 11/11, ingestion-eligibility 13/13, real-products-catalog-import 1/1, media-editorial 6/6, procurement-closure 9/9, supplier-ingestion-readback 2/2.
- Updated to today's decision (unknown brands are held, not skipped): catalog-autopilot (Zorblax), catalog-closure rows 13 (Eva) and 14 (NotOnAllowlistDemo).
- Failing, not caused by this work:
  - `catalog-closure` "Admin profile API…": asserts `profile.portfolio`, but the brand profile is now `brand-profile@2` with `inShinaCare` (untracked `catalog-profile.service.ts`, another session's work; not touched here).
  - `catalog-policy` 1 test (expects `POLICY_BRAND_UNKNOWN`, gets the spelling hold) and `sg06` 1 test (`resolveProductLine` needs a brand id): both listed as failing identically at HEAD in the 2026-11-06 closure report.
- Typecheck clean. Lint clean on every changed file except one pre-existing error at HEAD (`brand-research.service.ts` `_png`).

## Open points for the owner

1. **A later file with another category for an auto-created brand is skipped** by the Catalog Policy (the brand was added for the leaves of the file that created it). Widen it on the Catalog Policy page, or ask for "auto-added brands may gain leaves from later files".
2. Unknown brands are now **exceptions instead of silent skips**: junk or test brands in a file will show up in the exception queue.
3. An Arabic-only brand name cannot be verified (no Latin name to match a domain): it is held with "English name needed".
4. A brand that is in the catalog but disabled in the policy is held (`BRAND_EXISTS_NOT_ENABLED`), never re-enabled automatically.
5. Finding a site needs the search key (`EXA_API_KEY`) in that environment; without it, only rows that give a URL on the brand's own domain can onboard a brand.
6. `concerns` stays empty by design; tell me if you want it mapped from stated "for acne-prone skin" claims to care-taxonomy slugs (this would affect routine recommendations).
7. Supplier-facing uploads are still frozen; when unfrozen they use the same identity and policy engine, but supplier rows never create brands.
8. Not applied anywhere shared: migration `20261106170000_catalog_profiles` (and earlier pending ones) still need your approval for Supabase. Today's work needs no migration.
