# Shena Care -- Business Console: v0 Design Handoff

> **For v0.** Read this document before generating any UI.
> All entities, statuses, and workflow steps are derived directly from the implemented backend.
> Do not invent concepts that are not described here.

---

## Product in One Paragraph

Shena Care is an e-commerce platform specialising in beauty and skincare products in the Arabic-speaking market. Customers browse a product catalogue, build skincare routines through an AI guidance experience, and place orders with cash-on-delivery (COD) as the primary payment method. Orders are sourced from external suppliers, packed at a fulfilment hub, and delivered to customers by drivers. This internal **Business Console** is the operational command centre used by hub staff, the operations team, and company administrators to manage every step of this chain â€” from order intake through sourcing, preparation, packing, delivery, returns, COD reconciliation, and supplier payables.

---

## Purpose of the Business Console

The console is **not primarily an analytics tool**. Its job is to answer one question:

> "What needs my attention right now?"

Everything in the UI should help staff discover **what is blocked, what is actionable, and what has gone wrong**. Graphs and KPIs are secondary. Queues, status badges, and action buttons are primary.

---

## Users and Roles

The backend defines exactly five roles in the `accounts` schema (`Role` enum):

| Role | Who they are | What they need |
|---|---|---|
| `ADMIN` | Operations manager / business owner | Full access to every area; approves refunds, marks payables paid, triggers accounting exports, manages all orders and resolutions |
| `HUB_OPERATOR` | Warehouse/hub staff | Core workflow access: fulfil shipments, run preparation sessions, scan items, build delivery batches, view and update support cases, view suppliers and inventory |
| `DRIVER` | Delivery driver | Very limited: view their assigned shipment on a delivery batch, mark stop outcomes (delivered, failed, returned), complete a batch |
| `SUPPLIER` | External supplier | Scoped to their own supplier account: view their offers, confirm availability, view their own purchase orders |
| `CUSTOMER` | End customer | Storefront only â€” has no role in this console |

### Role access by console area (from real endpoint guards)

| Area | ADMIN | HUB_OPERATOR | DRIVER | SUPPLIER |
|---|---|---|---|---|
| Dashboard KPIs | yes | no | no | no |
| Orders (view/manage) | yes | yes | no | no |
| Order Resolutions | yes | yes | no | no |
| Refunds (initiate/update) | yes | no | no | no |
| Fulfillment Locations | yes (create) | yes (view) | no | no |
| Shipment status update | yes | yes | yes | no |
| Shipment events | yes | yes | yes | no |
| Preparation sessions | yes | yes | no | no |
| Label generation | yes | yes | no | no |
| Delivery batch create/stops/dispatch | yes | yes | yes (sequence) | no |
| Delivery batch complete | yes | no | yes | no |
| Inventory view/adjust | yes | yes | no | no |
| Suppliers create/view/update | yes | yes | no | own only |
| Supplier Offers | yes | yes | no | own only |
| Payables adjust | yes | yes | no | no |
| Payables mark paid | yes | no | no | no |
| Support Cases view/update | yes | yes | no | no |
| Accounting Exports | yes | no | no | no |
| COD Settlements | yes | yes | yes | no |

**Navigation must adapt to the authenticated role.** A DRIVER should only see their delivery batch. A SUPPLIER should only see their offers and purchase orders.

---

## Real Operational Workflow

This is the end-to-end flow as implemented in the backend.

```
Customer places order
       |
       v
Order: placed -> confirmed
       |
       v  (hub allocates shipment to a fulfillment location)
Shipment created: pending
       |
       v  (operator starts preparation session)
Shipment: ready_to_prepare -> preparing
PreparationSession: in_progress
       |
       |  [Operator scans each SKU barcode]
       |  -> scan: BARCODE_NOT_FOUND     (error: unknown barcode)
       |  -> scan: WRONG_ITEM            (error: not in this shipment)
       |  -> scan: EXCESS_QUANTITY       (error: already scanned enough)
       |  -> scan: isSuccessful=true     (OK)
       |
       v  (all expected items confirmed -- session complete)
PreparationSession: completed
Shipment: prepared
       |
       v  (label generated + LABEL_PRINTED event recorded)
Shipment: prepared / ready_to_pack
       |
       v  (PACKED event recorded)
Shipment: packed
       |
       v  (added to a DeliveryBatch)
DeliveryBatch: planning -> dispatched
Shipment: out_for_delivery
DeliveryStop: sequence assigned
       |
       +-- DELIVERED   -> Shipment: delivered -> Order: delivered
       +-- FAILED      -> Shipment: failed    -> Order: cancelled
       +-- RETURNED    -> Shipment: returned
```

