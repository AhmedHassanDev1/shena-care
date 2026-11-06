# Policy v14 real 10-product ingestion test — 2026-11-06

## Scope and environment

- Branch `main`, baseline HEAD `e2a1360530d4a39adc6d64fd77cfb81cebb00550`. The working tree already contained unrelated changes, including `apps/web`; they were preserved. No commit, push, merge, or product publication was made.
- All test writes used disposable PostgreSQL `shina_real10_test` at `127.0.0.1:55432` with both datasource URLs pinned there. The approved Policy v14, canonical brands, and categories were read from the configured source database and copied into this local test database; the source database was not written.
- Development supplier `Real 10 Development Test Supplier` ID `7c7aa038-7375-4773-8125-faf550a7a382` was seeded for test context. No supplier offer, stock quantity, purchase price, or selling price was created.
- The supplier file route `/ingestion/jobs/upload` requires supplier SKU, name, and purchase price mapping (and quantity for stock feeds) and is intentionally guarded by `SupplierFileIntakeFrozenGuard` in `BROADCAST_ON_DEMAND`. Supplying invented commercial fields would be invalid. The supported Admin catalog-list route `/admin/catalog-imports` accepts `name,brand,size,barcode,category,url`, creates review rows only, and was used through `apps/business` UI.

## Files and UI evidence

- Import: [policy-v14-corrected.csv](./policy-v14-corrected.csv), 10 rows, all barcode cells empty.
- Separate negative cases: [negative-gates.csv](./negative-gates.csv).
- Actual Admin upload: [admin-ui-upload.png](./admin-ui-upload.png); initial receipt `NEW_CANDIDATE=10`, job `a1f80035-76a5-48ae-a968-bb4f5ed16b99`.
- Admin re-import and final links: [admin-ui-reimport-linked.png](./admin-ui-reimport-linked.png), [admin-ui-final-linked.png](./admin-ui-final-linked.png). UI stated the file had already been uploaded and displayed its previous result. Same job ID, ten `LINKED_EXISTING`, ten products in DB.
- Negative gate UI: [negative-gates-ui.png](./negative-gates-ui.png), job `4219ce6b-cc50-4959-b18b-be258dda1376`.
- Clary original and SAHEL review: [clary-original-review.png](./clary-original-review.png), [clary-sahel-review.png](./clary-sahel-review.png).
- Read-only local DB snapshot with fact, asset, source URL, and policy provenance: [local-results.json](./local-results.json).

## Research corrections and unresolved identity evidence

