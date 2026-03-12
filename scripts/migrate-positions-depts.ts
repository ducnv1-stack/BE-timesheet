import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Bắt đầu Migration dữ liệu Chức vụ & Phòng ban ---');

    // 1. Lấy danh sách nhân viên hiện tại
    const employees = await prisma.employee.findMany({
        select: {
            id: true,
            position: true,
            department: true,
            fullName: true,
        },
    });

    // 2. Thu thập danh sách duy nhất
    const uniquePositions = Array.from(new Set(employees.map(e => e.position).filter(Boolean)));
    const uniqueDepartments = Array.from(new Set(employees.map(e => e.department).filter(Boolean)));

    console.log(`Tìm thấy ${uniquePositions.length} chức vụ và ${uniqueDepartments.length} phòng ban.`);

    // 3. Tạo Phòng ban
    const deptMap = new Map<string, string>();
    for (const deptName of uniqueDepartments) {
        const dept = await prisma.department.upsert({
            where: { name: deptName! },
            update: {},
            create: { name: deptName! },
        });
        deptMap.set(deptName!, dept.id);
    }

    // 4. Tạo Chính sách mặc định
    const defaultPolicy = await prisma.attendancePolicy.upsert({
        where: { name: 'Chính sách Mẫu' },
        update: {},
        create: {
            name: 'Chính sách Mẫu',
            note: 'Chính sách mặc định cho các chức vụ chưa được phân loại',
        },
    });

    // Tạo các ngày cho chính sách mẫu
    const days = [0, 1, 2, 3, 4, 5, 6];
    for (const d of days) {
        await prisma.attendancePolicyDay.upsert({
            where: {
                attendancePolicyId_dayOfWeek: {
                    attendancePolicyId: defaultPolicy.id,
                    dayOfWeek: d
                }
            },
            update: {},
            create: {
                attendancePolicyId: defaultPolicy.id,
                dayOfWeek: d,
                startTime: (d >= 1 && d <= 5) ? '08:00' : (d === 6 ? '08:00' : '00:00'),
                endTime: (d >= 1 && d <= 5) ? '17:30' : (d === 6 ? '12:00' : '00:00'),
                isOff: d === 0,
                workCount: (d >= 1 && d <= 5) ? 1.0 : (d === 6 ? 0.5 : 0.0),
                requireGPS: d !== 0
            }
        });
    }

    // 5. Tạo Chức vụ & Gán chính sách mẫu
    const posMap = new Map<string, string>();
    for (const posName of uniquePositions) {
        const pos = await prisma.position.upsert({
            where: { name: posName! },
            update: {},
            create: { 
                name: posName!,
                attendancePolicyId: defaultPolicy.id
            },
        });
        posMap.set(posName!, pos.id);
    }

    // 6. Cập nhật nhân viên
    console.log('Đang cập nhật mã ID mới cho nhân viên...');
    let updatedCount = 0;
    for (const emp of employees) {
        const positionId = posMap.get(emp.position);
        const departmentId = emp.department ? deptMap.get(emp.department) : undefined;

        await prisma.employee.update({
            where: { id: emp.id },
            data: {
                positionId,
                departmentId,
            }
        });
        updatedCount++;
    }

    console.log(`--- Hoàn tất Migration! Đã cập nhật ${updatedCount} nhân viên. ---`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
