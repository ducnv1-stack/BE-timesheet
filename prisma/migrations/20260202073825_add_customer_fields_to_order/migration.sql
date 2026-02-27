-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customer_card_issue_date" DATE,
ADD COLUMN     "customer_card_number" TEXT,
ADD COLUMN     "staff_code" TEXT;
