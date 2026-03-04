import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    console.log('Checking orders from:', startDate, 'to:', endDate);

    const orders = await prisma.order.findMany({
        where: {
            isPaymentConfirmed: true,
            confirmedAt: { gte: startDate, lte: endDate }
        },
        select: {
            id: true,
            totalAmount: true,
            confirmedAt: true,
            status: true,
            orderSource: true
        }
    });

    console.log('Total orders found:', orders.length);
    const systemRevenue = orders.reduce((sum, order) => sum + Number(order.totalAmount), 0);
    console.log('System Revenue calculated:', systemRevenue);

    if (orders.length > 0) {
        console.log('Sample order:', orders[0]);
    }
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
