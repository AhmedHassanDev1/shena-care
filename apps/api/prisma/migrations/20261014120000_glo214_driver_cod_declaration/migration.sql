-- GLO-214 (W22): the driver's cash declaration at delivery, kept apart from the hub-counted amount.
ALTER TABLE "ordering"."payment_collections"
  ADD COLUMN "declared_amount" DECIMAL(10,2),
  ADD COLUMN "declared_at" TIMESTAMP(3);
