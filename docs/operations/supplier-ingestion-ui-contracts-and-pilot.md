# Supplier Ingestion — UI contracts for the missing flows, and the real-supplier pilot checklist

Status 2026-10-23 · HEAD `1dac140` + uncommitted closure work · Linear: GLO-273 (intake) · 274 (mapping) · 275 (validation) · 276 (matching) · 277 (fast lane) · 278 (dedup) · 279 (intelligence) · 280 (review/price) · 281 (E2E/pilot).

Everything below is **what the backend already does today** (verified by reading controller/DTO/service code and by the Supabase e2e suites). Nothing here needs a new backend endpoint except where marked **GAP**. The Business app files (`apps/business/**`) are the owner's uncommitted work and are **not edited**; each contract lists the exact delta against them.

All calls go through the existing `api()` helper (session cookie → `Authorization`), JSON unless stated. Errors are Nest `{ statusCode, message }`; `message` is a string or a string[] (validation).

---

## C1. Admin — Mapping profile approval (GLO-274)

**Why it is missing:** `POST /ingestion/jobs/:id/mapping` by a SUPPLIER only *proposes*; nothing in `apps/business` calls `GET /ingestion/profiles` or `POST /ingestion/profiles/:id/approve`, so a proposal can never be approved from the UI.

| Step | Call | Notes |
|---|---|---|
| List proposals | `GET /ingestion/profiles` (ADMIN/HUB_OPERATOR) | Rows with `isApproved === false`; each has `id`, `supplierId`, `formatFingerprint`, `version`, `sampleHeaders[]`, `mapping` (incl. `mapping.semantics?`, `mapping.proposal?.{proposedBy,proposedAt}`), `name`. |
| Show held rows | `GET /ingestion/jobs?…` (staff sees all) filter `profileId === profile.id && status === 'review_required'` | Count + file names so the reviewer sees what approving will admit. |
| Preview sample | `GET /ingestion/profiles/:id` → `sampleHeaders` + mapping | Reviewer maps each canonical field (supplierSku, name, price, barcode, brand, quantity, retailPrice, discount, units, sourceTimestamp, currency) to a header. |
| Approve | `POST /ingestion/profiles/:id/approve` body `{ supplierId, semantics }` | `semantics` **must be complete** (below). Response: `{ ...profile, importedJobs }` — jobs whose rows were admitted by this approval. |

