---
name: authorization-review
description: >-
  Review authorization and access control rules for new or modified endpoints and application commands. Use this to prevent IDOR, BOLA, and privilege escalation.
---

# Authorization Review

Authentication is NOT enough. For every endpoint or application command involving a resource, you must determine:
- WHO is performing the action?
- WHAT resource are they accessing?
- DO THEY OWN IT?
- WHAT ROLE/PERMISSION is required?
- WHAT TENANT/SUPPLIER/HUB boundary applies?

## Requirements

1. **Active Checks**: Actively look for IDOR, BOLA, broken access control, privilege escalation, and horizontal/vertical authorization problems.
2. **Deny-by-Default**: Prefer deny-by-default behavior.
3. **Boundary Enforcement**:
   - Customer must not access another customer's data.
   - Supplier must not see/change another supplier's data.
   - Hub Operator must not gain Admin permissions.
4. **Negative Authorization Tests**: Require negative authorization tests when appropriate:
   - Unauthenticated request receives 401.
   - Authenticated but unauthorized request receives 403.
   - Wrong owner attempt receives 403 or 404.
