-- GLO-285: the cross-supplier candidate sweep scanned every open row's JSON per classified row, so a large file was quadratic.
-- Additive indexes only. No data changes. Rollback: DROP INDEX each one; the sweep still works, only slower.
CREATE INDEX "ingestion_items_barcode_idx" ON "ingestion"."ingestion_items" ("barcode") WHERE "barcode" IS NOT NULL;
CREATE INDEX "ingestion_items_source_fingerprint_idx" ON "ingestion"."ingestion_items" (("enrichment" #>> '{source,fingerprint}'));
CREATE INDEX "ingestion_items_identity_fingerprint_idx" ON "ingestion"."ingestion_items" (("enrichment" #>> '{identity,fingerprint}'));
CREATE INDEX "ingestion_items_open_brand_size_idx" ON "ingestion"."ingestion_items" (
  lower("brand"), ("enrichment" #>> '{source,normalized,extractedSize}'), ("enrichment" #>> '{source,normalized,extractedUnit}'), "created_at", "id"
) WHERE "status" IN ('pending', 'review_required', 'approved');
