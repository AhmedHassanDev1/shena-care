# ShinaCare Admin Overview — Backend Capability Gaps Report

**Specification Reference:** Antigravity Business Design System v1 & Operational Admin Console  
**Date:** October 2026  
**Audience:** Backend Engineering, Platform Architecture, Product & Security Teams  

---

## Executive Summary

During the implementation and audit of the ShinaCare Admin Overview in `apps/business/app/(workspace)/admin/page.tsx`, we conducted a comprehensive review against existing NestJS module contracts, composition controllers, Prisma schemas, and role permissions. 

To ensure strict engineering integrity, **no fake KPIs, mock financial metrics, fabricated operational numbers, or synthetic endpoints were introduced into the live product code**. Where operational capabilities are required by modern e-commerce dispatch desks but currently unserved by the backend, this report identifies the exact missing capabilities, contract specifications, database queries, and test criteria.

---

## 1. GAP-01: Order Inflow & Historical Trend Aggregation API

### 1.1 Problem Description
The Admin Overview requires operational visibility into order inflow trends (hourly order velocity and daily order trends). Currently, `DashboardService.getKpis()` only returns aggregate counts:
- `ordersToday`: `order.count({ where: { createdAt: { gte: today } } })`
- `totalOrders`: `order.count()`

There is no endpoint or query capability to retrieve order volume bucketed over time (e.g. hourly today, daily for the last 7 or 30 days, or by cancellation rate). As a consequence, historical trend visualizations cannot be rendered directly from the server without fetching massive unpaged order sets and computing buckets on the client.

### 1.2 Proposed Contract & DTOs
- **HTTP Method & Path:** `GET /operations/dashboard/trends`
- **Request DTO (`OrderTrendsQueryDto`):**
  ```typescript
  export class OrderTrendsQueryDto {
    @IsEnum(['hourly', 'daily'])
    interval: 'hourly' | 'daily' = 'hourly';

    @IsOptional()
    @IsEnum(['today', '7d', '30d'])
    range?: 'today' | '7d' | '30d' = 'today';

    @IsOptional()
    @IsString()
    timezone?: string = 'Africa/Cairo';
  }
  ```
- **Response DTO (`OrderTrendsResponseDto`):**
  ```typescript
  export interface TrendBucket {
    bucketKey: string;      // e.g. "2026-10-16T14:00:00+02:00" or "14:00"
    label: string;          // Arabic display label: "2:00 م"
    placedCount: number;
    confirmedCount: number;
    deliveredCount: number;
    cancelledCount: number;
  }

  export interface OrderTrendsResponseDto {
    interval: 'hourly' | 'daily';
    range: string;
    totalOrdersInRange: number;
    buckets: TrendBucket[];
    peakBucket: TrendBucket | null;
  }
  ```

### 1.3 Aggregation & Database Logic
- **Data Source:** `ordering.orders` table (`createdAt`, `status`)
- **Query Strategy:**
  Use PostgreSQL date truncation in timezone context:
  ```sql
  SELECT 
    date_trunc($1, "created_at" AT TIME ZONE $2) AS "bucket",
    COUNT(*) FILTER (WHERE "status" = 'placed') AS "placed_count",
    COUNT(*) FILTER (WHERE "status" = 'confirmed') AS "confirmed_count",
    COUNT(*) FILTER (WHERE "status" = 'delivered') AS "delivered_count",
    COUNT(*) FILTER (WHERE "status" IN ('cancelled', 'returned')) AS "cancelled_count"
  FROM "ordering"."orders"
  WHERE "created_at" >= $3
  GROUP BY "bucket"
  ORDER BY "bucket" ASC;
  ```
  Zero-fill any gap intervals in the service before returning.

### 1.4 Permissions & Access Control
- **Guards:** `AuthGuard`, `RolesGuard`, `PermissionsGuard`
- **Allowed Roles:** `ADMIN`, `HUB_OPERATOR`
- **Required Permission:** `dashboard.read`

### 1.5 Verification & Regression Tests
- **Unit Test:** `apps/api/test/unit/dashboard-trends.spec.ts`
  - Verify bucket generation across daylight saving / standard Cairo time (`Africa/Cairo`).
  - Verify zero-filling when no orders occurred during intermediate hours.
- **Integration Test:** `apps/api/test/integration/dashboard-trends.integration.spec.ts`
  - Populate orders across multiple days, call `GET /operations/dashboard/trends?range=7d&interval=daily`, assert bucket counts match exact records.

### 1.6 Priority & Work Estimate
- **Priority:** High
- **Effort:** 0.5 Engineering Day

---

