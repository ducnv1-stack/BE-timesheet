-- AlterTable
ALTER TABLE "attendance_policy_days" ADD COLUMN     "has_shifts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shift1_end_time" TEXT,
ADD COLUMN     "shift1_work_count" DECIMAL(3,2) NOT NULL DEFAULT 0.5,
ADD COLUMN     "shift2_start_time" TEXT,
ADD COLUMN     "shift2_work_count" DECIMAL(3,2) NOT NULL DEFAULT 0.5;
