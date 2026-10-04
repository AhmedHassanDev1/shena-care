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

# STUCK WORK / TIMEBOX RULE

Do not spend excessive time on one small issue, edge case, or non-blocking problem.

If a task is taking disproportionately long compared with its value:

1. Determine whether it is a TRUE BLOCKER for the next Linear issues.

2. If it is NOT a blocker:
   - document the exact remaining problem,
   - keep the current working implementation intact,
   - add a concise Linear comment / follow-up note if needed,
   - do NOT mark unsupported functionality as verified,
   - move immediately to the next eligible Linear issue.

3. If it IS a blocker:
   - attempt the smallest safe fix,
   - avoid broad refactors,
   - stop only if continuing risks correctness, security, data integrity, or major rework.

Do not spend multiple execution cycles repeatedly trying the same fix.

After 2 reasonable failed approaches on a non-critical problem:

STOP investigating it.

Record:
- what failed,
- current impact,
- what remains,
- how to reproduce it.

Then continue the backlog.

Do not allow one difficult frontend page, flaky test, styling problem, minor edge case, or environment problem to block unrelated Linear work.

Priority is:

Critical blocker
→ fix now

Non-critical functional gap
→ document and continue

UI polish / minor edge case
→ defer

Always maximize completed independent Linear work instead of getting stuck polishing one issue.
