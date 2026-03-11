-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "old_order_customer_address" TEXT,
ADD COLUMN     "old_order_customer_card_issue_date" TEXT,
ADD COLUMN     "old_order_customer_card_number" TEXT,
ADD COLUMN     "old_order_customer_name" TEXT,
ADD COLUMN     "old_order_customer_phone" TEXT,
ADD COLUMN     "old_order_province_id" UUID,
ADD COLUMN     "old_order_ward_id" UUID,
ALTER COLUMN "old_order_date" SET DATA TYPE TEXT;
