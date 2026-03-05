import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Seeding Attendance Configuration ---');

    // 1. Cập nhật GPS mẫu cho các chi nhánh (Ví dụ tọa độ tại Hà Nội)
    const branches = await prisma.branch.findMany();
    for (const branch of branches) {
        if (!branch.latitude) {
            // Tọa độ giả định cho các chi nhánh nếu chưa có
            // Bạn có thể yêu cầu Admin cập nhật tọa độ thực tế qua giao diện sau
            await prisma.branch.update({
                where: { id: branch.id },
                data: {
                    latitude: 21.028511, // Ví dụ: Hồ Hoàn Kiếm, Hà Nội
                    longitude: 105.852447,
                    checkinRadius: 70,
                },
            });
            console.log(`Updated GPS for branch: ${branch.name}`);
        }
    }

    // 2. Tạo Ca làm việc mẫu cho từng chi nhánh
    for (const branch of branches) {
        const existingShift = await prisma.workShift.findFirst({
            where: { branchId: branch.id }
        });

        if (!existingShift) {
            await prisma.workShift.create({
                data: {
                    branchId: branch.id,
                    name: 'Ca hành chính',
                    startTime: '08:00',
                    endTime: '17:30',
                    breakMinutes: 90,
                    lateThreshold: 15,
                    lateSeriousThreshold: 30,
                    earlyLeaveThreshold: 15,
                    isActive: true,
                }
            });
            console.log(`Created default shift for branch: ${branch.name}`);
        }
    }

    // 3. Tạo cấu hình tăng ca mẫu
    const overtimeConfigs = [
        { name: 'Tăng ca ngày thường', overtimeType: 'WEEKDAY', multiplier: 1.5 },
        { name: 'Tăng ca cuối tuần', overtimeType: 'WEEKEND', multiplier: 2.0 },
        { name: 'Tăng ca ngày lễ', overtimeType: 'HOLIDAY', multiplier: 3.0 },
    ];

    for (const config of overtimeConfigs) {
        const existing = await prisma.overtimeConfig.findFirst({
            where: { overtimeType: config.overtimeType }
        });
        if (!existing) {
            await prisma.overtimeConfig.create({
                data: {
                    ...config,
                    minOvertimeMinutes: 30,
                    maxOvertimeMinutes: 240,
                    isActive: true,
                }
            });
            console.log(`Created overtime config: ${config.name}`);
        }
    }

    console.log('--- Seeding Completed ---');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