**COD flow (parallel)**
- `PaymentCollection` is initialised with expected COD amount per order.
- Driver collects cash on delivery.
- Hub creates a `CourierSettlementBatch`, comparing expected vs collected per order.
- Status per collection: `expected -> collected -> settled | short | over | disputed`.

**Resolution / Return flow**
- `OrderResolution` types: `cancellation`, `return`, `refund`, `replacement`, `compensation`.
- Statuses: `requested -> approved -> rejected | in_transit -> received -> resolved`.
- Each status change is logged in `OrderResolutionEvent` with actor and notes.
- A `RefundTransaction` can be attached to a resolution: `pending -> processing -> succeeded | failed`.

**Supplier / Purchase Order flow**
- `SupplierPurchaseOrder` statuses: `created -> sent -> reviewed -> confirmed | partial -> ready -> received_at_hub`.
- Each `PurchaseOrderLine` has its own status: `pending -> confirmed_full | confirmed_partial | unavailable`.
- `SupplierPayable` tracks what is owed per PO: `open -> ready_to_pay -> paid | disputed | adjusted`.

---

## Navigation / Information Architecture

MVP navigation structure (role-filtered):

```
Overview (Action Center)         -- ADMIN, HUB_OPERATOR
Orders                           -- ADMIN, HUB_OPERATOR
  |-- Order Detail
Fulfillment                      -- ADMIN, HUB_OPERATOR
  |-- Preparation & Scan
  |-- Delivery Batches
  |-- Batch Detail / Driver Handoff
Inventory                        -- ADMIN, HUB_OPERATOR
Returns & Resolutions            -- ADMIN, HUB_OPERATOR
Support Cases                    -- ADMIN, HUB_OPERATOR
Finance / COD                    -- ADMIN
  |-- COD Settlement
  |-- Supplier Payables
  |-- Accounting Exports
Suppliers                        -- ADMIN, HUB_OPERATOR (navigation only in V1, "Coming soon")
```

**Do not include in V1:**
- Catalog / product management
- Customer profile management
- Care / Routine management
- Ingestion jobs
- Supplier self-service portal
- Supplier purchase order detail UI

---

## First Vertical Slice

Priority order for V1 implementation:

1. Console Shell (layout, navigation, role-aware sidebar)
2. Overview / Action Center
3. Orders Queue
4. Order Detail
5. Preparation & Scan screen
6. Delivery Batch & Driver Handoff

---

## Overview / Action Center

This is the **primary screen**. It is not a dashboard of graphs. It is an **attention queue**.

### Action Cards (from actual backend states)

| Card label | Backend status counted |
|---|---|
| Ready to Prepare | Shipments: `pending` or `ready_to_prepare` |
| Currently Preparing | PreparationSessions: `in_progress` |
| Ready to Pack | Shipments: `prepared` |
| Ready for Batch | Shipments: `packed` with no DeliveryStop |
| Out for Delivery | Shipments: `out_for_delivery` |
| Delivery Failures | Shipments: `failed` or `returned` |
| Open Support Cases | SupportCases: `open` or `in_progress` |
| POs Awaiting Confirmation | SupplierPurchaseOrders: `sent` |
| Open Resolutions | OrderResolutions: `requested` or `approved` |
| COD Discrepancies | PaymentCollections: `short` or `disputed` |

### Secondary metrics strip (below cards, ADMIN only)

- Orders today
- Revenue today
- Average order value

These values come from `GET /operations/dashboard/kpis`.

---

## Orders Queue

Dense data table. Desktop-optimised.

### Columns

| Column | Source field |
|---|---|
| Order # | `orderNumber` (e.g. ORD-2847) |
| Customer | `customerName` |
| Created | `createdAt` (relative + absolute on hover) |
| Items | count of `OrderItem[]` |
| Total | `totalAmount` + `currency` |
| Status | `OrderStatus` badge |
| Shipment | `ShipmentStatus` badge |
| Resolutions | warning badge if open resolutions exist |
| Action | context-sensitive button |

### Context-sensitive Action per state

