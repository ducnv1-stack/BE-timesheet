import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const methods = await prisma.payment.findMany({
        select: { paymentMethod: true },
        distinct: ['paymentMethod'],
    });
    console.log('Distinct Payment Methods:', methods);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
