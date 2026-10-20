# ShinaCare Operations Runbook: Supplier Portal & Catalog Intelligence

## 1. Executive Summary & Architecture Overview

The **Supplier Portal and Catalog Intelligence Engine** (Strike Groups SG-01 through SG-12) provides self-service supplier catalog feeds, deterministic column mapping, staged diff safety gates, consolidated purchase order confirmation, and admin-supervised editorial catalog admission.

```
                          ┌────────────────────────┐
                          │   Supplier Workspace   │
                          │   (/supplier/catalog)  │
                          └───────────┬────────────┘
                                      │ Upload CSV/XLSX
                                      ▼
                          ┌────────────────────────┐
                          │     IngestionJob       │
                          │   FormatFingerprint    │
                          └───────────┬────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              │ Layout Recognized?                            │
              ▼ Yes                                           ▼ No
    ┌──────────────────────┐                       ┌──────────────────────┐
    │  Approved Profile    │                       │ Interactive Column   │
    │  Deterministic Map   │                       │ Mapping Wizard       │
    └─────────┬────────────┘                       └──────────┬───────────┘
              │                                               │ User confirms
              └───────────────────────┬───────────────────────┘
                                      ▼
                          ┌────────────────────────┐
                          │     IngestionItem      │
                          │   (Staged Live Diffs)  │
                          └───────────┬────────────┘
                                      │ GET /ingestion/jobs/:id/diff
                                      ▼
                          ┌────────────────────────┐
                          │   Staged Diff Safety   │
                          │  Updated / New / Skip  │
                          │  >30% Price Anomaly    │
                          │  Unsafe Deactivations  │
                          └───────────┬────────────┘
                                      │ POST /ingestion/jobs/:id/commit-offers
                                      ▼
                          ┌────────────────────────┐
                          │     SupplierOffer      │
                          │ (Live Sourcing State)  │
                          └────────────────────────┘
```

---

## 2. Supplier Workspace Navigation Scope

The Supplier interface in `apps/business` is strictly constrained to **two primary destinations** to maximize operational velocity and eliminate vanity metrics:

1. **`طلبات شيناكير` (`/supplier` and `/supplier/po/[id]`)**:
   - Consolidated purchase orders inbox with real-time status pills:
     - `جديد`: Unopened order awaiting supplier acknowledgement.
     - `مؤكدة`: Supplier has submitted line confirmations.
     - `جاهزة للاستلام`: Supplier has packed and declared the order ready for courier pickup.
     - `مستلمة بالمخزن`: Hub staff have physically inspected, scanned, and verified arrival.
   - PO line view displays genuine SKU metadata (SKU code, brand name, variant, size/sizeUnit, packaging type, and genuine packshot URL).
   - Bulk draft helper «كل الأصناف متوفرة كما طلبتم (إعداد مسودة)» allows drafting full confirmations with zero auto-commit.
   - Sticky summary footer on desktop and mobile displays total confirmed quantity, total acquisition cost in EGP, and explicit submission button.

2. **`منتجاتي وأسعاري` (`/supplier/catalog`)**:
   - Searchable, paginated table of current active supplier offers with inline wholesale cost edit.
   - Direct file upload dialog supporting `.csv`, `.xlsx`, and `.xls` with explicit import mode selection:
     - `PARTIAL_UPDATE` (Recommended): Updates only the rows present in the file; omitted catalog offers retain their current availability.
     - `FULL_SNAPSHOT`: Declares the file as the complete assortment. Omitted offers enter `deactivationsPending`. If pending deactivations exceed safe thresholds, auto-application is blocked pending explicit Admin approval.
   - Interactive column mapping dialog for newly encountered supplier ERP layouts.
   - Staged diff inspection dialog (`JobDiffInspectionDialog`) displaying row-by-row before/after prices, percentage jump flags, and safe commit controls.

---

## 3. Core Architectural Invariants

### 3.1. Supplier Ready vs. Hub Received
> [!IMPORTANT]
> **Supplier Ready DOES NOT equal Hub Received.**
> - When a supplier clicks «إعلان البضاعة المؤكدة جاهزة للاستلام», the PO status updates to `ready`, recording `readyAt`. The field `receivedAt` remains strictly `null`.
> - Ready status notifies logistics that goods are staged at the supplier dock.
> - Customer inventory, sellable quantity, and customer fulfillment are **NEVER** increased by a supplier's Ready declaration.
> - Inventory and sellability update **only** upon physical barcode scan and inspection by an authorized Hub Operator at the ShinaCare fulfillment facility (`status: 'received_at_hub'`).

