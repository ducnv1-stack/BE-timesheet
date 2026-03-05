-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "checkin_radius" INTEGER NOT NULL DEFAULT 70,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "work_shifts" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "late_threshold" INTEGER NOT NULL DEFAULT 15,
    "late_serious_threshold" INTEGER NOT NULL DEFAULT 30,
    "early_leave_threshold" INTEGER NOT NULL DEFAULT 15,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "work_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "shift_id" UUID,
    "date" DATE NOT NULL,
    "check_in_time" TIMESTAMP(3),
    "check_in_latitude" DOUBLE PRECISION,
    "check_in_longitude" DOUBLE PRECISION,
    "check_in_distance" DOUBLE PRECISION,
    "check_in_status" TEXT,
    "check_in_method" TEXT,
    "check_in_attempts" INTEGER NOT NULL DEFAULT 0,
    "max_check_in_attempts" INTEGER NOT NULL DEFAULT 3,
    "check_out_time" TIMESTAMP(3),
    "check_out_latitude" DOUBLE PRECISION,
    "check_out_longitude" DOUBLE PRECISION,
    "check_out_distance" DOUBLE PRECISION,
    "check_out_status" TEXT,
    "check_out_method" TEXT,
    "daily_status" TEXT NOT NULL DEFAULT 'ABSENT_UNAPPROVED',
    "total_work_minutes" INTEGER,
    "overtime_minutes" INTEGER,
    "late_minutes" INTEGER,
    "early_leave_minutes" INTEGER,
    "note" TEXT,
    "is_manual_override" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overtime_configs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "overtime_type" TEXT NOT NULL,
    "multiplier" DECIMAL(3,1) NOT NULL,
    "min_overtime_minutes" INTEGER NOT NULL DEFAULT 30,
    "max_overtime_minutes" INTEGER NOT NULL DEFAULT 240,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "overtime_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_attendance_summaries" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "total_work_days" INTEGER NOT NULL DEFAULT 0,
    "full_days" INTEGER NOT NULL DEFAULT 0,
    "half_days" INTEGER NOT NULL DEFAULT 0,
    "absent_approved" INTEGER NOT NULL DEFAULT 0,
    "absent_unapproved" INTEGER NOT NULL DEFAULT 0,
    "late_days" INTEGER NOT NULL DEFAULT 0,
    "total_late_minutes" INTEGER NOT NULL DEFAULT 0,
    "early_leave_days" INTEGER NOT NULL DEFAULT 0,
    "total_overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "total_work_minutes" INTEGER NOT NULL DEFAULT 0,
    "effective_work_days" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_attendance_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendances_employee_id_date_idx" ON "attendances"("employee_id", "date");

-- CreateIndex
CREATE INDEX "attendances_branch_id_date_idx" ON "attendances"("branch_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendances_employee_id_date_key" ON "attendances"("employee_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_attendance_summaries_employee_id_month_year_key" ON "monthly_attendance_summaries"("employee_id", "month", "year");

-- AddForeignKey
ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "work_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_attendance_summaries" ADD CONSTRAINT "monthly_attendance_summaries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
