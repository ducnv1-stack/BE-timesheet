-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "custom_allowance" DECIMAL(20,2),
ADD COLUMN     "custom_diligent_salary" DECIMAL(20,2);

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "allowance" DECIMAL(20,2),
ADD COLUMN     "diligent_salary" DECIMAL(20,2);
