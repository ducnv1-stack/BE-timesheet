import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const [revResult, ordersCount, employeesCount] = await Promise.all([
        prisma.order.aggregate({
            _sum: { totalAmount: true }
        }),
        prisma.order.count(),
        prisma.employee.count({
            where: { status: 'Đang làm việc' }
        })
    ]);

    console.log({
        role: 'DIRECTOR',
        totalRevenue: Number(revResult._sum.totalAmount || 0),
        totalOrders: Number(ordersCount),
        activeEmployees: Number(employeesCount),
    });
}

main().catch(console.error).finally(() => prisma.$disconnect());
