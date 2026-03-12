
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log('--- BẮT ĐẦU XÓA DỮ LIỆU CHẤM CÔNG ---');
    
    try {
        // 1. Xóa dữ liệu bảng chấm công hàng ngày
        const attendanceCount = await prisma.attendance.deleteMany({});
        console.log(`✅ Đã xóa ${attendanceCount.count} bản ghi trong bảng Attendance (Chấm công hàng ngày).`);

        // 2. Xóa dữ liệu bảng tổng hợp công tháng
        const summaryCount = await prisma.monthlyAttendanceSummary.deleteMany({});
        console.log(`✅ Đã xóa ${summaryCount.count} bản ghi trong bảng MonthlyAttendanceSummary (Tổng hợp công tháng).`);

        // 3. Xóa dữ liệu đơn xin nghỉ phép
        const leaveCount = await prisma.leaveRequest.deleteMany({});
        console.log(`✅ Đã xóa ${leaveCount.count} bản ghi trong bảng LeaveRequest (Đơn nghỉ phép).`);

        console.log('--- HOÀN TẤT XÓA DỮ LIỆU ---');
    } catch (error) {
        console.error('❌ Lỗi khi xóa dữ liệu:', error);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
