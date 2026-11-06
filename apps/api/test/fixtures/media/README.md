# Media regression fixtures

Real product photographs used only as regression inputs for the deterministic compositor (`test/unit/product-compositor-regression.spec.ts`).
They are never published, never copied into storage by tests, and are not product data.

| File | Source page (as fetched in the 2026-11-06 real 10-product run) | Defect it guards against |
|---|---|---|
| `clary-conditioner-300ml.png` | https://eparkville.com/products/clary-hair-conditioner-300ml | Hard dark cast shadow kept as a ghost silhouette beside the bottle |
| `capixy-hydrating-conditioner-250ml.png` | https://e-majestic.com/products/capixy-hair-hydrating-conditioner-250ml | Pale cap removed as "shadow", leaving a detached cap |
| `cerave-moisturising-cream-454g.png` | https://africa.cerave.com/en/our-products/moisturizers/moisturising-cream | Small (400x450) source must not be auto-approved after upscaling |

Rights: manufacturer/retailer-published images, kept for internal regression testing only.
