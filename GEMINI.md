# AI-Generated Code Policy

AI-generated code is untrusted until validated.

AI agents must not:
- push directly to production
- bypass tests
- disable security checks
- weaken validation to make tests pass
- turn authorization failures into successful responses
- place credentials in source code
- suppress security scanner findings without explanation
- make an endpoint public simply because authentication is inconvenient

Security findings must be FIXED, not hidden.

---

# Security Completion Checklist

Use risk-based judgment. Do not require every item for every trivial change.

### Input
- [ ] Are external inputs validated?
- [ ] Are IDs/enums/strings constrained appropriately?

### Authentication
- [ ] Is authentication required where appropriate?

### Authorization
- [ ] Can another user access this resource by changing an ID?
- [ ] Are role and ownership checks both correct?

### Data
- [ ] Is sensitive data exposed or logged?
- [ ] Is returned data minimized?

### Database
- [ ] Are queries scoped safely?
- [ ] Could a mass update/delete affect unintended records?
- [ ] Are transactions needed?

### Abuse cases
- [ ] What happens with malformed or hostile input?
- [ ] What happens with replay/duplicate requests?

### Tests
- [ ] Is there at least one negative test for the important security boundary?

### Secrets
- [ ] Were secrets introduced into source or logs?

---

# Special Rules for Payments

- Do not store raw card PAN/CVV.
- Do not build custom card handling when provider-hosted/tokenized flows can be used.
- Verify payment provider webhooks cryptographically.
- Make webhook processing idempotent.
- Never trust a frontend "payment succeeded" state.
- Server-side provider verification determines payment truth.
- Prevent duplicate payment/refund handling.
- Keep payment provider secrets server-side only.

---

# External Integrations and Webhooks

All external payloads are untrusted input.
- Webhook signature verification is mandatory.
- Implement replay prevention where supported.
- Make operations idempotent.
- Enforce timeouts and limit retries.
- Be aware of SSRF risks; use outbound URL allowlisting where appropriate.
- Enforce request size limits.
- Validate untrusted external payloads.

---

# File Upload Rules

Treat all uploaded content as untrusted.
- Validate content type and actual file format (not just extension).
- Enforce size limits.
- Generate server-controlled filenames; prevent path traversal.
- Store uploads outside executable paths.
- Avoid allowing arbitrary HTML/SVG execution unless sanitized/isolated.

---

# Logging Policy

Logging must help incident investigation without leaking secrets.

**Never log:**
- passwords
- authorization headers
- API keys
- JWTs
- refresh tokens
- full payment credentials

**Be careful with:**
- phone numbers
- addresses
- customer data
- supplier credentials

Prefer identifiers and redacted metadata.
