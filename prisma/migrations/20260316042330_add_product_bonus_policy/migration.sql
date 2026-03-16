-- CreateTable
CREATE TABLE "product_bonus_policies" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_bonus_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_bonus_policies_product_id_start_date_end_date_idx" ON "product_bonus_policies"("product_id", "start_date", "end_date");

-- AddForeignKey
ALTER TABLE "product_bonus_policies" ADD CONSTRAINT "product_bonus_policies_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 1: Add NULLABLE policy_id to product_bonus_rules
ALTER TABLE "product_bonus_rules" ADD COLUMN "policy_id" UUID;

-- Step 2: Create a default policy for each product that currently has rules
-- Use internal MD5 cast to UUID which is widely supported in Postgres if gen_random_uuid is missing
INSERT INTO "product_bonus_policies" ("id", "product_id", "name", "start_date", "created_at")
SELECT DISTINCT md5(random()::text || clock_timestamp()::text)::uuid, "product_id", 'Chính sách mặc định', '2000-01-01'::DATE, CURRENT_TIMESTAMP
FROM "product_bonus_rules";

-- Step 3: Link existing rules to the newly created policies
UPDATE "product_bonus_rules" r
SET "policy_id" = p."id"
FROM "product_bonus_policies" p
WHERE r."product_id" = p."product_id" AND p."name" = 'Chính sách mặc định';

-- Step 4: DropForeignKey
ALTER TABLE "product_bonus_rules" DROP CONSTRAINT "product_bonus_rules_product_id_fkey";

-- Step 5: Make policy_id NOT NULL and Drop product_id
ALTER TABLE "product_bonus_rules" ALTER COLUMN "policy_id" SET NOT NULL;
ALTER TABLE "product_bonus_rules" DROP COLUMN "product_id";

-- AddForeignKey for policy_id
ALTER TABLE "product_bonus_rules" ADD CONSTRAINT "product_bonus_rules_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "product_bonus_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
