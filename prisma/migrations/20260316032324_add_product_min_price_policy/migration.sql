-- CreateTable
CREATE TABLE "product_min_price_policies" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "min_price" DECIMAL(20,2) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_min_price_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_min_price_policies_product_id_start_date_end_date_idx" ON "product_min_price_policies"("product_id", "start_date", "end_date");

-- AddForeignKey
ALTER TABLE "product_min_price_policies" ADD CONSTRAINT "product_min_price_policies_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
