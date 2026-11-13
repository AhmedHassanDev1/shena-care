# Catalog closure evidence — 2026-11-13

Scope: isolated local PostgreSQL `catalog_blockers_20261113_test`, guarded localhost:5434. No shared development/staging/production database was changed. Real manufacturer sources and persisted original images were used. Other worktrees and image WIP 242c6fd remain separate.

## Independently verified fixes merged to main

- 638c2ab: removed Python global unverified SSL context, requests `verify=False` monkeypatch, and warning suppression. Default certificate and hostname verification remain enabled.
- 1eb3dd5: checksum and declared-length validation for structured GTINs; barcode presence no longer substitutes for verified identity at media/publication gates; navigation headings are excluded from ingredients.
- 0271a39: Admin-only transactional withdrawal of an already applied navigation-only ingredient fact. Requires unchanged applied value and unpublished product; compare-and-swap preserves concurrent/manual edits, original evidence and unrelated claims; records one idempotent decision. The Ordinary's bad navigation fact was rejected and its specific exception resolved without inventing a replacement ingredient.
- 1a0ffa9: unknown outer carton is explicitly UNVERIFIED and a warning. Explicit boxed-pack proof and critical identity/barcode/safety/deliverable exceptions still block. No SKU was marked unboxed.

## One actual product completed

The Ordinary Niacinamide 10% + Zinc 1%, 30 ml, SKU e2ac479e-2ce3-47d3-89ab-d79de225879f. EGP 950 is an explicitly assigned DEVELOPMENT-ONLY price, not an approved production price or researched market value.

`one-sku-preparation.json` and `one-sku-end-to-end.json` record authenticated owner APIs, reviewed INCI/usage/safety/size, navigation withdrawal, approved primary packshot, active listing, public listing/detail/image HTTP 200, cart/quote/checkout HTTP 201, identical idempotent checkout replay and INTERNAL_BUY_LIST entry for the actual order. Latest order: 2aee5276-753b-4eb3-8d24-5deaf223cf6a. No supplier offers, invented stock, purchase costs or carton imagery were supplied. Barcode remains null/UNKNOWN; manufacturer evidence verifies identity. Unverified optional proposals remain held.

The served 900x900 image has exactly the original SHA256 9924b6608463d5d305a11d79823ecc9c0e8e78c14a835c6b6036a9690e78b493. The native white cap, bottle geometry, colors and printed label were visually inspected on a white transparency preview. No segmentation, synthesis, upscaling or artificial shadow was applied. The existing manufacturer's shadow remains intact. The first buy-list check raced immediate outbox delivery; the final proof waits for the durable event's delivered state and asserts its specific order appears. It did not change production dispatch behavior.

## Six primary-image blockers investigated separately

| SKU | Actual evidence and result |
| --- | --- |
| CeraVe Hydrating 236 ml | OG 300x400 and exact-size back 300x300 fail existing resolution rules. Native front WebP response rejected as application/octet-stream. Held; no upscaling or threshold reduction. |
| CeraVe Foaming 236 ml | OG 177x400 rejected. Found actual official gallery front 400x450; visible label states 8 FL OZ/236 ml. Original SHA 92e82e14b92b7140f941b475092c8c39223de81952a8c2d68a8b55ef3826eb4c persisted/reviewed APPROVED as asset 0322c219-16d9-41e7-b762-632522bc396c. Other publication requirements remain held. |
| CeraVe Cream 454 g | Actual 400x450 original already recorded against unrelated preservation-test SKU 60a95f0d-7a16-42a1-852f-9803d3c2fde2. Cross-SKU reuse guard retained; no reassignment/deletion of other work. Separate ingredient conflict remains open. |
| CeraVe SA 236 ml | OG 177x400, exact-size back 300x300; native front WebP rejected for octet-stream content type. Held under unchanged rules. |
| Ordinary Niacinamide 30 ml | Authentic exact 30 ml native original approved; five application/before-after/infographic candidates rejected as primary images. Official theordinary.com enabled through existing configuration ONLY in the local proof process. |
| Bioderma Sensibio 250 ml | Manufacturer page has no OG packshot; ProductGroup lists multiple variants without image URLs. Visible extracted texture/infographic assets do not prove the exact 250 ml packshot. Held; no generic gallery substitution. |

`media-investigation.json` retains individual URLs, response outcomes, dimensions and hashes. Manufacturer rights/source/variant review and global media thresholds were preserved. BiRefNet was not required or invoked. Its live worker timeout remains separate image WIP.

## Regression and limits

Current authenticated 3- and 10-product readbacks and replay checks are in ../catalog-gate-real-2026-11-13. Six distinct verified identities persist with matching authenticated workbench responses. Replay returns the same job and leaves product/SKU/fact/media counts unchanged. Identity audit found no duplicates among these six identities. Synthetic focused-test rows explain count growth between earlier concurrent test runs; final readbacks run after focused tests finish.

The 10-product closure gate does NOT pass: two La Roche-Posay sources return SITE_ACCESS_DENIED and retain normal retry/backoff (attempt 4); the Hyaluronic Acid supplied page names the ceramides variant; Cetaphil 236 ml size is not established by its supplied source. Unclear data was not substituted. Other products lack approved prices/listings/media or retain factual holds. Exactly one product completed the full sellability proof; 10/10 readiness is not claimed.

## Verification

- Nine focused Jest suites: 59/59 tests passed, exit 0 (GTIN/extraction/source isolation/media host/identity HTTP/navigation repair/carton/architecture).
- Python TLS regression: 1/1 passed, exit 0; Python compile also passed.
- Changed TypeScript lint, typecheck and worktree Nest build: exit 0. Worktree junction compilation used preserveSymlinks only in ignored scratch configuration.
- Actual main standard production `nest build`: exit 0 after carton merge. No deployment configuration change was needed for TS2742.
- Real customer checkout idempotency, public image bytes, persisted order-specific buy-list requirement, customer buy-list 403 and anonymous workbench 401 all passed.
- Existing isolated commerce-sellability test harness has an unrelated BrandResearchService Object injection failure, reproduced on the pre-change main baseline. No full API-suite success is claimed.
- Graph update is AST-only; missing tree_sitter_sql is an existing optional tooling limitation.

Security assessment: external source trust and barcode assertions are validated; owner Admin mutations remain authorized and transactional; public media and checkout gates remain active. No secrets were added, no shared DB mutation occurred, and held facts remain held.
