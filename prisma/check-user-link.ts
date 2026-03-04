import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const user = await prisma.user.findFirst({
        where: { username: 'Nguyễn Quyết Thắng' },
        include: { employee: true, role: true }
    });
    console.log('User:', JSON.stringify(user, null, 2));
}

main().finally(() => prisma.$disconnect());
