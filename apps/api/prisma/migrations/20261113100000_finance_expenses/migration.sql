-- CreateTable
CREATE TABLE "operations"."finance_expenses" (
    "id" UUID NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
    "incurred_on" DATE NOT NULL,
    "recurrence" VARCHAR(10) NOT NULL DEFAULT 'NONE',
    "ends_on" DATE,
    "recorded_by" TEXT NOT NULL,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_expenses_incurred_on_idx" ON "operations"."finance_expenses"("incurred_on");
