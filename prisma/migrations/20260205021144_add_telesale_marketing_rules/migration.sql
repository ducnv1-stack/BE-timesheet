/*
  Warnings:

  - You are about to alter the column `revenue_threshold` on the `marketing_salary_rules` table. The data in that column could be lost. The data in that column will be cast from `Decimal(20,2)` to `Decimal(20,0)`.
  - Added the required column `employee_id` to the `marketing_salary_rules` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "marketing_salary_rules" ADD COLUMN     "employee_id" UUID NOT NULL,
ALTER COLUMN "revenue_threshold" SET DATA TYPE DECIMAL(20,0);

-- AddForeignKey
ALTER TABLE "marketing_salary_rules" ADD CONSTRAINT "marketing_salary_rules_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