| State | Button |
|---|---|
| `placed` + no shipment | Allocate to Hub |
| Shipment `pending` or `ready_to_prepare` | Start Preparation |
| Shipment `preparing` | Resume Preparation |
| Shipment `prepared` | Generate Label |
| Shipment `packed` | Add to Batch |
| Shipment `out_for_delivery` | View Batch |
| Resolution `requested` | Review Resolution |
| Shipment `failed` or `returned` | Create Resolution |

### Filters

- Order status (multi-select): `placed`, `confirmed`, `packing`, `shipped`, `delivered`, `cancelled`
- Shipment status (multi-select): all ShipmentStatus values
- Has open resolution: toggle
- Date range
- Search by order number or customer name

---

## Order Detail

Opens from Orders Queue.

### Sections

**Header:** Order number, status badge, created at, customer name/phone/address

**Shipment Panel:** status badge, location name, tracking number, dispatched at / delivered at

**Items Table:** SKU code, variant name, quantity, unit price, line total

**Preparation Status:**
- Session status badge (`in_progress` / `completed` / `failed`)
- Started by / started at / completed at
- Per-item scan progress: SKU | Expected qty | Scanned qty | Status icon
- Scan errors: WRONG_ITEM, BARCODE_NOT_FOUND, EXCESS_QUANTITY

