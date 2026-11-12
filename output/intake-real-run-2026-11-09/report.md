# Catalog Intake — real-product run, 2026-11-09

Scratch PostgreSQL only (`localhost:55611`), never Supabase. Real web (Exa search + the robots-respecting research fetcher), real product names, two realistic Arabic
distributor price lists (`apps/api/test/fixtures/intake/nahar-price-list-{1,2}.xlsx`, oracle `nahar-oracle.json`). Driver: `apps/api/scripts/intake-real-run.ts`.
Raw results in this folder (`admin-run.json`, `supplier-*.json`, `score-*.json`, `market-run.json`, `readiness.json`, `downstream.json`, `retailer-probe.json`; `run-b/` keeps an earlier run for variance).

## Definitive full run (D) — `run-d/`, plus Admin re-check with the final rule (E) — `run-e-admin/`

**Admin names (16: 13 real products, 1 invented, 1 Arabic-only, 1 respelled duplicate)**

| | Run D | Run E (final rule) |
|---|---|---|
| Verified drafts (of 13 real) | 11 | 10 |
| Wrong-variant / wrong-page verifications | 2 found on inspection (Cicaplast verified on a blog article; Garnier "for Dry Skin") → rule tightened | **0** |
| Invented product / Arabic-only name | both UNRESOLVED (correct) | both UNRESOLVED |
| Respelled duplicate | LINKED_EXISTING, no duplicate SKU | same |
| Open fact conflicts after enrichment | **0** | — |
| Time | 156 s for 16 rows (≈ 7 s per real product) | 112 s |
| Paid calls | 48 Exa searches, 76 page reads, 29 image reads (≈ 3 searches / product) | 46 / 72 / 30 |

