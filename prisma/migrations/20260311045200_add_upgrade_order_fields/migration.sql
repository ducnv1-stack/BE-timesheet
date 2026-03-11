-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "is_upgrade" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "old_order_amount" DECIMAL(20,2),
ADD COLUMN     "old_order_date" DATE,
ADD COLUMN     "old_order_product_name" TEXT;
