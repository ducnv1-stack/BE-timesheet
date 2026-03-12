-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "attendance_policy_id" UUID;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_attendance_policy_id_fkey" FOREIGN KEY ("attendance_policy_id") REFERENCES "attendance_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
