# Live run: owner's 33-row list (2026-11-07)

**Where:** local throwaway PostgreSQL (`live_catalog_test`), seeded read-only from Supabase with the 9 categories, 8 brands and Catalog Policy v18, and **no products** (the "old products deleted" state). Supabase was only read, inside read-only sessions. **Web:** real. Exa search with the `.env` key, real brand sites through the safe fetcher (robots, size, host rules). AI was stubbed. No trusted distributor hosts were configured (`RESEARCH_ALLOWED_HOSTS` is empty in `.env`), so only a brand's own site counts as a source.

Files: `result.json` (final run: rows, brands, products, facts, exceptions, decisions, every search query), `result-run1..3.json` (earlier runs), `seed/` (what was copied), `live-catalog-run.e2e-spec.ts` (the runner).

## Result (final run, 0.9 min, 31 searches)

**0 products created · 1 brand created (Dermactive) · 5 skipped by policy · 28 held, each with its reason · 0 invented values.**

| Brand | Rows | Outcome | Why | What unlocks it |
|---|---|---|---|---|
| StarVille | 4 | SKIP `CATEGORY_NOT_ALLOWED_FOR_BRAND` | Policy v18 enables StarVille with **zero** allowed categories | Owner: give StarVille its leaves (Cleansers, Moisturizers…) |
| StarVille | 1 | HOLD `CATEGORY_UNKNOWN` | "Acne Prone Skin **Gel**": a bare "gel" names no type | Add a category cell |
| Shaan | 3 | HOLD `NO_IDENTITY_SOURCE` | Shaan has no website on record; search found only retailers/distributors (beauty-911, eparkville, kayanek, Jumia…), none approved | Owner: Shaan's official site, or approve a distributor (eparkville.com) |
| Shaan | 1 | HOLD `CATEGORY_UNKNOWN` | "Soothing Gel": no type | Category cell |
| Shaan | 1 | HOLD `MISSING_NET_CONTENT` | "Dry S Cream" has no size; retailers show 100 g but none is a trusted source | Size in the file, or trusted source |
| Bobai | 3 | HOLD `BRAND_NOT_VERIFIED` | Search finds parkvillepharma.com (the owner company) and shops; no site whose domain is "bobai" | Owner: accept the owner company's site for its brands, or give the official site |
| Dermactive | 9 | Brand **created** (derm-active.com verified; site states no description/country/logo, so those are empty); rows HOLD `MISSING_NET_CONTENT` | Product pages found on derm-active.com, but their titles state no size and the page body lists several (150/200/30/50 ml, mostly other products) | Sizes in the file |
| Eva Skin Clinic | 7 | HOLD `BRAND_MATCHES_EXISTING` | Found on eva-cosmetics.com, the website of the existing brand **Eva Cosmetics** → suggested correction "Use Eva Cosmetics" (Skin Clinic is its line) | Owner: confirm, and **enable Eva Cosmetics** (it is disabled in policy v18) |
| Eva Skin Clinic | 1 | SKIP `PRODUCT_TYPE_NOT_IN_TAXONOMY` | "Collagen Toner": the taxonomy has no Toners leaf | Add a Toners leaf if wanted |
| CeraVe | 3 | HOLD `MISSING_NET_CONTENT` | The rows have no size; cerave.com pages verify the product but list several sizes | Sizes in the file |

## Fixed during this run (found on the real pages)

| Problem seen | Fix |
|---|---|
| Rows without a link could never be verified | Product-page discovery: Exa search inside the brand's own site first, then anywhere; only the brand site / approved distributors are read, never retailers. A wrong search hit is not a contradiction (`decideFromFoundPages`). |
| Size written in the name ("… 200 ml") was not stored on the row | Taken from the name when the file has no size column. |
| Row without any size | The size is taken from a trusted page only when that page's own title states exactly one size (`sizeFromFoundPages`); otherwise it stays unknown. |
| derm-active.com has no `og:site_name`/JSON-LD, so its name was not read | The homepage `<title>` leading segment is a name source (still VERIFIED only when it matches the brand). |
| "SPF50+ …", "Foaming Gel", "Day Gel", "Hydra-Mattifying Gel" had no product type | `SPF50` read as `SPF 50`; added foaming gel (cleanser), day/night/mattifying gel (moisturiser); SPF beats a bare texture word ("SPF50+ Melting Cream" = sunscreen). Bare "gel"/"soothing gel" still unknown. |
| "Eva Skin Clinic" on eva-cosmetics.com held as an unknown brand | When the site found is an existing brand's website, the hold names that brand and offers the correction (never applied automatically). |
| When a brand site was down, each of its 9 rows re-ran the search (18 queries) | The whole brand group waits for one retry; a scheduled retry is not reprocessed early. |

Tests after the fixes: unit + architecture **754/754**; integration (fresh DB each): supplier-pipeline-closure 3/3, catalog-autopilot 12/12, admin-catalog-import 7/7, brand-research 12/12, catalog-closure 4/5 and catalog-policy 5/6 (the same two failures that existed before today, not related).