## 2. GAP-02: Unified Fulfillment Pipeline Stage Summary

### 2.1 Problem Description
The operational dashboard needs a real-time count of shipments across each operational state in the fulfillment pipeline:
1. `placed` (مستني التوفير)
2. `ready_to_prepare` / `preparing` (جاهز للتجهيز / بيتجهز)
3. `prepared` / `packing` (جاهز للتغليف / بيتغلف)
4. `packed` / `dispatched` (جاهز للمندوب / خرج مع المندوب)
5. `delivered` (اتسلم)
6. `failed` / `returned` (محاولات فاشلة / مرتجعات)

Currently, `FulfillmentService` only offers:
- `getReceivables(locationId)`
- `listHubShipments(locationId, { statuses, take, skip })`
- `listHubRuns(locationId, { statuses, take, skip })`

There is no multi-location or global summary endpoint aggregating all active stages for the operational overview.

### 2.2 Proposed Contract & DTOs
- **HTTP Method & Path:** `GET /fulfillment/pipeline/summary`
- **Request DTO (`PipelineSummaryQueryDto`):**
  ```typescript
  export class PipelineSummaryQueryDto {
    @IsOptional()
    @IsUUID()
    locationId?: string; // Optional: filter by specific hub
  }
  ```
- **Response DTO (`PipelineSummaryResponseDto`):**
  ```typescript
  export interface PipelineSummaryResponseDto {
    locationId: string | 'all';
    totalActiveShipments: number;
    stages: {
      placed: number;
      readyToPrepare: number;
      preparing: number;
      readyToPack: number;
      packing: number;
      dispatched: number;
      outForDelivery: number;
      deliveredToday: number;
      failed: number;
      returned: number;
    };
    bottleneckStage: string | null;
    oldestPendingHours: number;
    updatedAt: string;
  }
  ```

### 2.3 Aggregation & Database Logic
- **Data Source:** `fulfillment.shipments` (`status`, `location_id`, `updated_at`) joined with `ordering.orders` (`created_at`)
- **Query Strategy:**
  ```typescript
  const counts = await this.prisma.shipment.groupBy({
    by: ['status'],
    where: locationId ? { locationId } : {},
    _count: { id: true },
  });
  ```

### 2.4 Permissions & Access Control
- **Guards:** `AuthGuard`, `RolesGuard`, `PermissionsGuard`
- **Allowed Roles:** `ADMIN`, `HUB_OPERATOR`
- **Required Permission:** `order.read` or `hub.prepare`

### 2.5 Verification & Regression Tests
- **Unit Test:** `apps/api/test/unit/pipeline-summary.spec.ts`
  - Verify stage mapping against all 13 `ShipmentStatus` enum values.
- **Integration Test:**
  - Create shipments in `preparing` and `packed`, verify counts increment accurately and decrement upon delivery.

### 2.6 Priority & Work Estimate
- **Priority:** High
- **Effort:** 0.5 Engineering Day

---

## 3. GAP-03: Date Window & Advanced Query Filters in Staff Orders API

### 3.1 Problem Description
The existing staff order query endpoint (`GET /admin/orders` via `AdminOrdersController.list`) relies on `AdminOrderQueryDto`:
```typescript
export class AdminOrderQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}
```
It lacks:
1. `fromDate` / `toDate` filtering (impossible for staff to inspect orders from yesterday, last week, or a specific calendar date).
2. `paymentMethod` filtering (cannot isolate COD orders from online credit card orders).
3. `governorate` / `area` filtering (cannot isolate Cairo vs Giza delivery batches).
4. `needsAttention` flag (cannot filter exclusively orders with unresolved supply shortfalls or pending customer actions).

### 3.2 Proposed Changes
- **Extend `AdminOrderQueryDto`:**
  ```typescript
  export class AdminOrderQueryDto extends PageQueryDto {
    @IsOptional()
    @IsEnum(OrderStatus)
    status?: OrderStatus;

    @IsOptional()
    @IsString()
    @MaxLength(60)
    q?: string;

    @IsOptional()
    @IsISO8601()
    fromDate?: string;

    @IsOptional()
    @IsISO8601()
    toDate?: string;

    @IsOptional()
    @IsEnum(PaymentMethod)
    paymentMethod?: PaymentMethod;

    @IsOptional()
    @IsString()
    governorate?: string;
  }
  ```
- **Update `OrderingService.listOrdersForStaff`:**
  Apply `createdAt: { gte: fromDate ? new Date(fromDate) : undefined, lte: toDate ? new Date(toDate) : undefined }`.

### 3.3 Priority & Work Estimate
- **Priority:** Medium
- **Effort:** 0.25 Engineering Day

