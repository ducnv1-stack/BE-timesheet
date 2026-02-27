/*
  Warnings:

  - A unique constraint covering the columns `[id_card_number]` on the table `employees` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "birth_month" INTEGER,
ADD COLUMN     "birthday" DATE,
ADD COLUMN     "contract_signing_date" DATE,
ADD COLUMN     "contract_type" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "id_card_number" TEXT,
ADD COLUMN     "join_date" DATE,
ADD COLUMN     "permanent_address" TEXT,
ADD COLUMN     "social_insurance_number" TEXT,
ADD COLUMN     "status" TEXT,
ADD COLUMN     "working_type" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "employees_id_card_number_key" ON "employees"("id_card_number");
