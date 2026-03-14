-- AlterTable
ALTER TABLE "attendance_policies" ADD COLUMN     "config_data" JSONB;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
