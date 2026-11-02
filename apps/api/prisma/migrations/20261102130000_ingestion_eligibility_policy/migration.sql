CREATE TABLE "ingestion"."eligibility_policies" (
  "id" UUID NOT NULL,
  "version" INTEGER,
  "base_version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREVIEW',
  "document" JSONB NOT NULL,
  "impact" JSONB NOT NULL,
  "actor_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMP(3),
  CONSTRAINT "eligibility_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "eligibility_policy_state" CHECK (
    ("status" = 'PREVIEW' AND "version" IS NULL AND "approved_at" IS NULL) OR
    ("status" = 'APPROVED' AND "version" > 0 AND "approved_at" IS NOT NULL)),
  CONSTRAINT "eligibility_policy_reason" CHECK (length(trim("reason")) >= 5)
);
CREATE UNIQUE INDEX "eligibility_policies_version_key" ON "ingestion"."eligibility_policies"("version");
CREATE INDEX "eligibility_policies_status_version_idx" ON "ingestion"."eligibility_policies"("status", "version");
ALTER TABLE "ingestion"."ingestion_jobs" ADD COLUMN "eligibility_policy_id" UUID;
CREATE INDEX "ingestion_jobs_eligibility_policy_id_idx" ON "ingestion"."ingestion_jobs"("eligibility_policy_id");
ALTER TABLE "ingestion"."ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_eligibility_policy_id_fkey"
  FOREIGN KEY ("eligibility_policy_id") REFERENCES "ingestion"."eligibility_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Protect audit snapshots even if a future application command accidentally attempts mutation.
CREATE FUNCTION "ingestion"."protect_eligibility_policy"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'APPROVED' THEN
    RAISE EXCEPTION 'Eligibility policy snapshots are immutable';
  END IF;
  IF NEW.document IS DISTINCT FROM OLD.document OR NEW.impact IS DISTINCT FROM OLD.impact
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.base_version IS DISTINCT FROM OLD.base_version OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Only preview approval is permitted';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "protect_eligibility_policy" BEFORE UPDATE OR DELETE ON "ingestion"."eligibility_policies"
  FOR EACH ROW EXECUTE FUNCTION "ingestion"."protect_eligibility_policy"();
