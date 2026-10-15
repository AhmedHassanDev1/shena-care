-- GLO-231: who confirmed the delivery pin, and when. Coordinates already exist on orders.
ALTER TABLE "ordering"."orders"
  ADD COLUMN "location_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "location_confirmed_by" TEXT;
