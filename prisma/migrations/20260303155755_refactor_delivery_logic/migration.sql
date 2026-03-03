-- DropForeignKey
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_driver_id_fkey";

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "category" TEXT,
ADD COLUMN     "role" TEXT DEFAULT 'DRIVER',
ALTER COLUMN "driver_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
