-- GLO-241: payment-method-aware orders and online payment attempts (no provider integration).
-- CreateEnum
CREATE TYPE "ordering"."PaymentMethod" AS ENUM ('COD', 'CARD', 'MOBILE_WALLET');

-- CreateEnum
CREATE TYPE "ordering"."PaymentAttemptStatus" AS ENUM ('pending', 'confirmed', 'failed');

-- AlterTable
ALTER TABLE "ordering"."orders" ADD COLUMN     "payment_method" "ordering"."PaymentMethod" NOT NULL DEFAULT 'COD',
ADD COLUMN     "payment_provider" VARCHAR(40);

-- CreateTable
CREATE TABLE "ordering"."payment_attempts" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method" "ordering"."PaymentMethod" NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "reference" VARCHAR(64) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "ordering"."PaymentAttemptStatus" NOT NULL DEFAULT 'pending',
    "provider_transaction_id" VARCHAR(128),
    "failure_reason" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordering"."payment_provider_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_event_id" VARCHAR(128) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "reference" VARCHAR(64),
    "outcome" VARCHAR(20) NOT NULL,
    "detail" TEXT,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_reference_key" ON "ordering"."payment_attempts"("reference");

-- CreateIndex
CREATE INDEX "payment_attempts_order_id_idx" ON "ordering"."payment_attempts"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_events_provider_provider_event_id_key" ON "ordering"."payment_provider_events"("provider", "provider_event_id");

-- AddForeignKey
ALTER TABLE "ordering"."payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ordering"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one confirmed online payment per order.
CREATE UNIQUE INDEX "payment_attempts_one_confirmed_per_order" ON "ordering"."payment_attempts"("order_id") WHERE "status" = 'confirmed';
