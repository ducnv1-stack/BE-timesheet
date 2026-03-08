-- AlterTable
ALTER TABLE "employees" ADD COLUMN "avatar_url" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "images" TEXT[] DEFAULT ARRAY[]::TEXT[];