- The Africa CeraVe official pages state **236 ml** for the four cleansers/lotion in this file and **454 g** for Moisturising Cream. The earlier report mixed the US 237 ml variant with Africa 236 ml. Foaming Cleanser was explicitly corrected to 236 ml. [Hydrating](https://africa.cerave.com/en/our-products/cleansers/hydrating-cleanser), [Foaming](https://africa.cerave.com/en/our-products/cleansers/foaming-cleanser), [SA Smoothing](https://africa.cerave.com/en/our-products/cleansers/sa-smoothing-cleanser), [Cream](https://africa.cerave.com/en/our-products/moisturizers/moisturising-cream), [Lotion](https://africa.cerave.com/en/our-products/moisturizers/moisturising-lotion).
- Parkville's [Clary Shampoo 300 ml](https://eparkville.com/products/clary-hair-shampoo-300ml) page lists SKU `6224008073666`, conflicting with the prior report's claimed barcode `6223012633286`. A merchant SKU is not proof of a GTIN; the barcode remains empty. Clary's canonical Policy v14 Brand ID is `fe79ae65-d2f1-4835-9248-38d69676fc72` and its approved alias is `clary`. [Conditioner](https://eparkville.com/products/clary-hair-conditioner-300ml), [Mask](https://eparkville.com/products/clary-hair-mask-300ml).
- The earlier Capixy shampoo URL did not resolve. The working [manufacturer product page](https://e-majestic.com/products/capixy-shampoo-250ml) titles it **Capixy Shampoo 250ml**; “anti-hair-loss” is descriptive copy, not a separate verified variant name. [Conditioner](https://e-majestic.com/products/capixy-hair-hydrating-conditioner-250ml).
- All ten source pages returned HTTP 200. Their page-declared image URLs returned HTTP 200 with JPEG/PNG content types; exact URLs and extracted dimensions are retained in `local-results.json`. The CeraVe Hydrating, Foaming, SA, and Lotion image bytes were each below the 400 px minimum on at least one edge. No URL was upscaled or substituted to pass validation.
- The configured discovery key is named `EXA_API_KEY`, as supplied by the owner. Direct official-page research produced evidence for all ten, so paid Exa discovery was not needed in this test.
- No barcode for any of the ten was confirmed by manufacturer packaging or trustworthy structured evidence. All ten import cells and persisted SKU barcodes remain null. The Clary barcode conflict is unresolved.

## Results for all ten

All rows followed parsing → Policy v14 allowlist → conservative matching → Admin identity link → canonical intake → official-page research → fact review → DB persistence → media processing/review → publication readiness check. Initial matching gave 10 `NEW_CANDIDATE`; after SKU creation, recheck conservatively put 10 on `AMBIGUOUS_IDENTITY` HOLD; an Admin linked each exact brand/name/size to its canonical SKU through the guarded UI action. All ten research runs completed and the stated size fact is `APPLIED` for every SKU. Six additional reviewed facts wrote `targetArea` or `texture` through Catalog services.

| Product | Product ID | SKU ID | Media status | Final readiness |
|---|---|---|---|---|
| CeraVe Hydrating Cleanser 236ml | `87c77d9e-28e3-4804-a086-eb67d75a1811` | `b485d6d9-dd25-432d-8a9a-a98334485777` | Source image rejected: under 400 px; no asset | HOLD |
| CeraVe Foaming Cleanser 236ml | `a078403e-1e81-4f37-a253-2fb40e4340bb` | `60e6df87-3ea0-43b5-9c0d-f48e48e66140` | Source image rejected: under 400 px; no asset | HOLD |
| CeraVe SA Smoothing Cleanser 236ml | `2cf1ea55-fac7-4104-8036-f0be163d6fb9` | `7d046b45-70a2-4f8c-bb9e-190e02826001` | Source image rejected: under 400 px; no asset | HOLD |
| CeraVe Moisturising Cream 454g | `eb5f9e8c-3f37-44bf-8e5e-e26422130237` | `c35b8c7c-7814-46b6-bac1-236559abf76b` | Original `60ac7ddd-4476-4d21-a7c6-bd8e1fb7a706` and SAHEL `45d29483-e11a-480d-a2b6-442cec9f78e2` processed/approved; small-source/upscale warning acknowledged; unpublished | HOLD |
| CeraVe Moisturising Lotion 236ml | `9fe87bdc-8dc2-4dd5-8926-dcca7d7f667b` | `92653b7f-b712-42a1-8f8f-a7fe9a1fa403` | Source image rejected: under 400 px; no asset | HOLD |
| Clary Hair Shampoo 300ml | `db6e148e-e547-4c3f-a810-5c9be4e83494` | `fc5b95d6-a0ac-4d45-b1c0-58bf5edeb6c4` | Original `758dd036-1e5c-418b-8199-05fca201110f` and SAHEL `fdfc965d-3df5-43b1-9682-cbe1352b21a1` processed/approved; unpublished | HOLD |
| Clary Hair Conditioner 300ml | `84e036ea-c53a-46ca-9465-72f1f3738fad` | `e71a4e50-b98d-4814-800d-ffa2170ae894` | Original `d07d284b-8fc0-4879-8296-cb148a8aaafc` approved; SAHEL `2725dfec-ef44-44a8-a5ff-373c140f55ed` REJECTED for ghost silhouette | HOLD |
| Clary Hair Mask 300ml | `5dbfbb1e-d22a-4c6e-968a-1157ea1948a7` | `a846a1cb-ed16-40f1-a938-2e4391ab3d22` | Original `72fa72b6-3c2c-4368-8c6b-29b6586f8916` and SAHEL `4c0bd9e3-5a98-4b95-bccf-32f4c18a8558` processed/approved; unpublished | HOLD |
| Capixy Shampoo 250ml | `19a5c725-a7d3-484b-af82-8ea660a17b7a` | `8365dac2-23ba-4ba8-b053-137e52fc478e` | Original `5b5b63e9-f3ff-46fe-afc4-d2e485aa9e7a` and SAHEL `2b34a50a-111b-4bbd-8b61-ed3b089d8757` processed/approved; unpublished | HOLD |
| Capixy Hair Hydrating Conditioner 250ml | `7c76e86b-3416-4a75-af00-a3ecc4818b85` | `c33d89ec-6caa-4e3d-9fb3-a0ce49af80fd` | Original `4e2b2052-92fd-4b52-8854-92735795b651` approved; SAHEL `b9b2a9c2-9305-42da-af99-889336006a34` REJECTED for detached cap/duplicate shadow | HOLD |

SAHEL template `sahel-soft-plinth` v1 (`2c31fc87-2737-4a83-92d1-888ad3fbed3c`) was registered through Admin UI from the repository's real `.webp` and rules JSON. Six originals and six derivatives processed with `SUCCEEDED`; six originals approved, four derivatives approved, two derivatives rejected. Zero media assets published. The media publication attempt on Clary Shampoo was refused by the verified-identity requirement because barcode evidence is absent.

### Counts

| Gate | ACCEPT | HOLD | SKIP | FAILED |
|---|---:|---:|---:|---:|
| Ten-product import, after Admin review | 10 linked and persisted | 0 open import rows | 0 | 0 |
| Ten-product publication readiness | 0 ready | 10 blocked | 0 | 0 |
| Separate negative file | 0 | 1 ambiguous identity | 2 policy rejections | 0 |

The separate negative rows are pinned to Policy v14: Eva Cosmetics `POLICY_BRAND_NOT_ALLOWED` → REJECTED/SKIP, CeraVe Shampoo `POLICY_CATEGORY_NOT_ALLOWED_FOR_BRAND` → REJECTED/SKIP, and generic CeraVe Cleanser 236ml `AMBIGUOUS_IDENTITY` → HOLD. None created a product.

## Defects, fixes, tests, and blockers

1. `apps/business` intake displayed only root categories despite the API returning leaf children. Fixed the form's category options to use the API's leaf children. Live UI showed seven Policy v14 leaf choices; Business TypeScript typecheck exited 0.
2. Research rejected official Clary pages because the canonical name “Clary Corporation” was absent while Policy v14 explicitly approves alias `clary`. Research now loads the current approved policy alias for that Brand ID and the extractor accepts it while still rejecting an unrelated brand. Red focused test reproduced the failure; green test passed. The real Clary Shampoo run changed from `IDENTITY_MISMATCH`/0 facts to `COMPLETE`/9 facts.
3. The initial local Node process lacked the Windows system CA, causing research TLS failures. Restarting with `node --use-system-ca` restored verified TLS. Site `robots.txt` and host checks stayed active. The verified Parkville/Majestic hosts were configured for this local test in `RESEARCH_ALLOWED_HOSTS` and `MEDIA_TRUSTED_SOURCE_HOSTS`.
4. The approved media template produced two visibly damaged derivatives. They were rejected at the media review gate and not published. Improving shadow removal safely requires a targeted compositor regression with these source images; the gate prevented damaged publication. Four official CeraVe images failed the minimum source resolution gate. Higher-resolution authentic sources remain to be found.
5. Focused API unit tests: 3 suites, 86/86 passed. Focused Business tests: 11/11 passed. Business TypeScript typecheck exited 0. API Nest build exited 0. All ten research runs `COMPLETE`; local DB readback shows 10 products, 10 linked import rows, 0 supplier offers, 0 listings, 0 published products, and 0 published media.

Publication remains blocked by ten unverified barcodes, no approved selling prices or active listings, no outer-carton decisions, and no published primary packshots. These gates were not bypassed. The four low-resolution CeraVe packshots and two rejected derivatives add media work. The supplier ingestion route remains frozen and there were no real supplier commercial values to ingest.
