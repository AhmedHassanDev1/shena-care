# Shena Care Security Policy & Architecture

## Security Model and Trust Boundaries

Shena Care operates with multiple trust boundaries in a modular monolith architecture. Authentication is required but does not imply authorization.

The system relies on strict role separation and explicit ownership checks. Deny-by-default behavior is preferred for resource access.

## Roles and Permissions

This matrix represents the current known access boundaries in Shena Care:

### Customer
- **Permissions**: Own profile, own carts, own orders, public catalog.
- **Restrictions**: Must not access another customer's order by changing an ID.

### Supplier
- **Permissions**: Own supplier account, own offers/inventory-related information.
- **Restrictions**: Must not see or change another supplier's private data or offers. Must not control catalog ownership simply because it supplies a SKU. Cannot call Admin-only APIs.

### Hub Operator
- **Permissions**: Operational fulfillment information required to receive, prepare, pack, and dispatch orders.
- **Restrictions**: Must not gain Admin permissions. Cannot modify global product pricing.

### Delivery
- **Permissions**: Minimum information required for delivery operations.
- **Restrictions**: Isolated strictly to necessary dispatch and delivery data.

### Admin
- **Permissions**: Privileged system management operations.
- **Restrictions**: Least privilege should still apply where modular functionality permits.

### System / Internal
- Internal processes, background jobs, and AI guidance (which cannot directly mutate trusted core state).

## General Agent Rules

- Apply baseline secure coding practices.
- Parameterize all queries.
- Validate all input and enforce explicit ownership.
- Never hardcode secrets.

*For specific coding guidelines and rules, refer to `GEMINI.md` at the project root.*
