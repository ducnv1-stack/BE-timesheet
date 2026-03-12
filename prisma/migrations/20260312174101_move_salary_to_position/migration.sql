-- AlterTable
ALTER TABLE "positions" ADD COLUMN     "allowance" DECIMAL(20,2),
ADD COLUMN     "base_salary" DECIMAL(20,2),
ADD COLUMN     "diligent_salary" DECIMAL(20,2),
ADD COLUMN     "standard_working_days" INTEGER;