**Shipment Event Timeline:**
- Chronological: event type, actor, timestamp, notes
- Types: `PACKED`, `LABEL_PRINTED`, `HANDOFF_SCANNED`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED`, `RETURNED`

**Payment / COD:**
- expectedAmount, collectedAmount, status badge
- RefundTransaction status if applicable

**Resolutions Section:**
- Type, status, reason, notes, actor
- Status event timeline

**Sticky Action Bar (role-gated):**
- ADMIN + HUB_OPERATOR: Start Preparation, Generate Label, Create Resolution
- ADMIN only: Initiate Refund

---

## Preparation & Scan

**Full-page screen. Not a drawer or modal. Designed for speed at a physical workstation with a barcode scanner.**

### Top section

- Order number (28-32px, prominent)
- Customer name
- Shipment status badge: `preparing`
- Operator name

### Centre â€” Item checklist table

| Column | Description |
|---|---|
| SKU code | e.g. `CRV-MC-250` |
| Variant name | e.g. "CeraVe Moisturising Cream 250ml" |
| Barcode | displayed for manual fallback |
| Expected qty | from ShipmentItem |
| Scanned qty | live count of successful scan events |
| Row status | green (complete), amber (partial), red (excess) |

Each row shows a fraction indicator: `2/3`.

### Scan input (visually dominant)

- Large input field (min 280px wide, 48px tall)
- Auto-focused on load
- Label: "Scan item barcode or enter SKU code"
- Submit on Enter key
- Refocuses after each scan

### Scan feedback (immediate, full-width)

- GREEN: "SCANNED â€” [Product Name] (2 of 3 complete)"
- RED: "ERROR: BARCODE NOT FOUND"
- RED: "ERROR: WRONG ITEM â€” not in this shipment"
- ORANGE: "WARNING: EXCESS QUANTITY â€” already scanned all of this item"

Flash fades after 2 seconds. Keep last result visible until next scan.

### Bottom action bar

- Left: "X / Y items complete" counter
- Right: "Complete Preparation" button â€” disabled until all items fully scanned
- Disabled tooltip: "3 items still need scanning"
- On complete success: "Preparation complete! Generate shipment label â†’"

### Blocked states

- Shipment not in `preparing`: show blocking message, no scan input
- Session already `completed`: "This preparation session is complete. Generate label."

---

## Delivery Batch & Handoff

### DeliveryBatch statuses

| Status | Meaning |
|---|---|
| `planning` | Being assembled; stops can be added/removed/reordered |
| `dispatched` | Driver has left; shipments are `out_for_delivery`; no edits |
| `completed` | All stops in terminal state |

### Batch List

Table: Batch ID (8 chars), status badge, driver, stop count, planned at, dispatched at.

"Create New Batch" button (ADMIN, HUB_OPERATOR).

### Batch Detail â€” Planning

Two panels:

**Eligible Shipments panel:** packed shipments with no batch stop. Columns: Order #, Customer, Address, COD amount. "Add to Batch" per row.

**Current Stops panel:** Ordered list (sequence 1, 2, 3...). Draggable to reorder. Per stop: #, Order #, Customer, Address, COD amount, status. Remove button per stop.

"Dispatch Batch" button â€” enabled when at least 1 stop. Confirm before dispatching.

On dispatch: all shipments â†’ `out_for_delivery`. Batch â†’ `dispatched`.

### Batch Detail â€” Dispatched

Read-only stop list. Per stop:
- Sequence #, Order #, Customer, Address, COD amount
- Shipment status badge
- Action buttons (DRIVER, ADMIN): Mark Delivered / Mark Failed / Mark Returned
- Actions disable once stop is in terminal state

"Complete Batch" button â€” enabled only when all stops are `delivered`, `failed`, or `returned`. Progress: "6 of 8 stops completed."

### No route optimisation

No map view. No geocoding. No estimated times. Stop ordering is manual drag-and-drop only.

---

## Relevant Backend Entities

| Entity | Key fields (used in UI) |
|---|---|
| `Order` | orderNumber, customerName, customerPhone, shippingAddress, totalAmount, currency, status |
| `OrderItem` | skuId, quantity, price |
| `OrderResolution` | type, status, reasonCode, notes, actorId |
| `OrderResolutionEvent` | status, actorId, notes, createdAt |
| `RefundTransaction` | amount, status, providerRef, errorReason |
| `PaymentCollection` | expectedAmount, collectedAmount, status, courierId |
| `CourierSettlementBatch` | reference, courierId, totalExpected, totalCollected, fees, netSettled |
| `Shipment` | orderId, locationId, status, trackingNumber, dispatchedAt, deliveredAt |
| `ShipmentItem` | skuId, quantity |
| `ShipmentPreparationSession` | operatorId, status, startedAt, completedAt |
| `PreparationScanEvent` | skuId, barcodeScanned, isSuccessful, errorReason |
| `ShipmentEvent` | type, actorId, notes, createdAt |
| `DeliveryBatch` | status, driverId, plannedAt, dispatchedAt, completedAt |
| `DeliveryStop` | batchId, shipmentId, sequence |
| `FulfillmentLocation` | name, address, isActive |
| `InventoryBalance` | ownedOnHand, reserved, availableToSell |
| `Supplier` | name, slug, isActive |
| `SupplierOffer` | supplierId, skuId, costPrice, isAvailable |
| `SupplierPurchaseOrder` | supplierId, status |
| `PurchaseOrderLine` | skuId, requestedQuantity, confirmedQuantity, status |
| `SupplierPayable` | amount, status, dueDate, paidAt |
| `SupportCase` | title, category, priority, status, customerId, orderId, assigneeId |
| `Sku` | code, variantName, barcode |

---

## Relevant Statuses and Transitions

### OrderStatus
`placed -> confirmed -> packing -> shipped -> delivered`
`placed -> cancelled`

### ShipmentStatus
`pending -> ready_to_prepare -> preparing -> prepared -> ready_to_pack -> packing -> packed -> out_for_delivery -> delivered`
Terminal alternate paths: `-> failed`, `-> returned`

### PreparationSessionStatus
`in_progress -> completed | failed`

### DeliveryBatch status (string)
`planning -> dispatched -> completed`

### PurchaseOrderStatus
`created -> sent -> reviewed -> confirmed | partial -> ready -> received_at_hub`

### PurchaseOrderLineStatus
`pending -> confirmed_full | confirmed_partial | unavailable`

### PayableStatus
`open -> ready_to_pay -> paid | disputed | adjusted`

### OrderResolutionStatus
`requested -> approved -> in_transit -> received -> resolved`
`requested -> rejected`

### RefundStatus
`pending -> processing -> succeeded | failed`

### SettlementStatus (PaymentCollection)
`expected -> collected -> settled | short | over | disputed`

### SupportCaseStatus
`open -> in_progress -> resolved -> closed`

### SupportCasePriority
`low`, `medium`, `high`, `critical`

### SupportCaseCategory
`payment`, `sourcing`, `delivery`, `damaged_item`, `wrong_item`, `cancellation`, `return`, `supplier_dispute`, `other`

### ShipmentEvent types (string)
`PACKED`, `LABEL_PRINTED`, `HANDOFF_SCANNED`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED`, `RETURNED`

### InventoryTransaction types (string)
`RECEIVE_OWNED`, `RESERVE`, `RELEASE`, `PICK`, `ADJUST`, `DAMAGE`, `RETURN_TO_STOCK`

---

## Required UI States

Every list, detail panel, form, and action must handle all of these:

