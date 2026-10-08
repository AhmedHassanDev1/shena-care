ALTER TABLE "ordering"."orders" ADD COLUMN "applied_promotions" JSONB;
ALTER TABLE "ordering"."order_items" ADD COLUMN "applied_promotions" JSONB;
