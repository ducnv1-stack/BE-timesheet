-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "old_order_code" TEXT,
ADD COLUMN     "old_order_id" UUID;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_old_order_id_fkey" FOREIGN KEY ("old_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
