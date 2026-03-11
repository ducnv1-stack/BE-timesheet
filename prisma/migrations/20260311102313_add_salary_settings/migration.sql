-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "custom_base_salary" DECIMAL(20,2),
ADD COLUMN     "custom_standard_working_days" INTEGER;

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "base_salary" DECIMAL(20,2),
ADD COLUMN     "standard_working_days" INTEGER;
