-- Staff contact phone: one optional column on the existing customers table (additive, nullable).
ALTER TABLE "accounts"."customers" ADD COLUMN "phone" VARCHAR(20);
