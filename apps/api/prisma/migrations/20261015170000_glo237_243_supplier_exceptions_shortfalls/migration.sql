-- GLO-237 red team / GLO-243: typed supplier line exceptions and attributable receiving shortfalls.
-- AlterTable
ALTER TABLE "sourcing"."purchase_order_line_allocations" ADD COLUMN     "short_quantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sourcing"."purchase_order_lines" ADD COLUMN     "exception_code" VARCHAR(40),
ADD COLUMN     "exception_note" TEXT,
ADD COLUMN     "proposed_quantity" INTEGER,
ADD COLUMN     "proposed_unit_cost" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "sourcing"."receiving_shortfalls" (
    "id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason_code" VARCHAR(40) NOT NULL,
    "notes" TEXT,
    "actor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receiving_shortfalls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receiving_shortfalls_link_id_idx" ON "sourcing"."receiving_shortfalls"("link_id");

-- AddForeignKey
ALTER TABLE "sourcing"."receiving_shortfalls" ADD CONSTRAINT "receiving_shortfalls_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "sourcing"."purchase_order_line_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


