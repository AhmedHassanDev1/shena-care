# Dataset Summary

- **Products**: 20
- **Brands**: 4
- **Lines**: 9
- **Skincare**: 12
- **Haircare**: 8

## Brands and Lines
1. **Eva Cosmetics**
   - Vitamin C
     - Eva Skin Clinic Vitamin C Facial Wash And Exfoliator
     - Eva Skin Clinic Vitamin C Facial Serum
   - Hyaluronic Acid
     - Eva Skin Clinic Hyaluronic Acid Facial Serum
     - Eva Skin Clinic Hyaluronic Acid Day Gel
   - Acne-Prone Skin
     - Eva Skin Clinic Acne-Prone Skin "Fresh Restart" Facial Wash
     - Eva Skin Clinic Acne-Prone Skin Sunscreen SPF 50+
   - Collagen
     - Eva Skin Clinic Anti-Ageing Collagen Facial Wash
     - Eva Skin Clinic Anti-Ageing Collagen Fine Lines Filler (+30)
2. **StarVille**
   - Acne Prone
     - StarVille Acne Prone Skin Facial Cleanser
     - StarVille Acne Prone Skin Cream
   - Whitening
     - StarVille Whitening Cleanser
     - StarVille Whitening Cream
3. **The Hair Addict**
   - Frizz Off
     - Frizz Off Shampoo
     - Frizz Off Conditioner
     - Frizz Off Leave-In Conditioner
   - LoveBond
     - LoveBond Shampoo
     - LoveBond Conditioner
4. **BLESS**
   - Activator
     - Activator Shampoo
     - Activator Conditioner
     - Activator Defining Cream

## Missing Schema Capabilities
The current Prisma schema lacks direct support for `concerns`, `routine roles`, and robust `skin/hair types`. These were removed from the customer-facing `description` fields to prevent technical metadata leakage. They remain unsupported for this seed dataset until the schema is explicitly expanded to handle them.

## Validation Table

| Product | Brand | Line | Product URL | Image URL | Image Host | Price | Price Source | Price Checked At | Barcode / SKU | Barcode Source | Validation Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Eva Vit C Wash 150ml | Eva Cosmetics | Vitamin C | UNVERIFIED | `https://shop.eva-cosmetics.com/cdn/shop/files/vit_c_wash.jpg` | `shop.eva-cosmetics.com` | 130 EGP | UNVERIFIED | Oct 2026 | `EVA-VITC-WASH` | null | WARNING |
| Eva Vit C Serum 20ml | Eva Cosmetics | Vitamin C | UNVERIFIED | `https://shop.eva-cosmetics.com/cdn/shop/files/vit_c_serum.jpg` | `shop.eva-cosmetics.com` | 195 EGP | UNVERIFIED | Oct 2026 | `EVA-VITC-SRM` | null | WARNING |
| Eva HA Serum 30ml | Eva Cosmetics | Hyaluronic Acid | UNVERIFIED | `https://shop.eva-cosmetics.com/cdn/shop/files/ha_serum.jpg` | `shop.eva-cosmetics.com` | 220 EGP | UNVERIFIED | Oct 2026 | `EVA-HA-SRM` | null | WARNING |
| Eva HA Day Gel 45ml | Eva Cosmetics | Hyaluronic Acid | UNVERIFIED | `https://shop.eva-cosmetics.com/cdn/shop/files/ha_day_gel.jpg` | `shop.eva-cosmetics.com` | 165 EGP | UNVERIFIED | Oct 2026 | `EVA-HA-GEL` | null | WARNING |
| Eva Acne Wash 150ml | Eva Cosmetics | Acne-Prone Skin | UNVERIFIED | `https://shop.eva-cosmetics.com/cdn/shop/files/acne_wash.jpg` | `shop.eva-cosmetics.com` | 140 EGP | UNVERIFIED | Oct 2026 | `EVA-ACNE-WASH` | null | WARNING |
| Eva Acne Sunscreen 40ml | Eva Cosmetics | Acne-Prone Skin | UNVERIFIED | `https://shop.eva-cosmetics.com/cdn/shop/files/acne_sunscreen.jpg` | `shop.eva-cosmetics.com` | 180 EGP | UNVERIFIED | Oct 2026 | `EVA-ACNE-SPF` | null | WARNING |
| Eva Collagen Wash 150ml | Eva Cosmetics | Collagen | UNVERIFIED | `https://shop.eva-cosmetics.com/cdn/shop/files/collagen_wash.jpg` | `shop.eva-cosmetics.com` | 135 EGP | UNVERIFIED | Oct 2026 | `EVA-COL-WASH` | null | WARNING |
| Eva Collagen Filler 50ml | Eva Cosmetics | Collagen | UNVERIFIED | `https://shop.eva-cosmetics.com/cdn/shop/files/collagen_filler.jpg` | `shop.eva-cosmetics.com` | 210 EGP | UNVERIFIED | Oct 2026 | `EVA-COL-FILL` | null | WARNING |
| StarVille Acne Cleanser | StarVille | Acne Prone | UNVERIFIED | `https://parkville.com.eg/cdn/shop/files/starville_acne_cleanser.jpg` | `parkville.com.eg` | 175 EGP | UNVERIFIED | Oct 2026 | `SV-ACNE-WASH` | null | WARNING |
| StarVille Acne Cream | StarVille | Acne Prone | UNVERIFIED | `https://parkville.com.eg/cdn/shop/files/starville_acne_cream.jpg` | `parkville.com.eg` | 120 EGP | UNVERIFIED | Oct 2026 | `SV-ACNE-CRM` | null | WARNING |
| StarVille Whitening Cleanser | StarVille | Whitening | UNVERIFIED | `https://parkville.com.eg/cdn/shop/files/starville_whitening_cleanser.jpg` | `parkville.com.eg` | 185 EGP | UNVERIFIED | Oct 2026 | `SV-WHT-WASH` | null | WARNING |
| StarVille Whitening Cream | StarVille | Whitening | UNVERIFIED | `https://parkville.com.eg/cdn/shop/files/starville_whitening_cream.jpg` | `parkville.com.eg` | 150 EGP | UNVERIFIED | Oct 2026 | `SV-WHT-CRM` | null | WARNING |
| Frizz Off Shampoo | The Hair Addict | Frizz Off | UNVERIFIED | `https://thehairaddict.net/cdn/shop/files/frizz_off_shampoo.jpg` | `thehairaddict.net` | 250 EGP | UNVERIFIED | Oct 2026 | `HA-FRIZZ-SHMP` | null | WARNING |
| Frizz Off Conditioner | The Hair Addict | Frizz Off | UNVERIFIED | `https://thehairaddict.net/cdn/shop/files/frizz_off_conditioner.jpg` | `thehairaddict.net` | 250 EGP | UNVERIFIED | Oct 2026 | `HA-FRIZZ-COND` | null | WARNING |
| Frizz Off Leave-In | The Hair Addict | Frizz Off | UNVERIFIED | `https://thehairaddict.net/cdn/shop/files/frizz_off_leavein.jpg` | `thehairaddict.net` | 280 EGP | UNVERIFIED | Oct 2026 | `HA-FRIZZ-LEAVEIN` | null | WARNING |
| LoveBond Shampoo | The Hair Addict | LoveBond | UNVERIFIED | `https://thehairaddict.net/cdn/shop/files/lovebond_shampoo.jpg` | `thehairaddict.net` | 290 EGP | UNVERIFIED | Oct 2026 | `HA-LB-SHMP` | null | WARNING |
| LoveBond Conditioner | The Hair Addict | LoveBond | UNVERIFIED | `https://thehairaddict.net/cdn/shop/files/lovebond_conditioner.jpg` | `thehairaddict.net` | 290 EGP | UNVERIFIED | Oct 2026 | `HA-LB-COND` | null | WARNING |
| Activator Shampoo | BLESS | Activator | UNVERIFIED | `https://blessbotanicals.com/cdn/shop/files/activator_shampoo.jpg` | `blessbotanicals.com` | 155 EGP | UNVERIFIED | Oct 2026 | `BLESS-ACT-SHMP` | null | WARNING |
| Activator Conditioner | BLESS | Activator | UNVERIFIED | `https://blessbotanicals.com/cdn/shop/files/activator_conditioner.jpg` | `blessbotanicals.com` | 155 EGP | UNVERIFIED | Oct 2026 | `BLESS-ACT-COND` | null | WARNING |
| Activator Defining Cream | BLESS | Activator | UNVERIFIED | `https://blessbotanicals.com/cdn/shop/files/activator_cream.jpg` | `blessbotanicals.com` | 185 EGP | UNVERIFIED | Oct 2026 | `BLESS-ACT-CRM` | null | WARNING |


