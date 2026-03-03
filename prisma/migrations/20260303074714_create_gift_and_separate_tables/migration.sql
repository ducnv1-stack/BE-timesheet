-- AlterTable
ALTER TABLE "products" ADD COLUMN     "hot_bonus" DECIMAL(20,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "gifts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_gifts" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "gift_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "order_gifts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "order_gifts" ADD CONSTRAINT "order_gifts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_gifts" ADD CONSTRAINT "order_gifts_gift_id_fkey" FOREIGN KEY ("gift_id") REFERENCES "gifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
