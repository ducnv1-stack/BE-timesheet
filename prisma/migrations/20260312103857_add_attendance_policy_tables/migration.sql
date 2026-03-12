-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "attendance_policy_day_id" UUID;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "department_id" UUID,
ADD COLUMN     "position_id" UUID;

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "attendance_policy_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_policies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_policy_days" (
    "id" UUID NOT NULL,
    "attendance_policy_id" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_off" BOOLEAN NOT NULL DEFAULT false,
    "allow_ot" BOOLEAN NOT NULL DEFAULT false,
    "ot_multiplier" DECIMAL(3,2) NOT NULL DEFAULT 1.5,
    "require_gps" BOOLEAN NOT NULL DEFAULT true,
    "work_count" DECIMAL(3,2) NOT NULL DEFAULT 1.0,

    CONSTRAINT "attendance_policy_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "positions_name_key" ON "positions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_policies_name_key" ON "attendance_policies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_policy_days_attendance_policy_id_dayOfWeek_key" ON "attendance_policy_days"("attendance_policy_id", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_attendance_policy_id_fkey" FOREIGN KEY ("attendance_policy_id") REFERENCES "attendance_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_policy_days" ADD CONSTRAINT "attendance_policy_days_attendance_policy_id_fkey" FOREIGN KEY ("attendance_policy_id") REFERENCES "attendance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_attendance_policy_day_id_fkey" FOREIGN KEY ("attendance_policy_day_id") REFERENCES "attendance_policy_days"("id") ON DELETE SET NULL ON UPDATE CASCADE;
