-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "confirmed_by_id" UUID,
ADD COLUMN     "is_payment_confirmed" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