## Owner decisions that would turn most holds into products

1. Give **StarVille** its allowed categories (it has none).
2. **Eva Skin Clinic = Eva Cosmetics** (line Skin Clinic): confirm, and enable Eva Cosmetics in the policy with its leaves.
3. Parkville-owned brands (Bobai, StarVille, maybe Shaan): accept **parkvillepharma.com / eparkville.com** as a trusted source (pending since 2026-11-06), or give each brand's own site.
4. **Sizes**: Dermactive and CeraVe rows need a size in the file (the official pages list several sizes, so the pipeline will not pick one).
5. Optional: a **Toners** leaf for "Collagen Toner".

Supabase is untouched: its 10 old products are still there, and migration `20261106170000_catalog_profiles` is still not applied there (required before this pipeline can run on Supabase).

---

# Run with the owner's decisions applied ("Apply all", 2026-11-07)

Applied on the local database only, through the app's own services (Supabase untouched):
- StarVille: enabled for Cleansers + Moisturizers (it had none).
- Eva Cosmetics: enabled, approved alias **"Eva Skin Clinic"**, leaves Serums & Treatments + Cleansers + Moisturizers.
- Bobai: added by Admin action as a Parkville brand (website `parkvillepharma.com/brand/bobai`, recorded **ADMIN_ENTERED**, not VERIFIED), leaf Sunscreens.
- Trusted distributors for this run: `eparkville.com, parkvillepharma.com, parkville.com.eg` (distributor tier, never "official").
- **Not applied: sizes for Dermactive and CeraVe** — they are not in the list and the official pages state several sizes; choosing one would be inventing.

## Final result (`result-final.json`, fresh DB, 2.1 min)

**12 products accepted automatically · 1 skipped · 20 held with their reason · 0 retries · 0 published · 6 official barcodes VERIFIED · 13 SKUs, 13 unique codes, no duplicates.**

