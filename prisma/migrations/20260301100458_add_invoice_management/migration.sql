-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "invoice_issued_at" TIMESTAMP(3),
ADD COLUMN     "invoice_issued_by_id" UUID,
ADD COLUMN     "is_invoice_issued" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_invoice_issued_by_id_fkey" FOREIGN KEY ("invoice_issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
