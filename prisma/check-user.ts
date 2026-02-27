import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({
        include: {
            role: true,
            employee: true
        }
    });

    console.log('USERS_START');
    users.forEach(u => {
        console.log(JSON.stringify({
            username: u.username,
            roleCode: u.role.code,
            fullName: u.employee?.fullName
        }));
    });
    console.log('USERS_END');

    const roles = await prisma.role.findMany();
    console.log('ROLES_START');
    roles.forEach(r => {
        console.log(JSON.stringify(r));
    });
    console.log('ROLES_END');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
