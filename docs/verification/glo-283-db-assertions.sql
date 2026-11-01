-- Read-only assertions. Run only on the isolated *_test database used for verification.
SELECT count(*) AS overconfirmed_allocations
FROM sourcing.source_allocations WHERE confirmed_quantity > allocated_quantity OR confirmed_quantity < 0;

SELECT count(*) AS overcommitted_requirements FROM (
  SELECT requirement.id FROM sourcing.supply_requirements requirement
  JOIN sourcing.source_allocations allocation ON allocation.requirement_id = requirement.id
  WHERE requirement.released_at IS NULL
  GROUP BY requirement.id, requirement.required_quantity
  HAVING sum(CASE WHEN allocation.result = 'pending' THEN allocation.allocated_quantity ELSE allocation.confirmed_quantity END) > requirement.required_quantity
) violations;

SELECT count(*) AS competing_pending_requirements FROM (
  SELECT requirement_id FROM sourcing.source_allocations WHERE result = 'pending'
  GROUP BY requirement_id HAVING count(*) > 1
) violations;

SELECT count(*) AS expired_po_pending_allocations
FROM sourcing.source_allocations a
JOIN sourcing.purchase_order_line_allocations link ON link.source_allocation_id = a.id
JOIN sourcing.purchase_order_lines line ON line.id = link.purchase_order_line_id
JOIN sourcing.supplier_purchase_orders po ON po.id = line.purchase_order_id
WHERE po.status = 'expired' AND a.result = 'pending';

SELECT count(*) AS broken_aggregated_line_quantities FROM (
  SELECT line.id FROM sourcing.purchase_order_lines line
  JOIN sourcing.purchase_order_line_allocations link ON link.purchase_order_line_id = line.id
  GROUP BY line.id, line.requested_quantity HAVING sum(link.quantity) <> line.requested_quantity
) violations;

-- Local synthetic backend processing latency, not real supplier response latency.
WITH samples AS (
  SELECT po.id, extract(epoch FROM (po.issued_at - previous.answered_at)) * 1000 AS ms
  FROM sourcing.source_allocations newer
  JOIN sourcing.purchase_order_line_allocations link ON link.source_allocation_id = newer.id
  JOIN sourcing.purchase_order_lines line ON line.id = link.purchase_order_line_id
  JOIN sourcing.supplier_purchase_orders po ON po.id = line.purchase_order_id
  JOIN LATERAL (
    SELECT max(older.confirmed_at) AS answered_at FROM sourcing.source_allocations older
    WHERE older.requirement_id = newer.requirement_id AND older.id <> newer.id
      AND older.result IN ('unavailable', 'confirmed_partial', 'price_changed')
      AND older.confirmed_at <= po.issued_at
  ) previous ON previous.answered_at IS NOT NULL
  WHERE po.expedited
)
SELECT count(*) AS sample_count, min(ms) AS min_ms,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) AS p95_ms, max(ms) AS max_ms
FROM (SELECT id, max(ms) AS ms FROM samples GROUP BY id) unique_expedited_pos;