**Loading** â€” skeleton placeholders, not full-page spinners. Tables show skeleton rows.

**Empty** â€” short message + icon + action link. No decorative illustrations.
- No orders: "No orders match your filters." + reset link
- No batch stops: "Add eligible shipments to start planning."

**Error** â€” API error on load: message + Retry button. Toast for transient errors. Inline error for validation.

**Blocked Action**
- "Complete Preparation" disabled: tooltip "3 items still need scanning"
- "Dispatch Batch" disabled: tooltip "Add at least one shipment"
- "Complete Batch" disabled: tooltip "2 stops still pending outcome"
- ADMIN-only actions: show lock icon to HUB_OPERATOR; hide entirely from DRIVER

**Success**
- Preparation complete: green banner -> prompt to generate label
- Batch dispatched: status badge transitions + toast
- Scan OK: instant green flash (no modal)

**Warning**
- COD short/over: orange badge on settlement rows
- Shipment failed with no resolution: orange banner on Order Detail
- Resolution `requested` but unapproved: yellow badge

**Permission Denied** â€” "You don't have permission to perform this action." Do not show action buttons the user cannot invoke.

---

## Design Principles

**This is an internal operations tool. It must not look like the customer storefront.**

**Tone:** Professional, calm, efficient. No decorative language, no lifestyle imagery, no gradient hero banners.

**Colours:**
- Dark sidebar: deep slate (`#0f172a` or `#1e293b` range)
- Content area: light grey (`#f8fafc` range)
- Status: green (success), amber (warning/in-progress), red (error/failure), blue (informational)
- Accent: one restrained colour â€” indigo, teal, or slate-blue. NOT pink, rose, or gold.

**Typography:** Inter or similar modern sans-serif. 14px body, 12px labels (uppercase for section headers), 20-24px max headings. No editorial fonts.

**Layout:** Desktop-first. 1280px+ target. Fixed dark sidebar + light content area. Dense tables. Drawers or side panels for detail views. Sticky action bars.

**Density:** 36-40px table row height. Status badges: small, rounded, coloured, with text label.

**Animation:** Scan feedback is instant colour flash. Status badge changes: subtle fade. No page-level entrance animations. No decorative motion.

**Avoid:**
- Large empty hero cards with one number
- Decorative product imagery
- Pink / rose / gold palette
- Generic analytics dashboard templates
- Horizontal card grids as main content pattern for queues
- Confirmation modals for every action

---

## Do Not Build Yet

| Area | Reason |
|---|---|
| Catalog management | Complex, not operational emergency |
| Ingestion Jobs | Not core fulfilment flow in V1 |
| Supplier self-service portal | Future effort |
| Purchase Order detail UI | V2 |
| Accounting export viewer | Out of scope |
| Customer / care / routine management | Storefront concerns |
| AI Guidance session review | Care product |
| Route planning / map view | No geocoding in backend |
| Driver mobile app | Future dedicated app |

---

## Backend / API Constraints v0 Must Respect

1. All IDs are UUIDs. Display shortened (first 8 chars) in UI; send full UUID to API.
2. Order has no payment method field. COD is implied by PaymentCollection presence.
3. Shipment is 1:1 with Order. Do not design multi-shipment UI.
4. Preparation session is 1-active-at-a-time per shipment.
5. Scan complete = exact match. Backend rejects if any item scanned count != expected.
6. DeliveryBatch status is a plain string (`planning`, `dispatched`, `completed`).
7. ShipmentEvent type is a plain string. Use exact values: `PACKED`, `LABEL_PRINTED`, etc.
8. SUPPLIER users can only access their own supplier ID. The backend enforces this.
9. Refund initiation is ADMIN-only. Guard these buttons.
10. Accounting exports are ADMIN-only.
11. Dashboard KPIs endpoint is ADMIN-only. HUB_OPERATOR overview uses shipment/order counts.
12. Inventory shows: ownedOnHand, reserved, availableToSell, orderAllocatedExternalGoods.
13. Mock data must use real field names: `orderNumber`, `customerName`, `customerPhone`, `shippingAddress`, `totalAmount`, `currency`, ShipmentStatus values, etc.

---

# READY-TO-PASTE V0 PROMPT

Design a **desktop-first internal Business / Operations Console** for **Shena Care**, a beauty e-commerce company operating in Arabic-speaking markets (Saudi Arabia, UAE). This is NOT the customer storefront. This is the internal tool used by hub operators, admins, and drivers to manage order fulfilment, preparation, delivery, returns, and support.

