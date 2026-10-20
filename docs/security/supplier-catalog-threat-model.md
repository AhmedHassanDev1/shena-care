# Threat Model & Security Evaluation: Supplier Portal & Catalog Intelligence

## 1. System Overview & Trust Boundaries

The Supplier Portal and Catalog Intelligence subsystem ingests untrusted third-party supplier files, extracts tabular product data, integrates with external AI/research APIs, commits wholesale supplier pricing, and feeds the core ShinaCare catalog and sourcing engine.

### Trust Boundaries
1. **External Suppliers (Untrusted)**: Access restricted strictly to authenticated supplier endpoints (`@Roles('SUPPLIER')`). Isolated by `user.supplierId`.
2. **Spreadsheet Files & Payloads (Untrusted)**: Any uploaded CSV, XLSX, or PDF is untrusted external input capable of carrying formula injection, zip bombs, or malicious payloads.
3. **External Research/AI APIs (Semi-trusted/Untrusted Outbound)**: Exa, Firecrawl, Groq, and Cloudinary. Responses are sanitized; network failures or maliciously crafted page responses must not compromise catalog integrity.
4. **Hub Operators (Internal Trusted)**: Operational execution (receiving, picking, packing). Strictly prohibited from Catalog publication or financial credit mutations.
5. **Administrators (High Trust)**: Full catalog admission, editorial approval, credit adjustments, and publication rights.

---

## 2. Threat Analysis Matrix (STRIDE)

| Threat Category | Potential Attack Vector | Impact | Mitigations Implemented in Code |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Supplier attempts to authenticate as another supplier or forge session token. | Unauthorized PO and offer disclosure. | Cryptographic session tokens (`UUID v4`), bcrypt-hashed passwords (cost factor 10+), constant-time comparisons. |
| **Tampering** | CSV Formula Injection (DDE attack: `=cmd\|' /C ...'!A0` or `@SUM(...)`). | Client-side command execution in operator spreadsheet software. | `SpreadsheetParserService` sanitizes cell values beginning with `=`, `+`, `-`, or `@`. Cells are parsed into typed strings/numbers without formula evaluation. |
| **Information Disclosure (IDOR)** | Supplier A queries Supplier B PO via `/purchase-orders/:id` or job diff `/ingestion/jobs/:id/diff`. | Competitor wholesale price leakage, inventory visibility. | Strict tenant validation: `ownedPurchaseOrder` and `job.supplierId !== user.supplierId` throw `ForbiddenException(403)` or `NotFoundException(404)`. Verified in automated integration suites. |
| **Privilege Escalation** | Supplier or Hub Operator calls `PATCH /ingestion/candidates/:id/approve` or `POST /candidates/:id/publish`. | Unauthorized publication of unvetted or low-quality products to storefront. | `@Roles('ADMIN')` guard enforced at both Controller and Service levels (`approveItemLocked` explicitly checks `reviewer.roles.includes('ADMIN')`). Tests verify 403 Forbidden for Hub & Supplier. |
| **Denial of Service** | Uploading oversized spreadsheets, malicious nested zip archives (zip bombs), or high-frequency uploads. | Server memory exhaustion, thread pool saturation. | File size limit enforced at 10MB; MIME type validation (`text/csv`, `application/vnd.openxmlformats...`); Rate limiting via `express-rate-limit` (200 requests/min). |
| **Financial Tampering** | Applying fraudulent supplier return credit notes or double-counting discounts. | Gross profit leakage, underpaying suppliers, corrupted cost basis. | Payables credit application strictly restricted to Admin (`POST /sourcing/payables/:id/apply-credit`). Preserves gross goods acquisition basis in `basis` JSON ledger. Hub operators denied (403). |

---

## 3. Supply Chain & External Provider Security

### 3.1. $0 External Paid Art & Image Generation Deferred
- **Threat**: Accidental API key exposure or automated loops generating expensive paid image requests.
- **Mitigation**: AI image generation is feature-disabled. No API keys for DALL-E or Imagen are loaded or invoked. Product packaging media requires manual upload of genuine packshots or Cloudinary free-tier processing.

### 3.2. Outbound SSRF & External Research Protection
- `Firecrawl` and `Exa` integrations are scoped to trusted manufacturer domains. Untrusted URLs scraped from web search are sanitized before metadata extraction.
- External API calls use strict 5000ms timeouts with circuit breakers to prevent request starvation.

---

## 4. Verification Evidence & Quality Evaluation

All security boundaries are covered by negative test cases in `apps/api/test/integration/`:
- Multi-tenant PO isolation: `sg11-full-e2e-verification.spec.ts` (Scenario 1 & 2).
- Candidate approval privilege boundaries: `sg11-supplier-portal-and-admin-review.spec.ts` (Scenario 4).
- Payables return credit authorization: `sg11-supplier-portal-and-admin-review.spec.ts` (Scenario 5).
- Safe commit idempotency & anti-replay: `sg11-full-e2e-verification.spec.ts` (Scenario 4).
- Cumulative suite score: **103/103 tests passing**.
