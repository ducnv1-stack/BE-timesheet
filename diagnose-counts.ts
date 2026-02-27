import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const totalOrders = await prisma.order.count();
    const totalRevenue = await prisma.order.aggregate({
        _sum: { totalAmount: true }
    });

    const employeeStatuses = await prisma.employee.groupBy({
        by: ['status'],
        _count: { _all: true }
    });

    const allEmployees = await prisma.employee.count();

    console.log('--- DATABASE DIAGNOSIS ---');
    console.log('Total Orders (count):', totalOrders);
    console.log('Total Revenue (sum):', totalRevenue._sum.totalAmount);
    console.log('Total Employees (total):', allEmployees);
    console.log('Employee Status Breakdown:', JSON.stringify(employeeStatuses, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
