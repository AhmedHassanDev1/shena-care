# Product Pipeline MVP verification

Verified genuine sellable products: **0 / 12**. No supplier, image, fact, availability, or selling-price evidence was invented.

Pilot job: `b191d313-c2e1-476b-814d-83221c49e748`. Snapshot: 2026-10-10T07:56:00.801Z. Earlier partial attempts were inspected; the existing batch was not recreated.

Ten existing canonical products had 8-byte signature-only PNGs labelled verified, no human review receipt, no canonical size, no SellingPrice, and no confirmed availability. They are now unpublished, and their unconfirmed demo offers are unavailable. The two remaining candidates have no canonical Product/SKU. Candidate history and stored source evidence were preserved.

Every row below has **no verified Product Facts, no SellingPrice, no confirmed supplier availability, and no customer visibility**. Extracted sizes and provider SUPPORTED labels are unreviewed suggestions; they are not verified facts.

| Supplier code / brand / product | Product ID | Canonical SKU ID / code | Size: canonical / extracted suggestion | Stored source evidence | Real media / supplier state |
|---|---|---|---|---|---|
| AVE-5001 · Avene · Avene Thermal Spring Water | 1ee35726-e02d-4e9e-b5af-dee253de2b33 | c07d7277-72fa-4614-bb7c-a757cac9593f<br>AVE-5001 | missing / 1 g | [stored source 1](https://www.avene.co.uk/p/avene-thermal-spring-water-spray-3282779003124-b5405ca4) | 8-byte mock PNG; offer disabled/unconfirmed |
| AVE-5002 · Avene · Avene Cicalfate+ Cream | a131f5b2-3723-4ad8-a914-dba9758f71a3 | b401e76b-5f67-44aa-9140-d4ccd6bd6e34<br>AVE-5002 | missing / 40 ml | [stored source 1](https://www.aveneusa.com/cicalfateplus-restorative-protective-cream-40ml) | 8-byte mock PNG; offer disabled/unconfirmed |
| BDR-6001 · Bioderma · Bioderma Sensibio H2O Micellar Water | none | none<br>none | missing / missing | none (internal fallback only) | no media; no offer |
| BDR-6002 · Bioderma · Bioderma Atoderm Intensive Baume | 7f6e7c8f-c9f6-41a6-a1a0-c706a3247729 | b2f383b6-ba36-4d29-bf0e-5f5450c1d0ca<br>BDR-6002 | missing / missing | [stored source 1](https://www.bioderma.fr/p/atoderm-intensive-baume) | 8-byte mock PNG; offer disabled/unconfirmed |
| CER-1001 · CeraVe · CeraVe Moisturizing Cream | fed46121-fe43-484c-8b9f-a248407bc1d6 | 33d13484-dcf3-405b-b469-2685fcf60daf<br>CER-1001 | missing / 12 oz | [stored source 1](https://www.cerave.com/skincare/moisturizers/moisturizing-cream?GeoRedirectOff=) | 8-byte mock PNG; offer disabled/unconfirmed |
| CER-1002 · CeraVe · CeraVe Hydrating Facial Cleanser | fa081754-3540-479e-9cf1-3dbcbf0c632b | 628b87b1-8634-41c4-960d-f03896ac3490<br>CER-1002 | missing / 2 l | [stored source 1](https://www.cerave.com/skincare/cleansers/hydrating-facial-cleanser) | 8-byte mock PNG; offer disabled/unconfirmed |
| EUC-4001 · Eucerin · Eucerin Oil Control Sun Gel-Cream SPF 50+ | f1acdb6c-bf13-4a46-8ee8-32274d39508d | 2438e43a-0b9a-4733-b9a1-754dc22ee856<br>EUC-4001 | missing / 50 ml | [stored source 1](https://int.eucerin.com/products/sun-protection/sun-gel-creme-dry-touch-spf-50plus) | 8-byte mock PNG; offer disabled/unconfirmed |
| EUC-4002 · Eucerin · Eucerin DermatoCLEAN Cleansing Gel | b037bb9f-0591-4e71-afc3-1eb11663293f | 0373e2f9-8e4e-49f6-acc5-2f723cfa5f50<br>EUC-4002 | missing / missing | none (internal fallback only) | 8-byte mock PNG; offer disabled/unconfirmed |
| LRP-2001 · La Roche-Posay · Anthelios UVmune 400 Invisible Fluid SPF50+ | b1fc0735-ac60-4383-ad04-797773617049 | 5288f7d5-9a42-456e-a824-a6ab60150a0e<br>LRP-2001 | missing / 50 ml | [stored source 1](https://www.laroche-posay.co.uk/en_GB/anthelios-uvmune-400-invisible-fluid-spf50-sun-cream-for-sensitive-skin-50ml/LRP_026.html) | 8-byte mock PNG; offer disabled/unconfirmed |
| LRP-2002 · La Roche-Posay · La Roche-Posay Effaclar Purifying Foaming Gel | none | none<br>none | missing / 400 ml | [stored source 1](https://www.laroche-posay.us/our-products/face/acne-products/effaclar-gel-facial-wash-for-oily-skin-effaclargelcleanser.html) | no media; no offer |
| VIC-3001 · Vichy · Minéral 89 Hyaluronic Acid Booster | ce28fadc-6f1b-4c3b-8f36-532eb4a09c21 | 7a045fe2-190a-4ea3-8c9e-fcc7f524fff5<br>VIC-3001 | missing / 4.7 l | [stored source 1](https://www.vichy.fr/tous-les-produits/soins-de-la-peau/serums-pour-le-visage/peau-seche/serum-booster-mineral89) | 8-byte mock PNG; offer disabled/unconfirmed |
| VIC-3002 · Vichy · Vichy Normaderm Phytosolution | cd10459a-7248-45ac-a097-bfc36a6c6496 | a51bb0cf-ac27-4c75-ab92-8e976d832344<br>VIC-3002 | missing / missing | [stored source 1](https://www.vichyusa.com/skin-care/normaderm-phytoaction-acne-control-moisturizer-with-salicylic-acid-3337875660617.html) | 8-byte mock PNG; offer disabled/unconfirmed |

The stored ingredient/usage suggestions contain navigation text and malformed markup. Examples: CeraVe Cleanser suggests 2 l, Vichy Minéral 89 suggests 4.7 l, and Avène thermal water suggests 1 g. None was promoted as a verified fact. The evidence JSON retains the exact candidate IDs, source values, media URLs/byte counts, demo costs, and before/after publication state.

## Confirmed fixes and working workflows

- Uploaded candidate images stay private and unverified; explicit mock/test filenames stay TEST. Signature-only PNGs, MIME/extension mismatches, unsupported SVGs, missing files, oversized files, and invalid storage paths are rejected.
- Review requires an authenticated Admin/Hub Operator, a business-trusted HTTPS source, matching source size evidence, and the candidate barcode/size/unit/variant. URL-only approval is rejected. Identity edits invalidate approval and downgrade the parent job; stale batch approval cannot publish pending candidates.
- Every publish path validates reviewed media, including already-matched SKUs. It copies stable object IDs to public storage, records the exact SKU association, and serializes media creation to prevent duplicates. New Products stay unpublished and new SupplierOffers stay unavailable.
- Customer reads require reviewed exact-SKU media, orderable Commerce terms, and confirmed supplier availability. Merely setting isAvailable without lastConfirmedAt cannot expose a customer product. The positive fixture uses explicit supplier confirmation; no real availability was inferred. Raw media/SKU subresource routes cannot disclose incomplete products. Media review details remain private; customer media includes only the associated SKU ID.
- Catalog writes require authenticated Admin/Hub Operator access. Private supplier storage requires internal authority or the persisted owning supplier account; customer roles and unlinked supplier accounts are denied.
- Shared local storage has UUID object names, explicit visibility, and configurable STORAGE_LOCAL_PATH. Candidate upload uses this boundary. Supplier-original PDF storage/read isolation is tested at the boundary; there is no existing supplier-original upload/association workflow to claim complete.

## Verification

Final verification: **12/12 focused PostgreSQL integration tests passed**, API `tsc --noEmit` passed, all 28 migrations deployed on the dedicated test database and migration status reported up to date, and `git diff --check` passed. Earlier fixture failures were corrected; no final checks failed. Tests use a separately created `shenacare_pipeline_test`, real sessions/guards, isolated filesystem fixtures, and persisted assertions. Synthetic bytes/evidence/prices used in tests never count as genuine pilot products.

Schema change: additive nullable Customer → Supplier membership, index, and foreign key. The migration was deployed and checked on the dedicated test DB. Existing accounts remain unlinked; production deployment and trusted account provisioning are still required. No registration DTO can assign this field. The original workspace client/dependencies were not regenerated; a separate generated client was used inside the worktree for tests.

The original workspace source files were left untouched because Antigravity is running. The existing local pilot database was changed only by the stated domain-service quarantine, apart from the application's existing expired-session/outbox cleanup workers briefly starting during the first inspection; the final verifier avoids those workers. Reviewed existing uncommitted storage/ingestion improvements were incorporated into the isolated branch. Integrate these focused commits after reconciling that workspace, deploy migrations, regenerate Prisma, and restart the API. No destructive resets or schema pushes were used.

## Remaining work and external inputs

- GLO-204: S3/provider switching remains deferred. Supply a persistent volume/path and backup policy for local storage. Supplier-original upload and ingestion-job association are not implemented.
- GLO-123: provide authentic, licensed packshots for each exact barcode, package size, and regional variant; record an authorized source review. Existing mock ProductMedia labels remain historical and are rejected by receipt-based reads.
- GLO-124: complete real human fact/content review and commercial release using approved business inputs. Legacy evidence extraction needs correction before its suggestions can serve as facts. Test coverage proves the fail-closed gates; it does not complete the real pilot.
- GLO-142: provide a genuine supplier identity/account mapping, supplier original list or quote with exact barcode/size/variant and cost/currency, confirmed stock/availability with dates, licensed source media, qualified product-fact/content reviewer decisions, approved retail SellingPrice/currency/tax policy, and listing/publication decisions for 10–20 distinct Products.
- GLO-182/GLO-183: issue specifications are absent from this checkout, so ticket-specific acceptance criteria cannot be verified. Concrete backend contracts to reconcile next: mediaReviews replaces URL-only verification; customer media has skuId; supplier membership is now persisted; customer lists omit incomplete SKUs/products; pagination/counts must match those commercial visibility filters; admin review must distinguish AI suggestions, human-approved facts, supplier cost, and Commerce price. These issues were not implemented as separate features.
- Application background workers lack shutdown cleanup. They were disabled in the focused test context and avoided in the final pilot verifier; repair their lifecycle separately.

## Security assessment

Security impact: closes unauthorized catalog writes, tenant ambiguity, unreviewed public media, and accidental demo publication.
Trust boundary: uploaded supplier bytes and provider suggestions cross into official Catalog/customer assets only through explicit review.
Authorization rule: Admin/Hub Operator reviews and catalog mutations; linked owning Supplier or internal authority for private reads; anonymous public reads require approved published media.
Sensitive data involved: private supplier originals and candidate media; credentials are read only from configuration and never printed or committed.
Abuse cases considered: anonymous/customer mutation, supplier cross-tenant access, missing tenant linkage, spoofed files, size/path attacks, forged media identity, review replay after identity edits, concurrent duplicate writes, and supplier-cost leakage into retail price.
Security tests added: persisted positive and negative authorization/media/publication tests, with independent test PostgreSQL data.
Remaining risk: production migration/provisioning and integration are pending; source authenticity/rights and business confirmations still require humans; local storage has no S3 failover.
