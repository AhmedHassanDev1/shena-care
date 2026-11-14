-- Care intelligence: sourced knowledge base, consultation context and AI usage log.
-- Additive only: two new tables and three nullable columns. No existing row is rewritten.

ALTER TABLE "care"."guidance_sessions" ADD COLUMN "context" JSONB;
ALTER TABLE "care"."guidance_sessions" ADD COLUMN "page_context" JSONB;
ALTER TABLE "care"."guidance_messages" ADD COLUMN "payload" JSONB;

CREATE TABLE "care"."knowledge_entries" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "subject_type" VARCHAR(24) NOT NULL,
    "subject_key" VARCHAR(80) NOT NULL,
    "topic" VARCHAR(24) NOT NULL,
    "concern_slug" VARCHAR(80),
    "care_area" "care"."CareArea",
    "strength" VARCHAR(12),
    "statement_en" TEXT NOT NULL,
    "statement_ar" TEXT NOT NULL,
    "evidence_class" VARCHAR(24) NOT NULL,
    "source_title" TEXT NOT NULL,
    "source_url" TEXT,
    "source_type" VARCHAR(30) NOT NULL,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "review_status" VARCHAR(30) NOT NULL DEFAULT 'PENDING_PROFESSIONAL_REVIEW',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_entries_subject_type_check" CHECK ("subject_type" IN ('INGREDIENT', 'INGREDIENT_FAMILY', 'PRODUCT_TYPE', 'CONCERN', 'GENERAL')),
    CONSTRAINT "knowledge_entries_topic_check" CHECK ("topic" IN ('FUNCTION', 'CONCERN_RELEVANCE', 'USAGE', 'PRECAUTION', 'COMPATIBILITY', 'LIMITATION', 'ESCALATION', 'OVERVIEW')),
    CONSTRAINT "knowledge_entries_evidence_class_check" CHECK ("evidence_class" IN ('VERIFIED_FACT', 'EVIDENCE_SUPPORTED', 'INFERENCE', 'CONFLICT')),
    CONSTRAINT "knowledge_entries_review_status_check" CHECK ("review_status" IN ('AUTO_ACCEPTED', 'PENDING_PROFESSIONAL_REVIEW', 'PROFESSIONALLY_REVIEWED', 'REJECTED')),
    CONSTRAINT "knowledge_entries_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1),
    -- A statement with no source is an opinion: only an explicit ShinaCare policy may omit the URL.
    CONSTRAINT "knowledge_entries_source_check" CHECK ("source_url" IS NOT NULL OR "source_type" = 'SHINACARE_POLICY')
);

CREATE UNIQUE INDEX "knowledge_entries_key_key" ON "care"."knowledge_entries"("key");
CREATE INDEX "knowledge_entries_subject_type_subject_key_idx" ON "care"."knowledge_entries"("subject_type", "subject_key");
CREATE INDEX "knowledge_entries_concern_slug_topic_idx" ON "care"."knowledge_entries"("concern_slug", "topic");

CREATE TABLE "care"."ai_usage_events" (
    "id" UUID NOT NULL,
    "customer_id" TEXT NOT NULL,
    "session_id" UUID,
    "task" VARCHAR(40) NOT NULL,
    "model" VARCHAR(80),
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "outcome" VARCHAR(16) NOT NULL,
    "used_fallback" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_usage_events_customer_id_created_at_idx" ON "care"."ai_usage_events"("customer_id", "created_at");
CREATE INDEX "ai_usage_events_created_at_idx" ON "care"."ai_usage_events"("created_at");
