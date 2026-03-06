import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 Bắt đầu quá trình chuyển đổi username sang Số điện thoại...');

    // 1. Lấy danh sách nhân viên có tài khoản và có số điện thoại
    const employees = await prisma.employee.findMany({
        where: {
            userId: { not: null },
            phone: { not: null },
        },
        include: {
            user: true,
        },
    });

    console.log(`📊 Tìm thấy ${employees.length} nhân viên đủ điều kiện chuyển đổi.`);

    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const employee of employees) {
        const newUsername = employee.phone?.trim();
        const currentUserId = employee.userId!;
        const currentUsername = employee.user?.username;

        if (!newUsername) {
            skippedCount++;
            continue;
        }

        // Nếu username đã là số điện thoại rồi thì bỏ qua
        if (currentUsername === newUsername) {
            console.log(`⏩ Bỏ qua: Nhân viên ${employee.fullName} đã có username là SĐT (${newUsername}).`);
            skippedCount++;
            continue;
        }

        try {
            // 2. Kiểm tra xem SĐT này đã bị tài khoản KHÁC sử dụng chưa
            const existingUser = await prisma.user.findUnique({
                where: { username: newUsername },
            });

            if (existingUser && existingUser.id !== currentUserId) {
                console.warn(`⚠️ Cảnh báo: Số điện thoại ${newUsername} (của ${employee.fullName}) đã được sử dụng bởi tài khoản khác (ID: ${existingUser.id}). Bỏ qua.`);
                skippedCount++;
                continue;
            }

            // 3. Cập nhật username
            await prisma.user.update({
                where: { id: currentUserId },
                data: { username: newUsername },
            });

            console.log(`✅ Thành công: ${employee.fullName} (${currentUsername} -> ${newUsername})`);
            successCount++;
        } catch (error: any) {
            console.error(`❌ Lỗi khi cập nhật cho ${employee.fullName}:`, error.message);
            errorCount++;
        }
    }

    console.log('\n--- KẾT QUẢ ---');
    console.log(`✅ Thành công: ${successCount}`);
    console.log(`⏩ Bỏ qua: ${skippedCount}`);
    console.log(`❌ Lỗi: ${errorCount}`);
    console.log('---------------');
}

main()
    .catch((e) => {
        console.error('💥 Lỗi nghiêm trọng khi chạy script:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