---

## Product context

Shena Care sells skincare and beauty products. Customers place orders with cash-on-delivery (COD) as the primary payment method. Orders are sourced from suppliers, packed at a fulfilment hub, and delivered by drivers. The console answers one question: **"What needs my attention right now?"**

---

## User roles

| Role | Description |
|---|---|
| `ADMIN` | Full access. Approves refunds, marks payables paid, triggers exports. |
| `HUB_OPERATOR` | Core workflow: preparation, packing, batching, support cases, inventory. No refunds or exports. |
| `DRIVER` | Highly limited. Views assigned delivery batch, marks stops as delivered/failed/returned. |

Design for ADMIN and HUB_OPERATOR primarily. DRIVER view is needed for the Delivery Batch screen only.

---

## What to build (V1 only)

Build exactly these six screens:

1. **App shell** â€” sidebar navigation, top bar, role-aware menu
2. **Overview / Action Center** â€” operational attention queue
3. **Orders Queue** â€” filterable table of all orders
4. **Order Detail** â€” full operational order context
5. **Preparation & Scan** â€” dedicated hub operator scan workflow
6. **Delivery Batch & Driver Handoff** â€” batch planning and delivery outcome recording

---

## Screen 1: App Shell

- **Fixed dark sidebar** (`#0f172a` or `#1e293b`) with navigation links.
- **Top bar:** breadcrumb/page title, logged-in user name + role badge, logout.
- **Content area:** off-white/light grey (`#f8fafc`).
- Navigation adapts by role.

Sidebar sections:
- Overview
- Orders
- Fulfillment (Preparation, Delivery Batches)
- Inventory
- Returns & Resolutions
- Support Cases
- Finance / COD (ADMIN only)
- Suppliers (greyed out, "Coming soon")

---

## Screen 2: Overview / Action Center

Hero content = **operational attention queue**, NOT graphs.

Display **action cards** in a 2-3 column grid. Each card shows: label, count, colour indicator, link.

**Action cards (use these exact labels and backend states):**

| Card label | What it counts |
|---|---|
| Ready to Prepare | Shipments: `pending` or `ready_to_prepare` |
| Currently Preparing | PreparationSessions: `in_progress` |
| Ready to Pack | Shipments: `prepared` |
| Ready for Batch | Shipments: `packed` with no delivery stop assigned |
| Out for Delivery | Shipments: `out_for_delivery` |
| Delivery Failures | Shipments: `failed` or `returned` |
| Open Support Cases | SupportCases: `open` or `in_progress` |
| POs Awaiting Confirmation | SupplierPurchaseOrders: `sent` |
| Open Resolutions | OrderResolutions: `requested` or `approved` |
| COD Discrepancies | PaymentCollections: `short` or `disputed` |

**Secondary metrics strip (below cards, ADMIN only):**
- Orders today: 23
- Revenue today: SAR 5,840.00
- Average order value: SAR 253.90

Use realistic mock data. Example counts: "Ready to Prepare: 7", "Out for Delivery: 12", "Open Support Cases: 4".

---

## Screen 3: Orders Queue

Dense data table. Desktop-optimised. Not a card grid.

**Columns:**

| Column | Value |
|---|---|
| Order # | `orderNumber` e.g. `ORD-2847` |
| Customer | `customerName` e.g. "Nour Al-Rashid" |
| Created | relative ("2h ago") + absolute on hover |
| Items | item count |
| Total | `totalAmount` + `currency` e.g. "SAR 245.00" |
| Status | `OrderStatus` badge |
| Shipment | `ShipmentStatus` badge |
| Resolutions | warning icon/badge if open resolutions |
| Action | context-sensitive button |

**OrderStatus values:** `placed`, `confirmed`, `packing`, `shipped`, `delivered`, `cancelled`

**ShipmentStatus values:** `pending`, `ready_to_prepare`, `preparing`, `prepared`, `ready_to_pack`, `packing`, `packed`, `out_for_delivery`, `delivered`, `failed`, `returned`

**Context-sensitive action button:**
- `placed` + no shipment â†’ "Allocate to Hub"
- Shipment `pending` or `ready_to_prepare` â†’ "Start Preparation"
- Shipment `preparing` â†’ "Resume Preparation"
- Shipment `prepared` â†’ "Generate Label"
- Shipment `packed` â†’ "Add to Batch"
- Shipment `out_for_delivery` â†’ "View Batch"
- Resolution `requested` â†’ "Review Resolution"
- Shipment `failed` or `returned` â†’ "Create Resolution"

