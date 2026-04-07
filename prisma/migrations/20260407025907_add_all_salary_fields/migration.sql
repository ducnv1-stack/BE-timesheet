-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "custom_lunch_allowance" DECIMAL(20,2),
ADD COLUMN     "custom_technical_allowance" DECIMAL(20,2),
ADD COLUMN     "custom_travel_allowance" DECIMAL(20,2);

-- AlterTable
ALTER TABLE "positions" ADD COLUMN     "lunch_allowance" DECIMAL(20,2),
ADD COLUMN     "technical_allowance" DECIMAL(20,2),
ADD COLUMN     "travel_allowance" DECIMAL(20,2);
