-- AddForeignKey
ALTER TABLE "ingestion"."ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "sourcing"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
