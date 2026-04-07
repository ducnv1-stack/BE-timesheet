-- CreateEnum
CREATE TYPE "AllowanceType" AS ENUM ('DAILY', 'MONTHLY');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "custom_lunch_allowance_type" "AllowanceType" DEFAULT 'DAILY';

-- AlterTable
ALTER TABLE "positions" ADD COLUMN     "lunch_allowance_type" "AllowanceType" NOT NULL DEFAULT 'DAILY';
