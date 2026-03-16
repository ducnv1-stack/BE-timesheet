
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const products = await (prisma.product as any).findMany({
        where: { name: { contains: 'Imperial' } },
        include: { bonusPolicies: { include: { rules: true } } }
    });
    console.log(JSON.stringify(products, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
