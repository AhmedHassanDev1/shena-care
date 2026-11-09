# Catalog pipeline closure: category, identity, Brand/SKU enrichment, routine intelligence (2026-11-06)

Everything here ran on an isolated local PostgreSQL (scratch cluster `127.0.0.1:55511`, `*_test` databases dropped and recreated per run), seeded from the committed Policy v14 snapshot. The API ran from the working tree on `:3073` with local file storage, no Cloudinary, and no AI or discovery keys (`EXA_API_KEY` blank). Live manufacturer and distributor pages were read. No shared or production database was read or written. Nothing was published and nothing was pushed or committed.

## 1. Root causes of the 15-row result

The owner's file (`Desktop/ShinaCare_Catalog_Autopilot_Test_15.csv`, copied here as `test-15.csv`) has a `category` column, but it is **empty on every row**.

| # | Root cause | Effect |
|---|---|---|
| 1 | The Catalog Policy resolved a category only from an exact label in the category cell (`ingestion-eligibility.policy.ts`). An empty or non-taxonomy cell gave `CATEGORY_UNKNOWN`, which became a HOLD. The product name was never read for its type, even when it plainly said "Shampoo" or "شامبو". | 9 of 15 rows held on `POLICY_CATEGORY_UNKNOWN` locally. On the owner's database it was more, because there was less pipeline provenance. |
| 2 | The canonical brand ("clary" → "Clary Corporation") was used for matching only when the *whole* policy outcome was ALLOW. A row held for its category was matched under its raw label, so known products came back `NO_MATCH` (fingerprint `v1:clary:…` vs `v1:clary-corporation:…`). | Rows that are existing verified SKUs could not reach the "use the SKU's own category" path. Some would also have attempted a duplicate. |
| 3 | `normalizeBarcode` accepted `0000000000000`, because it passes the GTIN check digit. | A placeholder became a "valid" barcode claim. |
| 4 | Page identity compared paths literally, so `/collections/buy-one-get-one/products/x` ≠ `/products/x` on the same storefront. | The same verified page was not recognised. |
| 5 | Found during verification: the fact extractor took any line under a "How to use" heading that contained "use" or "daily" as an instruction. CeraVe's pages put marketing copy there ("A hydrating and soothing facial cleansing lotion…", "this daily foaming cleanser…"). | Marketing text was applied as VERIFIED usage, and the SA cleanser got a VERIFIED "daily" frequency taken from marketing copy. |

## 2. What changed

