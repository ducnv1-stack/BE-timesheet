-- DropForeignKey
ALTER TABLE "attendances" DROP CONSTRAINT "attendances_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing_salary_rules" DROP CONSTRAINT "marketing_salary_rules_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "monthly_attendance_summaries" DROP CONSTRAINT "monthly_attendance_summaries_employee_id_fkey";

-- DropForeignKey
ALTER TABLE "order_splits" DROP CONSTRAINT "order_splits_employee_id_fkey";

-- AddForeignKey
ALTER TABLE "order_splits" ADD CONSTRAINT "order_splits_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_salary_rules" ADD CONSTRAINT "marketing_salary_rules_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_attendance_summaries" ADD CONSTRAINT "monthly_attendance_summaries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
