# Architecture Decision Records

## Overview

This directory contains Architecture Decision Records (ADRs) documenting significant architectural decisions made in the Shena Care platform.

## Index

### Foundation
- [ADR-001: Modular Monolith](001-modular-monolith.md)
- [ADR-002: Context Ownership](002-context-ownership.md)
- [ADR-003: Product and SKU Identity](003-product-sku-identity.md)
- [ADR-004: PostgreSQL Schema Strategy](004-postgresql-schema-strategy.md)
- [ADR-005: Cross-Context Foreign Keys](005-cross-context-foreign-keys.md)

### Product Workflow (Phase 1+)
- [ADR-006: Product Workflow Architecture](006-product-workflow-architecture.md)
- [ADR-007: AI Integration Strategy](007-ai-integration-strategy.md)

## Additional Documentation

- [ER_MODEL.md](ER_MODEL.md) - Complete entity-relationship model
- [PHASE_0_PLAN.md](PHASE_0_PLAN.md) - Phase 0 implementation plan

## Format

Each ADR follows this structure:

- **Title**: Short descriptive name
- **Status**: Accepted | Superseded | Deprecated
- **Context**: The situation prompting the decision
- **Decision**: What was decided
- **Consequences**: Positive and negative outcomes
- **Alternatives Considered**: Other options and why they were rejected
