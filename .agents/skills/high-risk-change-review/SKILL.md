---
name: high-risk-change-review
description: >-
  Trigger a stricter review mode for high-risk areas such as authentication, payments, authorization, and secrets management.
---

# High-Risk Change Review

Create a stricter review mode for high-risk areas.

## High-Risk Areas
- Authentication & Password flows
- Authorization & Supplier permissions
- JWT/session management & Account recovery
- Payments, Checkout, Order ownership, Refunds
- Admin APIs
- File uploads & Webhooks
- External integrations & Secrets management
- Arbitrary URLs, Dynamic queries, Command execution, AI/tool execution

## Output Requirement
When one of these areas changes, the agent must explicitly produce a short security assessment before declaring the task finished.

**Format:**
```text
Security impact:
Trust boundary:
Authorization rule:
Sensitive data involved:
Abuse cases considered:
Security tests added:
Remaining risk:
```
*(Note: Do not write a long report for ordinary low-risk catalog changes.)*
