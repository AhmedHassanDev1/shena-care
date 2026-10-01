---
name: prisma-database-security
description: >-
  Apply security rules specifically for Prisma and PostgreSQL. Use this when writing or reviewing database queries, migrations, or data access logic.
---

# Prisma / Database Security

## Requirements

1. **Authorization in Queries**: Never assume `findUnique({ where: { id } })` is sufficient authorization. Where ownership matters, authorization must be independently established or encoded into an appropriate scoped query (e.g., `where: { id: requestedId, customerId: currentCustomer }`).
2. **Unsafe Operations**: Check for unsafe raw queries, mass assignment, and unintended nested writes.
3. **Broad Deletes/Updates**: Carefully review overly broad `updateMany` / `deleteMany` operations.
4. **Concurrency & Integrity**: Check for missing uniqueness assumptions, race conditions, and transaction boundaries.
5. **Resource Identifiers**: Prevent enumeration attacks by evaluating the use of predictable resource identifiers where relevant.
