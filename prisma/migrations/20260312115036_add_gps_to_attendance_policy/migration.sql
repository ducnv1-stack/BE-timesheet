-- AlterTable
ALTER TABLE "attendance_policies" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "radius" INTEGER DEFAULT 200;
