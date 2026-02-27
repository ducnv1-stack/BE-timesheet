import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const employees = await prisma.employee.findMany({
        select: {
            userId: true,
            fullName: true,
        }
    });

    const orders = await prisma.order.findMany({
        select: {
            id: true,
            customerName: true,
            createdBy: true,
        },
        take: 10
    });

    console.log('--- EMPLOYEES ---');
    console.log(JSON.stringify(employees, null, 2));

    console.log('--- ORDERS ---');
    console.log(JSON.stringify(orders, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
