-- Capital Partner Portal: additive only. One new role value and two new tables; no existing table, column, row or financial figure is changed.

-- The capital partner login role (read-only portal; cannot be combined with ADMIN, may be combined with HUB_OPERATOR).
ALTER TYPE "accounts"."Role" ADD VALUE 'CAPITAL_PARTNER';

-- The partner profile: which staff login is the capital partner. MVP: at most one ACTIVE partner.
CREATE TABLE "operations"."capital_partners" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capital_partners_pkey" PRIMARY KEY ("id")
);

-- Money actually paid to the partner (capital returns and profit payouts), append-only: voided, never edited.
CREATE TABLE "operations"."capital_partner_entries" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "period" VARCHAR(7),
    "reference" VARCHAR(80) NOT NULL,
    "note" VARCHAR(300),
    "idempotency_key" UUID NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,

    CONSTRAINT "capital_partner_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "capital_partners_account_id_key" ON "operations"."capital_partners"("account_id");
CREATE UNIQUE INDEX "capital_partner_entries_idempotency_key_key" ON "operations"."capital_partner_entries"("idempotency_key");
CREATE INDEX "capital_partner_entries_partner_id_paid_on_idx" ON "operations"."capital_partner_entries"("partner_id", "paid_on");
CREATE INDEX "capital_partner_entries_partner_id_kind_period_idx" ON "operations"."capital_partner_entries"("partner_id", "kind", "period");

ALTER TABLE "operations"."capital_partner_entries" ADD CONSTRAINT "capital_partner_entries_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "operations"."capital_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- MVP: exactly one active capital partner (a constant-expression partial unique index; Prisma does not model it, it only guards the table).
CREATE UNIQUE INDEX "capital_partners_single_active_idx" ON "operations"."capital_partners" ((true)) WHERE "is_active";

-- Entry integrity: a positive amount, a known kind, a month on every profit payout, and a well-formed period.
ALTER TABLE "operations"."capital_partner_entries" ADD CONSTRAINT "capital_partner_entry_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "operations"."capital_partner_entries" ADD CONSTRAINT "capital_partner_entry_kind_chk" CHECK ("kind" IN ('CAPITAL_RETURN', 'PROFIT_PAYOUT'));
ALTER TABLE "operations"."capital_partner_entries" ADD CONSTRAINT "capital_partner_entry_period_chk" CHECK ("period" IS NULL OR "period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "operations"."capital_partner_entries" ADD CONSTRAINT "capital_partner_entry_payout_period_chk" CHECK ("kind" <> 'PROFIT_PAYOUT' OR "period" IS NOT NULL);
ALTER TABLE "operations"."capital_partner_entries" ADD CONSTRAINT "capital_partner_entry_void_chk" CHECK (("voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL) OR ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL));