**Filters (top bar or left panel):**
- Order status (multi-select)
- Shipment status (multi-select)
- Has open resolution (toggle)
- Date range
- Search: order number or customer name

Show a warning icon on rows where resolution is open, shipment is failed/returned, or COD is short/disputed.

---

## Screen 4: Order Detail

Opens from the Orders Queue (full page or right-side drawer).

**Header:**
- Order number (h1 level, prominent), order status badge
- Customer name, phone, shipping address (e.g. "Riyadh, Al Malaz")
- Created timestamp

**Shipment Panel:**
- Status badge, location name, tracking number
- Dispatched at / Delivered at

**Items Table:**
- SKU code (e.g. `CRV-MC-250`), variant name (e.g. "CeraVe Moisturising Cream 250ml"), quantity, unit price, line total

**Preparation Status:**
- Session status badge (`in_progress` / `completed` / `failed`)
- Started by, started at, completed at
- Per-item scan progress: SKU | Expected qty | Scanned qty | Status (check / partial / error)
- Scan errors listed: `WRONG_ITEM`, `BARCODE_NOT_FOUND`, `EXCESS_QUANTITY`

**Shipment Event Timeline:**
- Chronological list: event type, actor, timestamp, notes
- Event types: `PACKED`, `LABEL_PRINTED`, `HANDOFF_SCANNED`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED`, `RETURNED`

**Payment / COD:**
- Expected amount, collected amount, settlement status badge
- Refund status (if exists)

**Resolutions Section:**
- Type (`return`, `cancellation`, `refund`, `replacement`, `compensation`), status, reason, notes
- Status event timeline (requested -> approved -> resolved)

**Sticky Action Bar (bottom, role-gated):**
- ADMIN + HUB_OPERATOR: Start Preparation, Generate Label, Create Resolution
- ADMIN only: Initiate Refund

---

## Screen 5: Preparation & Scan

**The most important hub workflow screen. Full-page, not a modal. Designed for fast barcode scanning at a physical workstation.**

**Top section:**
- Order number: 28-32px, very prominent
- Customer name
- Shipment status: `preparing` badge
- Operator name

**Centre â€” Item checklist table:**

One row per expected SKU:
- SKU code (e.g. `LRP-EFF-200`)
- Variant name (e.g. "La Roche-Posay Effaclar Cleanser 200ml")
- Barcode (displayed for reference)
- Expected quantity
- Scanned quantity (live count, updates on each successful scan)
- Row status: green (complete), amber (partial), red (excess/error)
- Fraction indicator per row: `2/3`

**Scan input area â€” must be the most prominent element on screen:**
- Large input field (minimum 280px wide, 48px tall)
- Label: "Scan item barcode or enter SKU code"
- Auto-focused on page load
- Submit on Enter key (standard barcode scanner behaviour)
- Re-focuses after every scan

**Scan feedback â€” immediate, full-width, high-contrast:**
- GREEN banner: "SCANNED â€” CeraVe Moisturising Cream 250ml (2 of 3 complete)"
- RED banner: "ERROR: BARCODE NOT FOUND"
- RED banner: "ERROR: WRONG ITEM â€” this item is not in this shipment"
- ORANGE banner: "WARNING: EXCESS QUANTITY â€” already scanned all 3 of this item"

Banner fades after 2 seconds. Keep last result visible until next scan.

**Bottom action bar:**
- Left: "4 / 6 items complete" progress indicator
- Right: "Complete Preparation" button â€” disabled until all items fully scanned
- Disabled tooltip: "2 items still need scanning"
- On completion: success state â€” "Preparation complete! Generate shipment label â†’"

**Blocked states:**
- Shipment not in `preparing` status â†’ blocking message, no scan input shown
- Session already `completed` â†’ "This preparation session is complete. Generate label."

---

## Screen 6: Delivery Batch & Driver Handoff

**Batch List:**

Table columns: Batch ID (first 8 chars), status badge, driver, stop count, planned at, dispatched at.

Statuses: `planning` (blue), `dispatched` (amber), `completed` (green).

"Create New Batch" button (ADMIN, HUB_OPERATOR).

---

**Batch Detail â€” Planning state:**

Two panels layout:

*Eligible Shipments (left/top):*
- Packed shipments not yet in any batch
- Columns: Order #, Customer, Address, COD amount (SAR)
- "Add to Batch" button per row

*Current Stops (right/main):*
- Ordered list (sequence 1, 2, 3...) â€” draggable to reorder
- Per stop: #, Order #, Customer, Address, COD amount, shipment status badge
- Remove button per stop
- Driver assignment (optional input)

"Dispatch Batch" button â€” enabled when at least 1 stop. Show confirmation before dispatching.

On dispatch: all shipments transition to `out_for_delivery`. Batch transitions to `dispatched`.

---

**Batch Detail â€” Dispatched state:**

Read-only stop list. Sequence order preserved.

Per stop:
- Sequence #, Order #, Customer name, Address, COD amount
- Shipment status badge
- Action buttons (DRIVER, ADMIN):
  - "Mark Delivered" (green)
  - "Mark Failed" (red)
  - "Mark Returned" (grey)
- Buttons disable once stop reaches terminal state

"Complete Batch" button â€” enabled only when all stops are `delivered`, `failed`, or `returned`.
Progress indicator: "6 of 8 stops completed"

**No map view. No route optimisation. Stop ordering is manual only.**

---

## Visual direction

**This is an operational tool, not a storefront. Do not design it as a beauty brand.**

- **Desktop-first.** 1280px+ target. Sidebar + wide content area.
- **Dark sidebar** (`#0f172a` range). Light content area (`#f8fafc` range).
- **No pink, rose, gold, or beauty-lifestyle palette.**
- **Primary accent:** indigo, teal, or slate-blue â€” one colour only.
- **Status colours:** green = complete/success, amber = in-progress/warning, red = error/failure, blue = informational.
- **Font:** Inter or similar. 14px body, 12px section labels, max 24px headings.
- **Table rows:** 36-40px height. Dense but readable.
- **Status badges:** small, rounded, coloured, with text label.
- **Action buttons:** solid, clear label.
- **Scan feedback:** must be readable from 60cm. Large text, high contrast.
- **No decorative animations.** Scan flash is instant. Badge changes fade subtly.

