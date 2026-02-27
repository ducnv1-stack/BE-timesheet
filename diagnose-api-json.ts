import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Re-implement the logic briefly to see what the returned object looks like
async function test() {
    const [revResult, ordersCount, employeesCount] = await Promise.all([
        prisma.order.aggregate({
            _sum: { totalAmount: true }
        }),
        prisma.order.count(),
        prisma.employee.count({
            where: { status: 'Đang làm việc' }
        })
    ]);

    const totalRevenue = Number(revResult._sum.totalAmount || 0);

    const result = {
        role: 'DIRECTOR',
        totalRevenue: totalRevenue,
        totalOrders: Number(ordersCount),
        activeEmployees: Number(employeesCount),
    };

    console.log('--- EXPECTED BACKEND RESPONSE ---');
    console.log(JSON.stringify(result, null, 2));
}

test().catch(console.error).finally(() => prisma.$disconnect());