| Area | Change |
|---|---|
| Product type (`ingestion/services/product-type.ts`, new) | A deterministic Arabic (MSA and Egyptian colloquial) and English vocabulary for shampoo, conditioner, leave-in, hair mask/oil/serum/styling, makeup remover, cleanser (foaming/gel/cream/oil/balm subtypes), body wash, toner, serum, sunscreen, eye care, exfoliant, face mask, moisturiser, body moisturiser and lip care. The longest phrase wins ("hair mask" is not also a face "mask"). Generic words (cream, lotion, mask, oil, wash, SPF) count only when nothing more precise was said, and take their area from the name. Two different types are reported, never chosen between. |
| Policy (`ingestion-eligibility.policy.ts`) | `evaluate(…, productName)` settles the leaf in this order: a category cell that names one leaf; otherwise a cell naming a parent, narrowed by the product type inside that parent; otherwise the product type alone. The type → leaf mapping uses the taxonomy's own names and aliases, so nothing is keyed by id, and it is domain-checked (hair never maps to skin). It never authorises a child through its parent. A stated leaf that the name contradicts → `CATEGORY_CONFLICTS_PRODUCT_TYPE`. Several readings (e.g. a 2-in-1) → `CATEGORY_AMBIGUOUS`. When every reading is a definite exclusion, the row is SKIP with no person involved. A type with no approved leaf → early SKIP (`PRODUCT_TYPE_NOT_IN_TAXONOMY`). Each decision carries `category: { basis, rule: product-type@1, stated, productType, productSubtype, candidates }`. Without a product name the old exact-label semantics are unchanged (the frozen supplier path is untouched). New `brandOf()` resolves names and approved aliases only, never spelling guesses. |
| Import matching (`admin-catalog-import.service.ts`) | The canonical brand and brand id are used for matching whatever the category outcome. A row that resolves to an existing SKU is then judged by that SKU's verified category. The category resolution is stored on every row (`identity.policy.category`). **New link rule:** the row names the verified identity page of *exactly one* SKU of that brand, with the exact same size and no contradicting type, area, active or target in the wording. The page, not the name, is the evidence. This links Arabic-named rows. It also links a misspelt brand (≥ 0.5 suggestion score) only when the row points at that brand's already verified page; with no URL, the misspelling still holds. CONFLICT/INVALID identities are never overridden. |
| New sizes (`catalog-autopilot.service.ts`) | A new size with no URL is checked against the pages that verified a sibling size. The page must state **this exact size**; otherwise the row holds `NO_IDENTITY_SOURCE` (a sibling page is never treated as a contradiction). The verified page is kept on the row, so research reads the same page. |
| Barcode / URL | All-same-digit barcodes are invalid. Storefront `/collections/<x>/products/<h>` is treated as `/products/<h>`. |
| Extractor (`product-fact-extractor.ts`) | A direction counts only if a sentence of it instructs: it opens with an imperative ("Apply", "Use 1–2 times…", "Leave on…", "Rinse") or names an application act; Arabic imperatives are covered. Descriptions under "How to use" are dropped. The routine builder re-applies the same rule to already-applied text, so old bad data yields no rinse mode, period or frequency, and the Admin view shows it as `APPLIED_TEXT_IS_A_DESCRIPTION_NOT_AN_INSTRUCTION`. |
| Persistence (migration `20261106170000_catalog_profiles`, additive) | `catalog.brands.profile`, `profile_updated_at`; `catalog.products.product_type`, `product_subtype`, `classification`; new table `catalog.sku_routine_profiles` (typed columns plus a status for every field). Tested on disposable databases; `prisma migrate diff` shows no drift on the new objects. **Not applied to any shared database.** |
| Routine intelligence (`ingestion/services/routine-profile.ts`, new, pure) | Deterministic type → role and step order: SKIN = makeup remover 1, cleanser 2, exfoliant 3, toner 4, face mask 5, serum 6, eye 7, moisturiser 8, sunscreen 9; HAIR = shampoo (`HAIR_WASH`) 1, conditioner 2, hair mask 3, leave-in 4, hair treatment 5, styling 6; BODY = wash 1, moisturiser 2. Secondary roles only when justified: `TREATMENT` for a leave-on skin product whose functional active is featured or has a stated strength; `SUNSCREEN` for a moisturiser with a verified SPF. **VERIFIED** (manufacturer instructions, INCI, warnings, stated concentrations): rinse mode, AM/PM, cadence, contact time, actives and featured ingredients confirmed in the INCI, warnings (patch-test and contraindication classified only from the manufacturer's own text). **RULE_DERIVED**: role, step order, prerequisites, "sunscreen last in the morning", retinoid-at-night eligibility, ingredient-class sun-sensitivity and layering guidance (`requiresReview`). **UNKNOWN** by default: frequency, period and concentration are never filled in from the type. **CONFLICT**: sources disagree, or the instructions contradict the type (e.g. a rinse-off mask that says "Do not rinse"). The second opens one critical exception, `APPLICATION_MODE_CONTRADICTS_PRODUCT_TYPE`. A named ingredient missing from the verified INCI is flagged. |
| Brand profile (`composition/services/catalog-profile.service.ts`, new) | Identity fields with status (canonical name, approved aliases, website, country, logo with provenance; manufacturer and parent company stay UNKNOWN because they were not researched). The portfolio (domains, leaf categories, product types, lines) is derived only from **verified SKUs in this catalog** and marked `exhaustive: false`. Source links are flagged official or other. Rebuilt after each accepted product. |
| APIs | Admin: `GET /catalog/workbench/skus/:id/profile` (identity, classification, composition, usage, routine, safety, media, sources, field coverage with reasons, publication blockers, open exceptions); `POST …/skus/:id/profile/rebuild`; `POST …/profiles/rebuild`; `GET …/brands/:id/profile`. Consumers (Routine Builder, Recommendation Engine, Ask Shina): `GET /catalog/skus/:id/routine-profile`, `GET /catalog/routine-profiles?skuIds=` — **live products only**, otherwise 404 or omitted. |
| Admin UI (`apps/business …/catalog/workbench/profile-panel.tsx`) | "ملف المنتج الكامل" inside the existing SKU workspace, with no new navigation: summary counts; collapsible groups for identity and verification, classification (with how the category was settled), ingredients and actives, usage and routine (manufacturer value and system rule shown separately), warnings, media quality, sources, field coverage with the reason each gap is unknown, and publication blockers; plus the brand profile. Every field carries a status label in words. |
| Fixture | `brand-research.e2e-spec` "Arabic-only name": the second test now builds its own Arabic name (the first test had already made the identical name a Brand alias). |

## 3. The 15-row file, before and after (same local database state: the original 10 verified first)

| Row | Before | After |
|---|---|---|
| Clary Hair Shampoo (barcode 6224008073666) | HOLD `POLICY_CATEGORY_UNKNOWN` | **AUTO_LINK** (type shampoo → Shampoos; the barcode stays a claim) |
| Clary Hair Mask (collection URL) | HOLD `POLICY_CATEGORY_UNKNOWN` | **AUTO_LINK** |
| Capixy Hair Hydrating Conditioner | AUTO_LINK | AUTO_LINK |
| Capixy Hair Mask | HOLD `POLICY_CATEGORY_UNKNOWN` | **SKIP** `CATEGORY_NOT_ALLOWED_FOR_BRAND` (Capixy is allowed Shampoos and Conditioners only) |
| CeraVe Foaming Cleanser 236 ml | AUTO_LINK | AUTO_LINK |
| CeraVe Hydrating Cleanser 236 ml | AUTO_LINK | AUTO_LINK |
| CeraVe Moisturising Cream 340 g | HOLD `POLICY_CATEGORY_UNKNOWN` | **AUTO_ACCEPT** (new SKU; the official page states "Sizes available: 340g, 454g") |
| CeraVe Foaming Cleanser 473 ml | HOLD `POLICY_CATEGORY_UNKNOWN` | **AUTO_ACCEPT** (official page: "88ml, 236 ml, 473 ml") |
| CeraVe Cleanser 236 ml (no URL) | HOLD `POLICY_CATEGORY_UNKNOWN` | HOLD `COMPETING_IDENTITIES`: three 236 ml CeraVe cleansers compete; **genuine** |
| CeraVe Hydrating Cleanser 473 ml (no URL) | HOLD `POLICY_CATEGORY_UNKNOWN` | **AUTO_ACCEPT** (sibling's verified official page states 473 ml) |
| Capixxy … Conditioner (URL = verified page) | HOLD `BRAND_SPELLING_UNCONFIRMED` | **AUTO_LINK** `SAME_VERIFIED_SOURCE_PAGE_BRAND_CORRECTED` |
| CeraVe Shampoo | HOLD `POLICY_CATEGORY_UNKNOWN` | **SKIP** `CATEGORY_NOT_ALLOWED_FOR_BRAND` |
| Eva Hyaluronic Serum | SKIP | SKIP (`CATEGORY_NOT_ALLOWED`) |
| Unlisted Demo Face Cream | SKIP | SKIP |
| كلاري شامبو شعر (barcode 0000000000000) | HOLD `POLICY_CATEGORY_UNKNOWN` | **AUTO_LINK** `SAME_VERIFIED_SOURCE_PAGE`; the placeholder barcode is now invalid |
| **Totals** | 0 accept · 3 link · 2 skip · **10 hold** (owner's DB: 0 · 0 · 2 · 13) | **3 accept · 7 link · 4 skip · 1 hold** |

`POLICY_CATEGORY_UNKNOWN` is eliminated for this file. Database after the final clean run: 13 SKUs, **0 barcodes written, 0 barcode VERIFIED, 0 listings, 0 prices, 0 supplier offers, 0 published products, 0 published media**, 13 routine profiles, 3 brand profiles. The only open exception is the genuine `COMPETING_IDENTITIES` row.

## 4. Field coverage of the 10 original SKUs (final run; `coverage.md` / `coverage.json`)

V = VERIFIED (source and URL kept per field), U = UNKNOWN (reason: `NOT_STATED_ON_SOURCES_READ`, i.e. the pages read do not state it), R = rule-derived.

| SKU | INCI | conc. | fragr. | texture | usage | AM/PM | skin | hair | warn. | descr. | role (R) | rinse | cadence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CeraVe Hydrating Cleanser 236 ml | V | U | V | U | U | U | V | U | U | V | CLEANSER #2 | U | U |
| CeraVe Foaming Cleanser 236 ml | V | U | V | U | U | U | V | U | U | V | CLEANSER #2 | U | U |
| CeraVe SA Smoothing Cleanser 236 ml | V | U | V | U | U | U | V | U | U | V | CLEANSER #2 | U | U |
| CeraVe Moisturising Cream 454 g | V | U | V | V | U | U | V | U | U | V | MOISTURIZER #8 | U | U |
| CeraVe Moisturising Lotion 236 ml | V | U | V | V | U | U | V | U | U | V | MOISTURIZER #8 | U | U |
| Clary Hair Shampoo 300 ml | U | U | U | U | V | U | U | V | U | V | HAIR_WASH #1 | V rinse-off | U |
| Clary Hair Conditioner 300 ml | U | U | U | U | V | U | U | V | U | V | CONDITIONER #2 | V rinse-off | U |
| Clary Hair Mask 300 ml | U | U | U | U | V | U | U | V | U | V | HAIR_MASK #3 | V rinse-off | V 1–2/week |
| Capixy Shampoo 250 ml | V | U | V | U | V | U | U | U | V | U | HAIR_WASH #1 | V rinse-off | U |
| Capixy Hair Hydrating Conditioner 250 ml | U | U | V | U | V | U | U | U | U | V | CONDITIONER #2 | V rinse-off | U |

All ten: identity `EVIDENCE_VERIFIED` (africa.cerave.com, eparkville.com, e-majestic.com), barcode `UNKNOWN` (no manufacturer GTIN on the pages), size VERIFIED, 0 CONFLICT. CeraVe usage is now honestly UNKNOWN: the official pages carry marketing text under "How to use", not steps. No concentrations are stated on any source. No manufacturer warnings were found on the Clary or CeraVe pages read.

## 5. Media and publication (unchanged, honest)

- Approved originals: Clary ×3 and Capixy ×2 (1024–1080 px), CeraVe Cream (400×450).
- Editorial approved automatically: Clary Shampoo, Clary Conditioner, Capixy Conditioner.
- Editorial rejected with reason: Clary Mask `LOW_EDGE_CONTRAST`, Capixy Shampoo `ENCLOSED_BACKGROUND`, CeraVe Cream `UPSCALED_SMALL_SOURCE`.
- CeraVe Hydrating, Foaming, SA and Lotion have no original: the official images are under 400 px and are never upscaled. Shown as `PRIMARY_PACKSHOT_NOT_APPROVED` with no invented asset.
- Publication blockers are legitimate and not bypassed: approved price and listing, carton decision, and the missing packshots above.

## 6. Tests (local scratch PostgreSQL)

- New unit specs: `catalog-category-resolution.spec` (35 tests: Arabic/colloquial/English types, leaf resolution, parent narrowing, conflict, ambiguity, early skip, legacy semantics, `brandOf`, placeholder barcode, collection URL); `routine-profile.spec` (13 tests: cleanser, serum, moisturiser, sunscreen, exfoliant, shampoo, conditioner and hair mask, two conflicting-use cases, marketing-as-usage, named-but-absent ingredient, warnings, unknown type, routine ordering).
- All unit suites: 696 passed before the two additions; extractor, decision engine and usage-rule suites re-run after the extractor change: 58/58.
- New integration spec `catalog-closure.e2e-spec` (real HTTP, real PostgreSQL, recorded pages through the real fetcher and extractor): **5/5**. It covers: the 15-row file shape; no category hold; links and new sizes; skips; the single genuine hold; barcode never VERIFIED; exactly +3 SKUs; commerce unchanged; same-file and copy re-import idempotent with applied facts unchanged; the profile API (classification, routine, coverage, brand profile `exhaustive:false`, explicit missing media, unpublished SKUs hidden from consumers); and a rinse-off/leave-on conflict opening one critical exception.
- `brand-research.e2e-spec`: **12/12** (was 11/12). `catalog-autopilot.e2e-spec`: **12/12**. `admin-catalog-import.e2e-spec`: **7/7**. Architecture boundaries: **7/7**.
- Full API suite (169 suites, one shared fresh DB): 145 suites passed. The scratch server briefly refused connections mid-run, and suites leak rows into each other in a shared DB, so every failed suite was then re-run **alone on its own fresh DB**, and the same list on a copy of **HEAD**:
  - 16 suites fail **identically at HEAD** (same failed/passed counts), so they are pre-existing and not touched by this work: g04, g05, g07, g08, g09, g10, glo-77, glo-120, glo285-publication-journey, ingestion-lifecycle, ingestion-eligibility-operational (supplier path), catalog-policy (1 test: expects `POLICY_BRAND_UNKNOWN`, gets the spelling hold), product-discovery, product-readiness, supplier-workflow-engagement, sg06.
  - Regressions found and fixed: (a) a sibling size's page that does not state the size was reported `SOURCE_CONTRADICTS_IDENTITY`; it is now `NO_IDENTITY_SOURCE`. (b) `admin-catalog-import` rows "Kerrin Toner" and "Plain Moisturiser" now resolve to a product type with no leaf in that spec's synthetic taxonomy, so they are an early SKIP, which is intended. Their names were made type-neutral so they still test the malformed barcode and the missing brand. (c) The new consumer controller now imports a public contract, as the boundary test requires.
  - Fixed: brand-research (HEAD 11/12 → 12/12).
- Typecheck: API and Business clean. Lint: every changed file is clean, except 12 errors in `row-normalization.service.ts` that are identical at HEAD (pre-existing).
- Visual: Catalog Workbench → Clary Hair Mask → "ملف المنتج الكامل" rendered RTL with status labels and no console errors.

## 7. Remaining, honestly

- **Not proven for the whole catalog**: verified on 13 SKUs from 3 brands plus adversarial fixtures. The product-type vocabulary is bounded; a name it cannot read stays `CATEGORY_UNKNOWN` (a hold), by design.
- **Brand research coverage**: manufacturer, parent company and country stay UNKNOWN unless the Smart Add Brand research recorded them. No discovery key was used in this run.
- **Data already in a shared database** (if migrations are applied there): usage text applied earlier from marketing copy remains in `products.usage`. It no longer feeds routine metadata and is flagged in the Admin view, but a refresh with better sources, or a reviewed rejection, is needed to clear it from the storefront text.
- **Owner decisions**: apply migration `20261106170000_catalog_profiles` (and the earlier three) to a shared DB; trusted host entries for eparkville.com and e-majestic.com in each environment.
