-- CreateTable
CREATE TABLE "delivery_fee_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID,
    "delivery_category" TEXT NOT NULL,
    "fee_amount" DECIMAL(20,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "delivery_fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_fee_rules_branch_id_delivery_category_key" ON "delivery_fee_rules"("branch_id", "delivery_category");

-- AddForeignKey
ALTER TABLE "delivery_fee_rules" ADD CONSTRAINT "delivery_fee_rules_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: Default delivery fee rules (branchId = NULL = all branches)
INSERT INTO "delivery_fee_rules" ("id", "branch_id", "delivery_category", "fee_amount", "is_active") VALUES
    (gen_random_uuid(), NULL, 'COMPANY_DRIVER', 50000, true),
    (gen_random_uuid(), NULL, 'EXTERNAL_DRIVER', 0, true),
    (gen_random_uuid(), NULL, 'STAFF_DELIVERER', 70000, true),
    (gen_random_uuid(), NULL, 'SELLING_SALE', 100000, true),
    (gen_random_uuid(), NULL, 'OTHER_SALE', 200000, true);

-- Seed: Override for branch 131HD (SELLING_SALE = 0)
INSERT INTO "delivery_fee_rules" ("id", "branch_id", "delivery_category", "fee_amount", "is_active")
    SELECT gen_random_uuid(), b.id, 'SELLING_SALE', 0, true
    FROM "branches" b WHERE b.code = '131HD';

-- Seed: Override for branch 258HD (SELLING_SALE = 0)
INSERT INTO "delivery_fee_rules" ("id", "branch_id", "delivery_category", "fee_amount", "is_active")
    SELECT gen_random_uuid(), b.id, 'SELLING_SALE', 0, true
    FROM "branches" b WHERE b.code = '258HD';