---

## Responsive expectations

- **Primary:** desktop 1280px+
- **Tablet (768-1280px):** sidebar collapses to icon-only. Content remains functional.
- **Mobile:** Preparation & Scan screen and Batch driver view should be mobile-accessible for drivers in the field. Full table layouts not required on mobile.

---

## Mock data requirements

Use realistic Arabic-market e-commerce data:

- Order numbers: `ORD-2847`, `ORD-2848`, `ORD-2849`
- Customer names: "Nour Al-Rashid", "Sara Mansour", "Ahmad Al-Zahra", "Lina Khalil"
- Addresses: "Riyadh, Al Malaz", "Jeddah, Al Rawdah", "Dubai, Deira"
- Currency: `SAR` or `AED`
- Products: "CeraVe Moisturising Cream 250ml", "La Roche-Posay Effaclar Cleanser 200ml", "Neutrogena Hydro Boost Gel 50ml", "The Ordinary Niacinamide 10% 30ml"
- SKU codes: `CRV-MC-250`, `LRP-EFF-200`, `NEU-HB-50`, `ORD-NIA-30`
- Barcodes: 13-digit EAN format e.g. `3606000000000`

---

## Terminology (match the backend exactly)

| Use | Not |
|---|---|
| `orderNumber` | "order ID" or "reference" |
| `ShipmentStatus` | "delivery status" or "shipping stage" |
| `PreparationSession` | "picking session" |
| `DeliveryBatch` | "route" or "trip" |
| `DeliveryStop` | "stop" or "delivery point" |
| `PaymentCollection` | "COD record" |
| `CourierSettlementBatch` | "settlement batch" |
| `OrderResolution` | "resolution" (not "dispute" or "ticket") |
| `SupplierPayable` | "payable" (not "invoice") |
| `FulfillmentLocation` | "hub" or "fulfillment location" |

---

## Do NOT build

- Catalog or product management
- Customer account management
- AI care guidance review
- Supplier self-service portal
- Purchase Order detail management
- Accounting export file viewer
- Route planning or map views
- Storefront pages

---

Generate the console as a complete, interactive React/Next.js application with all six screens fully rendered and navigable, populated with realistic mock data matching the field names and statuses described above.

