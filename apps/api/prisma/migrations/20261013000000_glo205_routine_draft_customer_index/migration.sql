-- A customer may own several routine drafts (startDraft creates one per session and guidance
-- reads the latest), as declared in schema.prisma. GLO-204 replaced the original non-unique
-- lookup index with a UNIQUE one, so a second draft or a guest-draft link failed with a 500.
DROP INDEX IF EXISTS "care"."routine_drafts_customer_id_key";

-- Restore the GLO-187 lookup index.
CREATE INDEX IF NOT EXISTS "routine_drafts_customer_id_idx" ON "care"."routine_drafts"("customer_id");