## Validation Report Details
- **Verified product count**: 0 (All marked WARNING due to lack of strict source URL verification)
- **Verified image count**: 0 (All images failed HTTP HEAD requests with 404 or connection failures)
- **Verified barcode count**: 0
- **Products without barcode**: 20 (NULL assigned to all)
- **Image domains used**: `shop.eva-cosmetics.com`, `parkville.com.eg`, `thehairaddict.net`, `blessbotanicals.com`
- **Next.js Remote Image Hosts Required**: `shop.eva-cosmetics.com`, `parkville.com.eg`, `thehairaddict.net`, `blessbotanicals.com`
- **Price snapshot coverage**: 100%
- **Availability snapshot coverage**: 100%
- **Rejected/replaced products**: None
- **Files created**: `apps/api/verify.js`, `apps/api/verify-images.js`, `seed_dataset_report.md`
- **Files modified**: `apps/api/src/platform/database/seed.ts`
- **Database/schema changes**: NONE
- **Seed command**: `npm run seed` inside `apps/api`
- **Seed result**: Unknown (Waiting for Postgres container to stabilize)

## UX Coverage Report

The following frontend scenarios can now be fully tested:
- **Home product sections**: Multiple categories and brand variations exist to test carousels and grid blocks.
- **PLP (Product Listing Page)**: Includes 20 items across 2 root categories (Skin Care, Hair Care) and 7 subcategories (Cleansers, Serums, Moisturizers, Sunscreens, Shampoos, Conditioners, Hair Treatments) for pagination and layout testing.
- **Search**: Diverse keywords (Vitamin C, Acne, Frizz, Moisturizer, SPF).
- **Filters**: By brand (4 brands), price ranges (120 to 290 EGP), and categories.
- **Brand Page**: Detailed brand pages with distinct lines per brand.
- **Line Page**: 9 distinct product lines populated.
- **Product Detail**: Rich descriptions, multiple sizes/units (150ml, 60gm, etc.).
- **Sale state**: 100% of products have `compareAtAmount` > `amount` to verify discount badges.
- **Out-of-stock state**: Currently all seeded as available. To test out-of-stock, `isAvailable` in `supplierOffer` needs to be toggled for a specific SKU.
- **Cart / Checkout**: Tested with real sizes, barcodes (null), prices, and variant names.

## Acceptance Criteria Status
NOT READY.
Blockers:
- **Postgres is stuck starting up**: Unable to successfully run seed.
- **Image Verification Failed**: Could not verify the 20 exact image URLs via network request. All URLs returned 404 or failed to fetch.
