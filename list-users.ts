import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const sales = await prisma.user.findMany({
        where: { role: { code: 'SALE' } },
        select: { username: true, id: true, role: { select: { code: true } } },
        take: 5
    });
    console.log(JSON.stringify(sales, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
