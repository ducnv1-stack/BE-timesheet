import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const order = await prisma.order.findFirst({
        where: { isPaymentConfirmed: true },
        select: { id: true, totalAmount: true, confirmedAt: true }
    });
    console.log('Order confirmedAt:', order?.confirmedAt?.toISOString());
    console.log('Order confirmedAt (Local):', order?.confirmedAt?.toLocaleString());
}

main().finally(() => prisma.$disconnect());