| Brand | Accepted | Held / skipped (reason) |
|---|---|---|
| Eva (Skin Clinic) | **7/8**: both serums, Vitamin C serum, Facial Wash, Day Gel, Night Cream, Micellar Water, verified on shop.eva-cosmetics.com (the brand's own shop); 6 with the official GTIN from that page | Collagen Toner: no Toners leaf (skip) |
| StarVille | Whitening Cleanser, Acne Prone Skin Cream | Acne Cleanser: `USAGE_INSTRUCTIONS_CONTRADICT` (distributor page mixes a lotion's instructions with the cleanser's, and carries a lotion description); Facial Cleanser Hydro: no size; Acne Prone Skin Gel: no product type |
| Shaan | Antioxidant Facial Cleanser, Rejuvenation Cream | Soothing Gel: no type; Oily Matte Cream-Gel: no page states it; Dry S Cream: no size |
| Bobai | Oil Defense Fluid SPF 50 (SPF 50, broad spectrum) | Extra Lightening Gel and Tinted: no page found that is unambiguously that exact variant |
| Dermactive | — | 9 rows need sizes |
| CeraVe | — | 3 rows need sizes |

What was filled: identity (page + evidence), size, category leaf, product type, description (distributor/brand text; medical wording rejected), usage instructions where stated, texture, target area, stated skin types, SPF/broad spectrum where stated, official barcode where the brand's page publishes it. Left empty because no source states it: INCI (none of these pages publish a full list), warnings, product line (no page names "Skin Clinic" as a line). Images were found and stored but stay **PENDING_REVIEW**: these hosts are not on `MEDIA_TRUSTED_SOURCE_HOSTS`.

## Bugs found on the real pages during this run, all fixed and tested

| Found | Fix |
|---|---|
| **Wrong identity**: "Bobai *Tinted*" was verified by the *non-tinted* page (half the words matched) | Variant words (tinted/ملون, day, night, men, kids, refill) and the SPF number must agree between row and page, in both directions |
| Eva shop titles say "30 **Ml**": size not read | Units in any letter case (Ml, GM, Gr, ملل, غ) |
| A PDF brochure from search opened eva-cosmetics.com's circuit breaker (all its pages then failed) | Discovery never queues PDF/image/office links |
| "Massage until fully absorbed" not seen as leave-on, so a cleanser with a lotion's instructions was accepted | "until (fully) absorbed" = leave-on; mixed with "rinse" it is a contradiction → hold |
| "Acne Treatment Cream… target acne" published as a description | Acne-treatment wording is a medical claim → rejected |
| Several Product entries on one page: the first was used | Only the entry the page's heading names; none matching → no structured facts |

Tests: unit + architecture **760/760**; integration (fresh DB each) all pass except the same pre-existing `catalog-closure` profile test (`portfolio` vs `brand-profile@2`, not touched here).

## Still the owner's
1. Sizes for the 9 Dermactive and 3 CeraVe rows (and StarVille "Facial Cleanser Hydro", Shaan "Dry S Cream").
2. A category for "Soothing Gel" and "Acne Prone Skin Gel" (the name does not say what they are).
3. Add the image hosts (shop.eva-cosmetics.com, eparkville.com, shop.parkvillepharma.com) to `MEDIA_TRUSTED_SOURCE_HOSTS` if their images may be approved automatically.
4. To make these decisions real: the same policy changes on Supabase, `RESEARCH_ALLOWED_HOSTS` there, and migration `20261106170000` applied there first (each needs your approval).

---

# Closure (2026-11-08): local pipeline, MVP-10 candidates, Supabase readiness

Commit `55bb8a5` on branch `feat/supplier-pipeline-closure` (36 files; `main` untouched; not pushed). Supabase was not touched.

## Accepted products (13 on the local DB; 12 originally + CICA Cream)
Eva Cosmetics ×7 (Hyaluronic Acid Facial Serum, Niacinamide Serum, Vitamin C Serum, HA Facial Wash, HA Day Gel, HA Night Cream, HA Micellar Water), Dermactive ACTI-REPAIR CICA Cream, Bobai Oil Defense Fluid SPF 50, Shaan Rejuvenation Cream, Shaan Antioxidant Facial Cleanser, StarVille Whitening Cleanser, StarVille Acne Prone Skin Cream. All identity EVIDENCE_VERIFIED, none published, no commerce data.

## Done today
- **Sizes:** nothing invented. Only the Dermactive CICA Cream page states a single size (50 ML); applied as a documented Admin correction and re-verified by the pipeline (AUTO_ACCEPT, 36 INCI ingredients). Other Dermactive pages print the product's size first and related products' sizes after it, which is a layout guess, so those 8 stay on HOLD (and CeraVe ×3 and StarVille "Facial Cleanser Hydro" / Shaan "Dry S Cream", whose pages list several sizes or could not be read: eparkville rate-limits).
- **Review of the accepted products** found and fixed: `dry` taken as a skin type from "Apply to clean, dry skin" (3 products; extractor fixed + data corrected), a lotion description on the held StarVille cleanser (cleared), double-encoded `&amp;` in the CICA description (extractor fixed + data corrected). All six Eva barcodes are valid GTIN-13.
- **Brand Profile failure:** a stale test, not a bug. The service (`brand-profile@2`) and the Admin UI use `inShinaCare` / `range`; the test still asserted the old `portfolio`. Test updated (catalog-closure 5/5).

## Tests
Unit + architecture 762/762. 17 of 18 relevant integration suites pass (fresh DB each); `catalog-policy` 1 test fails exactly as before this work (expects `POLICY_BRAND_UNKNOWN`, gets the spelling hold). Typecheck clean (API, Business). Lint: no new errors (15 pre-existing in `row-normalization`, `brand-research` `_png`, one `any` in `catalog.service`).

## MVP first 10 (ready to be published once commerce data exists)
Eva ×6 with official GTIN (Hyaluronic Acid Facial Serum, Niacinamide Serum, HA Night Cream, HA Day Gel, HA Facial Wash, HA Micellar Water), Dermactive CICA Cream, Bobai Oil Defense Fluid SPF 50, Shaan Rejuvenation Cream, StarVille Whitening Cleanser. Reserve: Eva Vitamin C Serum (no GTIN), StarVille Acne Prone Skin Cream. **Not ready: Shaan Antioxidant Facial Cleanser** — the page title says Antioxidant but the body describes a "Gentle Hydrating Cleanser" (hyaluronic acid), so the description/skin type may belong to another product; needs a person.

## Missing critical data (all 13)
Approved price and listing; carton decision; approved product image (all images stored but PENDING_REVIEW because the hosts are not in `MEDIA_TRUSTED_SOURCE_HOSTS`); INCI for 12 of 13 (no page publishes it); usage for the 6 Eva products and CICA; GTIN for the 7 non-Eva products except none; product line "Skin Clinic" for Eva (no page names it as a line).

## Remaining blockers before Supabase
1. Migration `20261106170000_catalog_profiles` is not applied there (the pipeline needs it; owner approval).
2. The policy decisions are only local: StarVille leaves, Eva Cosmetics enabled + alias "Eva Skin Clinic", Bobai brand, trusted distributors (`RESEARCH_ALLOWED_HOSTS`: eparkville.com, parkvillepharma.com, parkville.com.eg) and `EXA_API_KEY` in that environment.
3. Supabase still holds 10 old products with 5 order items and 2 purchase-order lines; removing them needs an explicit decision and a backup first.
4. Image trust decision, and the sizes/categories listed above.
5. `main` does not have this code yet (branch `feat/supplier-pipeline-closure`; uncommitted `apps/web` storefront changes are unrelated).

## Update 2026-11-08: migration applied to Supabase
`20261106170000_catalog_profiles` is now applied on Supabase (owner confirmed). Additive only; existing data fingerprint unchanged; details in `output/supabase-migration-2026-11-08/README.md`. Blocker 1 above is closed. Still open for Supabase: the policy decisions and trusted hosts there, `EXA_API_KEY`, the 10 old products, image trust, and the held sizes/categories.
