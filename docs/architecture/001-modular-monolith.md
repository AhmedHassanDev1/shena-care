# ADR-001: Modular Monolith

**Status**: Accepted

## Context

We need to build a beauty and skincare e-commerce platform that:
- Supports complex business logic across multiple domains (catalog, commerce, sourcing, fulfillment)
- Can scale and evolve as the business grows
- Allows future extraction of services if needed
- Can be built and maintained by a small engineering team

## Decision

We will build a **modular monolith** rather than starting with microservices.

The system will have:
- One NestJS backend application
- One PostgreSQL database with logical schemas per business context
- Clear module boundaries with explicit public APIs
- No premature service extraction

## Consequences

### Positive

- **Simpler deployment** - One application to deploy and monitor
- **Local transactions** - ACID guarantees across business operations
- **Faster development** - No distributed system complexity
- **Easier debugging** - Single process to inspect
- **Lower operational cost** - One database, one app server
- **Module boundaries** - Still enforced through code organization and import restrictions

### Negative

- **Eventual extraction cost** - Moving to services requires coordination changes
- **Scaling limitations** - Cannot scale individual components independently (mitigated by proper module boundaries)
- **Deployment coupling** - All modules deploy together initially

## Alternatives Considered

### Microservices from Day One
**Rejected**: Premature complexity. The overhead of distributed transactions, service discovery, API versioning, and operational complexity would slow development without providing business value at current scale.

### Serverless Functions
**Rejected**: While attractive for certain workloads, the transactional nature of e-commerce (orders, inventory, payments) benefits from traditional request-response patterns and ACID transactions.

## Migration Path

Modules are designed for future extraction:
- Clear ownership boundaries
- Explicit public contracts
- Stable internal IDs
- Known extraction seams

Future candidates for extraction (in likely order):
1. Guidance (AI workloads, streaming, cost isolation)
2. Ingestion (OCR, long-running jobs)
3. Discovery (independent search scaling)
