# ShinaCare MVP Threat Model & Release Gate

## 1. Threat Surfaces & Mitigations

### 1.1 Customer Auth/Cart/Checkout/Order Access
- **Risk**: A customer modifying paths/IDs to access another customer's orders or cart (IDOR).
- **Mitigation**: Implemented Object-Level Isolation in `OrderingService` and `CareService`. The `customerId` is passed directly from the authenticated session context, not from user input.
- **Status**: ✅ Mitigated (Covered by Integration Tests)

### 1.2 Admin/Hub/Supplier RBAC + Tenant Isolation
- **Risk**: Privilege escalation; Hub operator accessing Admin endpoints; Supplier modifying another supplier's data.
- **Mitigation**: Implemented `PermissionsGuard` with a strict 30-permission matrix mapped to 5 roles. Backend controllers enforce these capabilities explicitly. Supplier tenant isolation implemented in `SourcingController`.
- **Status**: ✅ Mitigated (Covered by `permissions.guard.spec.ts`)

### 1.3 Supplier File/Image Uploads
- **Risk**: Malware upload, path traversal, Zip bombs, oversized files causing DoS.
- **Mitigation**: Configured Multer with 5MB limits and `memoryStorage`. Built `MagicByteValidationPipe` utilizing `file-type` library for deep inspection instead of trusting extensions. 
- **Status**: ✅ Mitigated

### 1.4 Product Research External Fetching / AI Providers
- **Risk**: SSRF (Server-Side Request Forgery) attacking internal network via `sourceUrl`.
- **Mitigation**: Applied `url-validator` with strict regex blocking `localhost`, `10.x.x.x`, `172.16.x.x`, `192.168.x.x` and non-HTTP protocols. AI fetching handles timeouts properly.
- **Status**: ✅ Mitigated

### 1.5 Pricing / Ranking / Manual Overrides
- **Risk**: Manipulation of prices via unauthorized endpoints.
- **Mitigation**: Price adjustments strictly require `catalog.manage` permission (Admin only). The frontend provides prices but the backend recalculates everything via `OrderingService.calculateTotals` as the authoritative source.
- **Status**: ✅ Mitigated

### 1.6 COD Settlement / Financial Adjustments
- **Risk**: Forged financial adjustment without audit trail.
- **Mitigation**: Financial commands are audited through `AccountingExportService` / Outbox events. Settlements require `finance.manage` permission.
- **Status**: ✅ Mitigated

### 1.7 Sensitive Data Leakage (Logs/Errors)
- **Risk**: PII leaking into server logs or internal error stack traces leaking into the browser.
- **Mitigation**: Applied `AllExceptionsFilter` globally to catch 500s and hide stack traces. Refactored `OutboxService` to log generic object IDs instead of raw customer PII payloads.
- **Status**: ✅ Mitigated

---

## 2. Abuse-Case Release Checklist

| Abuse Case | Prevention Mechanism | Status |
| :--- | :--- | :--- |
| **Modify Order ID to view another's data** | Server uses `session.customerId` for scoping `Order` fetch | PASS |
| **Supplier modifying another's PO** | `SourcingController` scope verification against `user.supplierId` | PASS |
| **Price Baiting / Cart Manipulation** | Prices strictly re-fetched from DB `SellingPrice` during checkout | PASS |
| **Replay requests on Order / Checkout** | Cart is cleared in a transaction during order creation | PASS |
| **Malicious Upload / SSRF** | `MagicByteValidationPipe` & `validateSafeUrl` regex block | PASS |
| **Brute-force login** | Global `express-rate-limit` + 15 min Login limit | PASS |
| **CSV/Excel Formula Injection** | `csv-sanitizer` escapes =, +, -, @ during export | PASS |

## 3. Explicit Risk Acceptances (MVP)

1. **Upload Antivirus Scanning**: Real-time malware scanning (ClamAV) is not included in MVP; mitigated partially by strict Magic-Byte whitelisting (images/PDFs only).
2. **Advanced Bot Protection**: Relies on IP-based rate limiting rather than advanced Cloudflare Turnstile / CAPTCHA. Acceptable for MVP traffic levels.

---
**Verdict**: The system passes all critical Security & Abuse-Case release gates. **Go-Live is APPROVED.**
