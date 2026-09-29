# ADR-002: Context Ownership

**Status**: Accepted

## Context

The platform has multiple business concepts that interact: products, prices, suppliers, inventory, orders, customer care routines. Without clear ownership, business logic will leak across boundaries, making the system fragile and hard to evolve.

## Decision

We establish these business contexts with clear ownership:

### Catalog
**Owns**: Brand, ProductLine, Product, SKU, identifiers, ingredients, knowledge, media
**Answers**: What is this product/SKU?
**Does NOT own**: Prices, supplier offers, inventory, routines

### Commerce
**Owns**: Listing, SellingPrice, Cart, Order, Payment records, sellability policy
**Answers**: Can we sell this SKU under current commercial terms?
**Does NOT own**: Supplier selection, physical inventory, care state

### Sourcing (future)
**Owns**: Supplier, SupplierOffer, supply planning, procurement cost
**Answers**: Where can we obtain the requested product?
**Does NOT own**: Customer prices, inventory balances

### Fulfillment (future)
**Owns**: FulfillmentLocation, Inventory, Reservations, Shipments
**Answers**: What physical goods do we control and where?

### Care (future)
**Owns**: CustomerCareProfile, Routine, RoutineProposal, CheckIns
**Answers**: What is this customer's care state?

### Guidance (future)
**Owns**: Conversation, Recommendation, AI execution metadata
**Answers**: What does the AI recommend?
**Does NOT own**: Accepted routine state, orders, cart

### Accounts (future)
**Owns**: Identity, authentication, contact data, access control

## Consequences

### Positive

- **Clear mutation authority** - Each concept has one owner
- **Explicit integration** - Cross-context operations go through public APIs
- **Independent evolution** - Contexts can change internally without affecting others
- **Testable boundaries** - Module contracts can be verified
- **Future extraction** - Clean boundaries make service extraction feasible

### Negative

- **Coordination overhead** - Cross-context operations require coordination
- **Duplicated queries** - Some data may be read from multiple contexts
- **Learning curve** - Team must understand which context owns what

## Alternatives Considered

### Single Unified Domain Model
**Rejected**: Would create tight coupling and make changes risky. A change to pricing would risk breaking catalog queries.

### Microservices from Start
**Rejected**: Adds distributed system complexity before we understand the domain boundaries. Better to learn them in a monolith first.

### Feature-Based Modules (Cart, Checkout, Product Pages)
**Rejected**: Features cut across business concepts. A Product Page needs Catalog (product data), Commerce (price), and potentially Sourcing (availability). Feature-based organization makes business ownership unclear.

## Enforcement

- Public APIs exposed through `public.ts` files
- Import restrictions prevent cross-context internal dependencies
- Database schemas reflect ownership
- Architecture tests validate boundaries
