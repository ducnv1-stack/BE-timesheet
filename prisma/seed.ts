import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Seed starting...');

    // 1. Roles
    const rolesData = [
        { code: 'ADMIN', name: 'Administrator' },
        { code: 'DIRECTOR', name: 'Giám đốc' },
        { code: 'ACCOUNTANT', name: 'Kế toán trưởng' },
        { code: 'MANAGER', name: 'Quản lý chi nhánh' },
        { code: 'SALE', name: 'Sales Professional' },
    ];

    const roles: Record<string, any> = {};
    for (const r of rolesData) {
        roles[r.code] = await prisma.role.upsert({
            where: { code: r.code },
            update: {},
            create: r,
        });
    }

    // 2. Branch
    const branchHanoi = await prisma.branch.upsert({
        where: { code: 'HN01' },
        update: {},
        create: { code: 'HN01', name: 'Hà Nội - Trụ sở chính', address: '123 Cầu Giấy' },
    });

    // 3. Users & Employees
    const usersData = [
        { username: 'director01', roleCode: 'DIRECTOR', fullName: 'Nguyễn Văn Giám Đốc', position: 'director' },
        { username: 'accountant01', roleCode: 'ACCOUNTANT', fullName: 'Trần Thị Kế Toán', position: 'accountant' },
        { username: 'manager01', roleCode: 'MANAGER', fullName: 'Lê Văn Quản Lý', position: 'manager' },
        { username: 'sale01', roleCode: 'SALE', fullName: 'Nguyễn Văn Sale', position: 'sale' },
    ];

    for (const u of usersData) {
        const user = await prisma.user.upsert({
            where: { username: u.username },
            update: {},
            create: {
                username: u.username,
                passwordHash: '$2b$10$EpWaTgiFb/V.R.eK..n..e.../........', // Mock hash
                roleId: roles[u.roleCode].id,
            },
        });

        await prisma.employee.upsert({
            where: { userId: user.id },
            update: {},
            create: {
                userId: user.id,
                branchId: branchHanoi.id,
                fullName: u.fullName,
                position: u.position,
                phone: '0988888888',
            },
        });
    }

    // 4. Products - Upsert to avoid deletion errors
    console.log('Skipping product deletion to preserve Order history...');
    // await prisma.productBonusRule.deleteMany();
    // await prisma.product.deleteMany();

    // Only insert if needed, or skip for now since we have data.
    // For this task, we focus on Users.

    console.log('Seed completed successfully');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