Unresolved real products, each with its reason and a review item: Eucerin (renamed "DermoPure" on its site), Effaclar/Vichy/CeraVe Cream
in some runs (site denied access or search did not return the product page that minute), Garnier (only the Salicylic-Acid variant's page was found).

**Supplier files (Arabic distributor export: code, Arabic name, public price, discount %, stock)**

| | File 1 (47 rows) | File 2 a week later (14 rows) | Replay of file 2 |
|---|---|---|---|
| Outcome accuracy vs oracle | 97.9 % (46/47) | 92.9 % (13/14) | same job returned, 0 writes |
| False links | **0** | **0** | — |
| False skips | **0** | **0** | — |
| Links | 8 UPDATED | 6 UPDATED + 3 MATCHED (unchanged) | — |
| CRITICAL (review) | 4 (8.5 %) | 1 | — |
| Smart Skip | 15 (14 by the gate: medicine, diapers/formula, makeup, fragrance, oral care, devices, shaving) | 1 | — |
| Throughput | 104 rows/s, 0 paid calls | 41 rows/s | — |

The only "wrong" rows are the Vichy line (`فيشي مينيرال 89 سيروم 50 مل`) sent to CRITICAL instead of linked: the catalog name
"Mineral 89 – Skin Fortifying Daily Booster" shares too little wording with the supplier's, so it waits for one Admin click; once linked, the wording is
learned and every later file links it automatically (proven in the integration test).

**Market prices** — 9 of 11 SKUs got an advisory range (1–6 Egyptian sellers each, e.g. The Ordinary Niacinamide 550–824.5 EGP, median 610, 6 sellers);
Cetaphil and Cicaplast: no reliable EGP observation (recorded, not blocking). 16 searches and 104 page reads for 11 SKUs, ≈ 13 s per SKU.
No selling price was written; pricing state is `WAIT_FOR_SUPPLIER_COST` or `READY_FOR_PRICING_DECISION`.

**Readiness of the 11 drafts (run D)** — chatbot 9, routine 8, PDP 1, selling 0. PDP is held almost only by `PRIMARY_IMAGE_MISSING` (see owner
decisions below); selling waits for an Admin-approved price by design.

**Downstream (scratch DB, one draft published with a stated price)** — storefront PDP detail (facts, media, routine placement), routine profile
(role MOISTURIZER, verified featured ingredients, prerequisites), routine-builder facts, search suggest, and the chatbot's proposal validator
(resolved + sellable via the supplier offer the price file created) all read the intake-created product correctly.

## Variance across runs (same inputs, live web)

| Run | Admin verified drafts (of 13 real) | Supplier file 1 outcome accuracy | False links | False skips | Market references |
|---|---|---|---|---|---|
| A (before the variant rule) | 12 — **1 wrong variant** (Garnier "Hyaluronic Aloe" page accepted for "SkinActive Micellar") | 97.9 % (scorer bug, link correct) | 0 | 0 | 10 / 11 |
| B | 8 — LRP Canada denied access; Garnier page found was the *Salicylic Acid* variant (correctly refused); Cicaplast "Baume" vs "Balm" (fixed after) | 100 % | 0 | 0 | 7 / 8 |
| D | 11 — 2 weak verifications found on inspection (blog page, "for Dry Skin" variant) → rule tightened | 97.9 % | 0 | 0 | 9 / 11 |
| E (Admin only, final rule) | 10 — every verified page is the product's own page | — | — | — | — |

Supplier matching is deterministic (no web): identical results every run. Admin identity depends on what the search provider returns and which official
sites answer that minute; the variation is in *how many* products verify, never in false accepts after the variant rule.

## What was wrong and fixed during the run (evidence-driven)

1. **Wrong-variant verification** — the shared page-identity rule (half the words + brand) accepted another Garnier micellar formula. New rule for creating a
   product: the page must not contradict the name, must not state an active the name leaves out, and every distinctive word of the name must be on the page title
   or address (`AdminIntakeService.pageNamesVariant`). Unresolved reason `PAGE_NAMES_ANOTHER_VARIANT`. After run D it also refuses article/guide titles
   ("Everything You Need to Know About…") and pages stating a skin target or concern the name leaves out ("… for Dry Skin").
2. **Regional brand names** — onboarding named brands "Garnier AU", "La Roche‐Posay Canada", which then excluded the brand's other domains from discovery.
   Region suffixes and Unicode hyphens are stripped; the Admin's mixed-case spelling is kept (`BrandResearchService.fill`).
3. **US pages state fl oz** — "8 fl oz" now confirms 236 ml (1 % metric, 2 % imperial); a confirmed equivalent is recorded in the SKU's own unit, so it can never
   raise a size contradiction. A product page offering several sizes confirms the SKU's size when it is among them.
4. **False fact conflicts** — enrichment had read official pages from several regional sites (CeraVe Africa vs US formulas) and sibling pages ("Hydrating
   Cream-to-Foam Cleanser"). Now: only pages that confirm this SKU's size and name this exact variant, the verified site first; a fallback source is read only for
   fields still missing (`CanonicalResearchService.keepOnlyMissingFields`).
5. **Draft names** — a section heading ("How to Use Cicaplast…") and lost "+" signs; headings are refused and display names keep punctuation; among pages that
   name the variant, the title closest to the typed name wins (English over the French-Canadian page).
6. **Arabic brand spellings** — "جارنييه" (silent final r) and "فيشي" (two consonants) cannot be matched by sound safely; they come from the reviewed dictionary
   (`catalog/research/brand-aliases.ts`, moved to a leaf file to avoid an import cycle).
7. **Market prices** — a robots/JSON-LD probe of 48 domains found six Egyptian sellers with structured EGP prices (`DEFAULT_TRUSTED_RETAILERS`); a marketplace
   domain is one seller whose listings are aggregated by median.
8. **Replay** — re-uploading a finished file no longer re-runs it (metrics were being overwritten with zero).

## Not changed — owner decisions

* **Migration `20261109120000_catalog_intake`** (additive: 4 tables in `ingestion`, 1 in `sourcing`, 1 nullable column on `supplier_offers`) is applied only to
  scratch databases. Applying it to Supabase needs your approval.
* **Trusted image hosts** — official images from theordinary.com, cetaphil.com, garnier.*, bioderma.us, laroche-posay.ca are not on
  `MEDIA_TRUSTED_SOURCE_HOSTS`, so they stay pending review; that list is re-checked at publication and at every storefront read, so I did not widen it.
  This is the main reason drafts lack an approved packshot (others: 300×400 CeraVe Africa images below the 400 px minimum, Cetaphil blocks image robots).
* **Market price sellers** — the six sellers are evidence-based but are your call to keep, extend or remove (`MARKET_TRUSTED_RETAILERS`).
* **Selling prices** are never set by intake. The downstream test published one draft with a price stated by the script, on the scratch DB only.

## Known baseline failures (not from this work, verified at HEAD in a clean worktree)

`brand-research.e2e-spec` (calls deleted `/ingestion/eligibility/*` routes), `catalog-read-filters` and `glo-242-product-identity` (an existing
`catalog/public` ↔ research-service import cycle when booting `CatalogModule` alone).
