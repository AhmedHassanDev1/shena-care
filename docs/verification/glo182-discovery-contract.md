# GLO-182 discovery contract

No Linear specification was supplied. This implements the requested backend slice using the existing Catalog, Commerce and Sourcing contracts. No frontend or dependency changes.

- `GET /products/discovery?q=&brand=&category=&productLine=&limit=&cursor=` returns `items`, eligible product `total`, `facets`, and `pageInfo`.
- Search is case-insensitive substring matching on product/brand names, active SKU code/variant; barcode matching is a substring. No relevance ranking is implied.
- Products group their eligible variants. Each visible SKU needs active canonical identity, exact reviewed media, a published parent, a listed Commerce entry, current independent SellingPrice, and available stock confirmed by an active supplier.
- `SUPPLIER_AVAILABILITY_MAX_AGE_HOURS` defaults to 24, accepts >0 through 720. Future confirmations are ignored. Expired, missing and withdrawn confirmations do not satisfy availability. This window is a provisional business assumption.
- Facets count products after every selected filter and every eligibility gate (conjunctive facets). Category filtering includes immediate children, following the current Catalog contract.
- Pagination uses ascending immutable Product UUID and a creation-time watermark. Cursor version/filter binding is validated; page size is 1–100. Newer products cannot enter later pages. Inventory and price are reevaluated per request: a cursor does not reserve stock or freeze eligibility.
- Catalog scans 100 rows at a time; composition runs in batches of 10. Accurate total/facets currently require scanning the filtered eligible catalog. This is suitable for the pilot; catalog-scale optimization is deferred, without adding a search dependency.
- Legacy `GET /products` retains its array response and page/limit behavior, but now applies pagination after sellability. Invalid pagination receives 400. Public SKU/media subresources apply the same visibility rules.
- Price and listing operational APIs require authentication. Price operations/history require ADMIN; listing operations require ADMIN or HUB_OPERATOR. Customer pricing comes from public product composition. Hub operators cannot manage prices.

Verification: PostgreSQL HTTP fixtures cover incomplete states, stale/unconfirmed/withdrawn stock, expired prices, variant media binding, eligible totals/facets, stable continuation, insertion watermark, search, combined filters, malformed queries, and absence of supplier costs/reviewer IDs. Fixtures are synthetic test inventory only.

Business limitation: persisted technical approvals cannot establish authenticity by themselves. Quotation documents, media usage rights, genuine product facts and operator decisions must be supplied for the real pilot. No fixture or existing demo is promoted by this implementation.
