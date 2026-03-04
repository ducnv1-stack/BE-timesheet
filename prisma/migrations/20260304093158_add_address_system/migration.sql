-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "province_id" UUID,
ADD COLUMN     "ward_id" UUID;

-- CreateTable
CREATE TABLE "provinces" (
    "id" UUID NOT NULL,
    "api_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "provinces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wards" (
    "id" UUID NOT NULL,
    "province_id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "wards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provinces_api_id_key" ON "provinces"("api_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wards" ADD CONSTRAINT "wards_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