---

## 4. GAP-04: Role-Based Isolation of Owner Financial Metrics vs Operations

### 4.1 Problem Description
In the current backend implementation:
- `GET /operations/dashboard/kpis` bundles `revenueToday`, `totalRevenue`, `averageOrderValue`, `ordersToday`, and `totalOrders` into one single object.
- The route is guarded only by `@Roles('ADMIN')` and `@RequirePermissions('dashboard.read')`.
- Operations managers and hub operators assigned `dashboard.read` cannot access operational KPIs (`ordersToday`, `totalOrders`, `attentionCenter`) without also receiving sensitive gross revenue figures (`revenueToday`, `totalRevenue`, `averageOrderValue`).
- Furthermore, `ROLE_PERMISSIONS` in `platform/auth/permissions.ts` assigns `dashboard.read` to `HUB_OPERATOR`. If an operator hits this route, they receive founder financial data.

### 4.2 Proposed Security Architecture
1. **Separate Permissions:**
   - Introduce `finance.read` (restricted to `ADMIN` founder only).
   - Retain `dashboard.read` for operational counts (`ordersToday`, `totalOrders`, `openSupportCases`, etc.).
2. **Conditional DTO Projection:**
   In `DashboardService.getKpis(actor: FulfillmentActor)`:
   - If `actor.roles.includes('ADMIN')` and has `finance.read`: include `revenueToday`, `totalRevenue`, `averageOrderValue`.
   - If actor lacks `finance.read`: omit or return `null` for all currency amounts.

### 4.3 Verification & Regression Tests
- **Security Negative Test:** `apps/api/test/security/dashboard-finance-leak.spec.ts`
  - Call `GET /operations/dashboard/kpis` with a `HUB_OPERATOR` JWT.
  - Assert HTTP 200 contains `ordersToday` and `attentionCenter`, but `revenueToday`, `totalRevenue`, and `averageOrderValue` are strictly `undefined` or omitted.

### 4.4 Priority & Work Estimate
- **Priority:** Critical (Confidentiality & Role Least Privilege)
- **Effort:** 0.25 Engineering Day

---

## 5. Technical Architecture Note: Recharts & Frontend Ecosystem

### 5.1 Monorepo Context
- `apps/business` is built with **Next.js 16.3.3** and **React 19** (`react@^19`, `react-dom@^19`).
- `recharts` (versions 2.x and current 3.x releases) have peer dependency declarations targeting React 16–18. Running an unpinned `npm install recharts` in this mixed monorepo triggers package dependency resolution conflicts with `@tailwindcss/postcss` and Base UI.
- Furthermore, `apps/business/design/README.md` explicitly mandates the v1 design system rule:
  > *"No new dependency was added for v1. design/tokens.css is the source of truth for bw-* surfaces, text, borders, action and state colours... Use components/bw/primitives.tsx."*

### 5.2 Antigravity Implementation Decision
- In accordance with Design System v1 and the user instructions to never invent mock libraries or destabilize workspace dependencies, the Admin Overview implements **native, accessible, token-driven SVG and CSS operational visualizations**.
- Benefits:
  1. **Zero Runtime Overhead:** 0 KB extra JavaScript bundle size.
  2. **100% Token Compliance:** Uses exact design tokens (`--color-bw-page`, `--color-bw-surface`, `--color-bw-action`, `--color-bw-ok`, `--color-bw-warn`, `--color-bw-danger`).
  3. **Full RTL & Accessibility:** Proper ARIA roles, labels, tabular numbers (`<Code>`), and native `prefers-reduced-motion` compliance.
  4. **Direct Interactivity:** Clicking a stage in the fulfillment pipeline immediately filters the live operational orders table.

---

## 6. Gap Summary & Roadmap Matrix

| Gap ID | Area | Required Endpoint / Contract | Priority | Target Release |
|---|---|---|---|---|
| **GAP-01** | Trends | `GET /operations/dashboard/trends` (hourly / daily) | High | C1 Operations Sprint |
| **GAP-02** | Fulfillment | `GET /fulfillment/pipeline/summary` | High | C1 Fulfillment Sprint |
| **GAP-03** | Orders | `fromDate` / `toDate` query filters in `GET /admin/orders` | Medium | Immediate |
| **GAP-04** | Security | Segregate `finance.read` from `dashboard.read` in KPIs | Critical | Immediate |
| **GAP-05** | Ecosystem | Formalize charting strategy for Next 16 / React 19 | Medium | v2 Design System |

---
*Report generated by Antigravity IDE for ShinaCare Core Platform.*