### 3.2. Multi-Tenant Perimeter Isolation
- All supplier endpoints enforce strict tenant scope:
  - `GET /purchase-orders/:id`: Returns 403 Forbidden if accessed by another supplier.
  - `GET /ingestion/jobs/:id/diff`: Returns 403 Forbidden if accessed by another supplier.
  - `POST /ingestion/jobs/:id/commit-offers`: Returns 403 Forbidden if accessed by another supplier.
- Suppliers can never see other suppliers' cost prices, customer identities, retail margins, or delivery addresses.

### 3.3. Price-Only Ingestion & Unknown Quantities
- When a supplier feed provides price without stock quantity (common in Egyptian pharmaceutical and beauty distribution price lists):
  - Stock availability is **preserved** (`afterAvailability = before ? before.isAvailable : true`).
  - Unknown quantity is **never** treated as zero.
  - An explicit `0` in a quantity or availability column strictly flips `isAvailable = false`.

### 3.4. Large Price Jump Protection
- Anomaly threshold: Any cost price shift exceeding **±30%** is classified as `RowDiffAction.REVIEW`.
- The commit payload (`autoApplyLowRisk: true`) applies non-anomalous updates while isolating price anomalies for explicit operator verification, preventing fat-finger supplier errors from destabilizing downstream margins.

### 3.5. Catalog Admission Gate
- Unknown products in supplier feeds are created as `IngestionItem` with status `review_required`.
- Suppliers and Hub Operators have **zero** publication privileges (403 Forbidden on `/publish`).
- Only authorized Admins (`@Roles('ADMIN')`) can approve candidate review records and execute atomic canonical catalog publication (`POST /ingestion/candidates/:id/publish`).

---

## 4. Supplier Payables & Return Credit Adjustment Seam

When customer returns are physically routed back to a supplier during replenishment pickup:
1. Hub records returned units physically handed over to the supplier.
2. Upon supplier credit note confirmation, Admin records an audited payable adjustment (`POST /sourcing/payables/:id/apply-credit`).
3. **Financial Accounting Integrity**:
   - Gross inventory acquisition basis for new goods remains unpolluted (e.g., 600 EGP).
   - Applied supplier return credit is accounted distinctly (e.g., -100 EGP).
   - Net cash due to supplier reflects the credit (e.g., 500 EGP).
   - Hub Operators are strictly denied credit adjustment capabilities (`403 Forbidden`).

---

## 5. Secret Store, Provider Quotas & $0 External AI Policy

### 5.1. Deferred AI Image Generation Policy
- In accordance with the project MVP hard-gate policy, paid external AI image generation (e.g. OpenAI DALL-E, Google Imagen) is **feature-disabled** ($0 external cost).
- Product media relies exclusively on:
  - Official manufacturer packshots.
  - Genuine supplier-provided product photography.
  - Local image transformations via `sharp` and Cloudinary free tier storage.
- Candidates publish cleanly with status `NOT_GENERATED` for lifestyle imagery without failing catalog admission gates.

### 5.2. Provider Fallback Configuration
| Provider | Purpose | Fallback Behavior on Timeout / Error |
| :--- | :--- | :--- |
| **Exa API** | Ingredient & INCI research | Returns null research; flags candidate for Admin manual review. |
| **Firecrawl API** | Manufacturer carton text crawl | Falls back to cached manufacturer domains or manual carton upload. |
| **Groq / Llama 3** | Routine placement & description | Bypassed; uses deterministic ingredient keyword heuristics. |

---

## 6. Incident Response & Troubleshooting Runbook

### Issue: Duplicate PO Confirmation (409 Conflict)
- **Symptom**: Supplier clicks confirm twice or submits stale form after confirmation has processed.
- **Cause**: Transactional lock `PurchaseOrder.status in ['created', 'sent', 'opened']`.
- **Resolution**: Harmless. The UI automatically displays the committed confirmation receipt.

### Issue: Unsafe FULL_SNAPSHOT Deactivation Block
- **Symptom**: `commit-offers` returns `DEACTIVATIONS_BLOCKED`.
- **Cause**: Supplier uploaded a partial list under `FULL_SNAPSHOT` mode, which would have inadvertently deactivated >20% of their active catalog.
- **Resolution**: Have supplier re-upload with `PARTIAL_UPDATE` mode selected, or have an Admin review and approve deactivations via `POST /ingestion/jobs/:id/approve-deactivations`.

### Issue: Stale Candidate Approval (400 Bad Request)
- **Symptom**: Admin attempts to approve a candidate item belonging to an already published job.
- **Cause**: Items belonging to published jobs are frozen for audit integrity.
- **Resolution**: Candidate items must be reviewed and approved prior to job publication, or imported as a dedicated review candidate job.
