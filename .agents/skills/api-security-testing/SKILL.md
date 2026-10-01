---
name: api-security-testing
description: >-
  Ensure security tests are added whenever a security-sensitive API is created or changed. Use this when writing tests for API endpoints.
---

# API Security Testing

Whenever a security-sensitive API is created or changed, consider security tests. Security-sensitive changes are not complete if only the happy path is tested.

## Requirements

Test both the **happy path** AND the **abuse path**.

At minimum consider negative cases:
- Unauthenticated request.
- Wrong role.
- Wrong resource owner.
- Malformed input.
- Missing required input.
- Excessive input sizes where appropriate.
- Unexpected enum values.
- Duplicate/replayed operations where relevant.
- Invalid state transitions.
- Sensitive data leakage.
