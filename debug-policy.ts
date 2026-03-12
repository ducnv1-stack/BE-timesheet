import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    
    // Tìm nhân viên Đặng Viết Hoàng - dùng query linh hoạt hơn
    const employees = await prisma.employee.findMany({
        where: {
            OR: [
                { fullName: { contains: 'Đặng Viết Hoàng' } },
                { fullName: { contains: 'Dang Viet Hoang' } }
            ]
        },
        include: {
            pos: {
                include: { attendancePolicy: true }
            }
        }
    });

    console.log('--- KẾT QUẢ TÌM KIẾM NHÂN VIÊN ---');
    console.log(JSON.stringify(employees, null, 2));
    
    await prisma.$disconnect();
}

main().catch(console.error);