`semantics` (all four are the reviewer's explicit decision, never defaulted by the UI):
- `documentKind`: `PRICE_LIST | STOCK_FEED | SALES_INVOICE`
- `priceBasis`: must be `UNIT_PURCHASE_COST` to be approvable (`PACK_PURCHASE_COST | RETAIL_PRICE | UNKNOWN` are rejected: *"price column must be confirmed as UNIT_PURCHASE_COST…"*)
- `quantityBasis`: required when a quantity column is mapped: `ON_HAND | AVAILABLE_TO_SELL` (an `INVOICE_QUANTITY` on a `SALES_INVOICE` is rejected as stock)
- `discountBasis`: required when a discount column is mapped: `PERCENT | AMOUNT_PER_UNIT`

Errors the screen must render in words: `403` not an internal reviewer; `409/400` with the list from `mappingApprovalProblems` (each problem is a sentence — show them all, not the first).
States: *pending proposals* · *approved (rows admitted: N jobs)* · *rejected-by-validation (problems list)*. **GAP:** there is no "reject proposal" endpoint; until one exists the screen offers *Approve* and *Leave pending*.

**Supplier wizard delta** (`supplier/updates/page.tsx`, owner file):
1. Upload (`:166`) already sends `supplierId`, `mode`; add optional `documentKind` (`PRICE_LIST|STOCK_FEED`) — it is recorded as provenance and must match the approved profile's kind or the layout is not reused.
2. Mapping (`:221`) sends `{ mapping, profileName }` with **no `semantics`** and then immediately loads the diff. For a supplier the response is `{ awaitingApproval: true, importedItemsCount: 0, status: 'review_required' }` → the diff is empty and the user sees nothing wrong. Required: if `awaitingApproval` (also returned on **upload** as `awaitingApproval: true` when an open proposal for the same layout exists), show a "تم إرسال القالب للمراجعة — لن تظهر الأصناف حتى تتم الموافقة" state instead of `PREVIEW_DIFF`; include `mapping.semantics` choices as the supplier's *proposal* (same four fields).
3. After approval the job becomes `pending` with items; the wizard polls `GET /ingestion/jobs/:id` (status) then `GET /ingestion/jobs/:id/diff`.
4. `commit-offers` body `{ autoApplyLowRisk, declaredCompleteAssortment }` is valid today; response `itemOutcomes[].status ∈ COMMITTED|HELD_FOR_REVIEW|SKIPPED|ERROR` with `reason` — the receipt must show counts of each plus reasons (held rows are **not** failures).

---

## C2. Admin — Candidate evidence review (GLO-279)

Screen data: `GET /ingestion/candidates/:id/review-record` (ADMIN/HUB_OPERATOR) → `CandidateReviewRecord`:
`originalSupplierRow{price,currency,reportedQuantity,…}` · `normalizedIdentity{name,brand,barcode,size,sizeUnit,matchClassification,matchReason,matchedSkuId}` · `dependencies{brand,productLine,ingredients,routinePlacement,research{sourceCount,fieldEvidences[]}}` · `contentAndMedia{contentDraft,verifiedPackshots[],hasVerifiedPackshot}` · `policyAndQualityConflicts[]` · `canPublish` · `auditTrail[]`.

Record evidence — `PATCH /ingestion/candidates/:id/evidence` body `{ fields: CandidateSourceEvidenceDto[1..8] }`; one entry per **distinct** field:
- `field ∈ name|brand|barcode|size|description|ingredients|usage|warnings`
- `size` entries carry `size` (number) + `sizeUnit` (`ml|g|kg|l|oz`); every other field carries `value` (≤10 000 chars)
- `sourceType`: `OFFICIAL_MANUFACTURER | TRUSTED_DISTRIBUTOR`; `excerpt` (the quoted source text, required)
- `evidenceKind` (default `MANUFACTURER_WEBPAGE`): `MANUFACTURER_WEBPAGE` (https `sourceUrl`, trusted host) · `MANUFACTURER_DOCUMENT` (https `sourceUrl`, `OFFICIAL_MANUFACTURER`) · `PRODUCT_LABEL` (no URL: `labelMediaUrl` = the candidate image URL uploaded in C3, authentic label photo)
- `marketVersion` (optional, ≤120): the formulation/market the evidence describes (e.g. "EG 2026") — **required in practice for ingredients/concentration** so evidence for another market is not reused.

Response `{ id, recordedFields[], observedAt }`. Errors: `400 Authorized evidence reviewer required` · `400 Untrusted or unverifiable <kind> evidence for <field>` · `400 Candidate evidence is immutable in this state` (published/rejected) · `409 Candidate changed while recording evidence; retry` (UI: reload review-record and resend).
UI rules: evidence is never inferred from the supplier row; a reviewer can see each recorded field with its `sourceUrl`/label photo and `marketVersion`; ingredient concentrations show only when stated by the evidence ("<name> N%"), else "غير موثق".

---

## C3. Admin — Authentic packshot upload (GLO-276/279)

`POST /ingestion/candidates/:id/media` — `multipart/form-data`, field `file`; `image/png|jpeg|webp` only (anything else → 400); multer size limit from `upload-validator`. Response `{ url, type: 'image', originType: 'unverified' | 'test' }`. Publication never trusts this URL by itself (*"Media URLs alone are not verification evidence"*).

Verification happens at **approve** time (C4) through `mediaReviews[]`. The UI must collect, per image: the manufacturer/distributor **source page URL (https)**, `sourceType`, the **barcode printed on the pack**, `size`+`sizeUnit` (must match recorded `size` evidence), `variantName`, optional `packCount` (a twin pack requires matching official media). Rules enforced by the server: the image must belong to this candidate, not be `test`, and match the candidate's barcode/size/variant; an image of a different size/variant (e.g. 200 ml for a 400 ml SKU) is rejected. **No AI-generated packshots; no reuse of a bundle photo for a standalone SKU.** Missing optional back/brand imagery never blocks.

---

## C4. Admin — Candidate approve / reject / publish (GLO-280)

| Action | Call | Body / result |
|---|---|---|
| Correct identity | `PATCH /ingestion/candidates/:id/correct` | `{ name?, brand?, barcode?, category?, size?, sizeUnit?, price?, priceType?, reportedQuantity?, currency?, reason }` — audited. |
| Ask supplier for more | `POST /ingestion/candidates/:id/request-more` | `{ requestedInfo }`. |
| **Approve** (ADMIN) | `PATCH /ingestion/candidates/:id/approve` | `ApproveIngestionItemDto`: `matchedSkuId` **xor** `createNewProduct`; `mediaReviews[]` (C3); `productLineId?`, `categoryId?`, `concernSlugs[]?`, `routineStepId?`, `approvedIngredientIds[]?` (needs canonical ontology + supported INCI evidence); `confirmUsageRules?: boolean` (reviewer confirms the usage rules parsed from supported directions — shown read-only first via review-record). The current Business screen sends `{}` which **cannot approve a new product** (no media review ⇒ *"Media URLs alone are not verification evidence"* / *"Missing mandatory verified packshot"*). |
| Reject | `PATCH /ingestion/candidates/:id/reject` | `{ reason }`; the identity is remembered (not resurrected as a new candidate). |
| **Publish** (ADMIN) | `POST /ingestion/candidates/:id/publish` | → `{ id, status:'published', matchedSkuId, canonicalSku }`. |

Approve errors to render verbatim: `400 Authorized media reviewer required` · `Test or unknown media cannot be verified` · `Media evidence does not match candidate identity` · `Package size requires matching source evidence` · `Pack count requires matching official media review` · `Reviewed media does not match the canonical SKU variant` · `Selected SKU conflicts with canonical identity; resolve identity evidence first` · `Selected product line does not belong to the candidate brand` · `Ingredient selection requires canonical ontology and supported manufacturer INCI evidence` · `Cannot set both createNewProduct and matchedSkuId`.
Publish errors: `Candidate is already published` (idempotent final state — treat as success after reload) · `Missing mandatory barcode identity…` · `Missing mandatory verified packshot…` · `Brand draft must be approved by Administrator before candidate publication` (link to the existing brand-draft approve/reject screen at `admin/catalog` `:779/:786`) · `Supplier offer requires review: <reasons>` (409: stale source time / currency change / >30% jump / `financial_hold` — the candidate stays approved; fix the offer, retry).
Publish is **retry-convergent, not one transaction**: after a failure the UI shows the failure and offers *Retry*; a retry ends in exactly one product/SKU/media/offer (proved by `g07-publication`). Publication does **not** set a selling price and does **not** make the product orderable: a separate `POST /commerce/prices` (ADMIN) and a supplier **confirmation** (or the owner's provisional-ordering switch, C5) are required. The success panel must say that, with a link to the price screen.

---

## C5. Availability — one answer for PDP, cart, checkout and substitutes (implemented)

`SourcingService.getPurchaseAvailability(skuId)` is the single source (`availability-policy.ts`):

| State | Meaning | Orderable by default | If `SUPPLIER_PROVISIONAL_ORDERABLE=true` |
|---|---|---|---|
| `CONFIRMED` | a supplier confirmed within `SUPPLIER_AVAILABILITY_MAX_AGE_HOURS` (default 24) | yes | yes |
| `PROVISIONAL` | only a feed/edit signal within the window; `lastConfirmedAt` untouched | **no** | yes (the PO still confirms the real quantity) |
| `UNAVAILABLE` | no available offer, or signals older than the window | no | no |

PDP `availability` gains `state`; `canOrder`, cart add/reorder/projection, checkout quote (`items[].canOrder`) and the substitute-candidate check all read the same boolean. Sourcing (ranking, supply plan, `canSupply`) keeps its own, longer *procurement* window (7 days, one constant) because it chooses whom to ask, not what to promise a customer. **Decision still owed:** the default keeps the shipped contract (customers order only supplier-confirmed products); switching the flag exposes feed-only products to customers.
**Known remaining gap:** guidance/recommendations call `CommerceService.evaluateSellability`, which has no supplier-availability input (module boundary), so an assistant can recommend a product the cart will refuse. Needs a composition-level check; not done.

---

# Real-supplier pilot checklist (GLO-281 · scenario I)

Pre-conditions (all **owner-supplied**; any missing ⇒ pilot stays BLOCKED, technical PASS notwithstanding):
- [ ] ≥ 1 **authentic original export** per launch supplier format (xlsx/csv as received; SHA-256 recorded) — not synthetic, not the EVA pack.
- [ ] Owner-approved **brand/line allowlist** (versioned) and which brands are in the pilot.
- [ ] Approved meaning of each column: price basis (unit vs pack), quantity basis, discount/bonus, currency, timestamp column.
- [ ] 10–20 SKUs chosen for the manual pilot, with authentic packshots + manufacturer source pages.
- [ ] Decision: provisional ordering on/off (C5); offer-terms migration approved if MOQ/pack matter for these suppliers.
- [ ] Environment: Supabase **development** project, fingerprint script + snapshot taken, AI provider mode declared (stub or live with cost cap).

| # | Step | Actor | Evidence to capture | Pass condition |
|---|---|---|---|---|
| 1 | Upload the real export (Business supplier wizard) | supplier user | job id, SHA-256, `sourceMetadata`, screenshot of receipt | one job; original retrievable; re-upload of same bytes ⇒ same job |
| 2 | Mapping proposal (C1) | supplier → admin | profile id, `proposal.proposedBy`, approval with all four semantics, `importedJobs` | supplier cannot approve; rows admitted only after admin approval |
| 3 | Row reconciliation | admin | `rowOutcomes` counts + reasons | imported + invalid + duplicate + out-of-scope = input rows; **every OUT_OF_SCOPE row reviewed by a human against its product type** (no brand-based skips) |
| 4 | SKU matching | system → admin | per-row classification, `suggestedSkuId`, conflicts | zero wrong auto-matches; LIKELY/CONFLICT rows reviewed; aliases only after confirmation |
| 5 | Offer fast lane | supplier | diff screen, `commit-offers` receipt | committed / held / skipped counts; holds explained; stale and financial-hold rows not applied; `lastConfirmedAt` still null |
| 6 | New candidates | system → admin | one candidate per product across suppliers | no duplicate candidate for the same product (second supplier links) |
| 7 | Evidence review (C2) | admin | recorded fields with source + `marketVersion` | no field without a trusted source; unknown stays unknown |
| 8 | Packshot (C3) + approve (C4) | admin | image, `mediaReviews`, audit trail | server accepts only identity-matching media |
| 9 | Publish (C4) + price (`POST /commerce/prices`) | admin | `canonicalSku`, price row | exactly one SKU; selling price set explicitly and independently of supplier cost |
| 10 | Supplier confirmation (or provisional switch, C5) | supplier | `confirm-availability` response / state | PDP `availability.state` as the policy says |
| 11 | Storefront | browser | screenshots 390 px and 1440 px (AR first), network log | PDP shows the product only when orderable; price equals the approved price; add-to-cart works; checkout quote consistent |
| 12 | Supplier PO handoff | admin/supplier | PO line `unitCost` snapshot | snapshot equals the offer cost at issue time and survives a later cost change |
| 13 | Cleanup/ledger | engineer | before/after fingerprint **or** explicit list of retained pilot records | nothing unexplained; pilot records identified by supplier id |

Result matrix to fill (initially all UNKNOWN): Intake/mapping · Scope & matching · Offer updates · New candidates · Evidence/packshot · Publish/price · Storefront · PO handoff · Negative auth. **Pilot PASS requires every row observed with real files and a real browser; until then the report says BLOCKED.**
