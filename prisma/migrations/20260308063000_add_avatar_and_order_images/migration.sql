-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "avatar_url" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "images" TEXT[] DEFAULT ARRAY[]::TEXT[];
