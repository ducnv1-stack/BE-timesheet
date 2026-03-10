import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Seed starting...');

    // 1. Roles
    const rolesData = [
        { code: 'ADMIN', name: 'Quản trị viên' },
        { code: 'DIRECTOR', name: 'Giám đốc' },
        { code: 'MANAGER', name: 'Quản lý chi nhánh' },
        { code: 'CHIEF_ACCOUNTANT', name: 'Kế toán trưởng' },
        { code: 'ACCOUNTANT', name: 'Kế toán chi nhánh' },
        { code: 'SALE', name: 'Nhân viên bán hàng' },
        { code: 'TELESALE', name: 'Telesale' },
        { code: 'MARKETING', name: 'Marketing' },
        { code: 'DRIVER', name: 'Lái xe' },
        { code: 'DELIVERY_STAFF', name: 'Nhân viên giao hàng' },
        { code: 'HR', name: 'Hành chính nhân sự' },
        { code: 'WAREHOUSE', name: 'Nhân viên kho' },
        { code: 'TECHNICIAN', name: 'Nhân viên kỹ thuật' },
    ];

    const roles: Record<string, any> = {};
    for (const r of rolesData) {
        roles[r.code] = await prisma.role.upsert({
            where: { code: r.code },
            update: { name: r.name },
            create: r,
        });
    }

    // 2. Branch
    const branchesData = [
        { code: 'CONGTY', name: 'Công ty' },
        { code: '131HD', name: '131 HD' },
        { code: '258HD', name: '258 HD' },
        { code: '1012LANG', name: '1012 Láng' },
        { code: '639QT', name: '639 QT - HĐ' },
        { code: 'HAIPHONG', name: 'Hải Phòng' },
        { code: 'THANHHOA', name: 'Thanh Hóa' },
        { code: 'DANANG', name: 'Đà Nẵng' },
    ];

    for (const b of branchesData) {
        await prisma.branch.upsert({
            where: { code: b.code },
            update: { name: b.name },
            create: b,
        });
    }

    // 3. Manager Salary Rules
    console.log('Seeding Manager Salary Rules...');
    const group1Keywords = ['Thanh Hóa', 'Đà Nẵng', 'Hà Đông', '258 NLB', '131 TN', '131 HD', '258 HD', '639 QT'];
    const group2Keywords = ['Hải Phòng'];
    const group3Keywords = ['1012 Láng'];

    const branches = await prisma.branch.findMany();

    const rulesGroup1 = [
        { targetRevenue: 2000000000, baseSalary: 15000000, bonusAmount: 20000000, commissionPercent: 1.5 },
        { targetRevenue: 1600000000, baseSalary: 15000000, bonusAmount: 15000000, commissionPercent: 1.5 },
        { targetRevenue: 1300000000, baseSalary: 15000000, bonusAmount: 10000000, commissionPercent: 1.5 },
        { targetRevenue: 1000000000, baseSalary: 15000000, bonusAmount: 5000000, commissionPercent: 1.5 },
        { targetRevenue: 640000000, baseSalary: 12000000, bonusAmount: 0, commissionPercent: 1.3 },
        { targetRevenue: 480000000, baseSalary: 10000000, bonusAmount: 0, commissionPercent: 1.0 },
        { targetRevenue: 320000000, baseSalary: 8000000, bonusAmount: 0, commissionPercent: 0.8 },
        { targetRevenue: 0, baseSalary: 6000000, bonusAmount: 0, commissionPercent: 0 },
    ];

    const rulesGroup2 = [
        { targetRevenue: 2500000000, baseSalary: 15000000, bonusAmount: 25000000, commissionPercent: 1.5 },
        { targetRevenue: 2000000000, baseSalary: 15000000, bonusAmount: 20000000, commissionPercent: 1.5 },
        { targetRevenue: 1750000000, baseSalary: 15000000, bonusAmount: 15000000, commissionPercent: 1.5 },
        { targetRevenue: 1500000000, baseSalary: 15000000, bonusAmount: 10000000, commissionPercent: 1.5 },
        { targetRevenue: 1200000000, baseSalary: 12000000, bonusAmount: 0, commissionPercent: 1.3 },
        { targetRevenue: 900000000, baseSalary: 10000000, bonusAmount: 0, commissionPercent: 1.0 },
        { targetRevenue: 600000000, baseSalary: 8000000, bonusAmount: 0, commissionPercent: 0.8 },
        { targetRevenue: 0, baseSalary: 6000000, bonusAmount: 0, commissionPercent: 0 },
    ];

    const rulesGroup3 = [
        { targetRevenue: 3000000000, baseSalary: 15000000, bonusAmount: 25000000, commissionPercent: 1.5 },
        { targetRevenue: 2500000000, baseSalary: 15000000, bonusAmount: 20000000, commissionPercent: 1.5 },
        { targetRevenue: 2250000000, baseSalary: 15000000, bonusAmount: 15000000, commissionPercent: 1.5 },
        { targetRevenue: 2000000000, baseSalary: 15000000, bonusAmount: 10000000, commissionPercent: 1.5 },
        { targetRevenue: 1700000000, baseSalary: 12000000, bonusAmount: 0, commissionPercent: 1.5 },
        { targetRevenue: 1400000000, baseSalary: 10000000, bonusAmount: 0, commissionPercent: 1.3 },
        { targetRevenue: 1100000000, baseSalary: 8000000, bonusAmount: 0, commissionPercent: 1.0 },
        { targetRevenue: 0, baseSalary: 6000000, bonusAmount: 0, commissionPercent: 0.8 },
    ];

    for (const branch of branches) {
        let selectedRules = null;

        if (group1Keywords.some(k => branch.name.includes(k))) {
            selectedRules = rulesGroup1;
        } else if (group2Keywords.some(k => branch.name.includes(k))) {
            selectedRules = rulesGroup2;
        } else if (group3Keywords.some(k => branch.name.includes(k))) {
            selectedRules = rulesGroup3;
        }

        if (selectedRules) {
            await prisma.branchManagerSalaryRule.deleteMany({ where: { branchId: branch.id } });
            const percentages = [0, 100, 125, 150, 175, 200, 250, 300]; // Just for internal tracking

            for (let i = 0; i < selectedRules.length; i++) {
                const r = selectedRules[i];
                await prisma.branchManagerSalaryRule.create({
                    data: {
                        branchId: branch.id,
                        targetRevenue: r.targetRevenue,
                        baseSalary: r.baseSalary,
                        bonusAmount: r.bonusAmount,
                        commissionPercent: r.commissionPercent,
                        targetPercent: percentages[selectedRules.length - 1 - i] || 0,
                    }
                });
            }
        }
    }

    // 4. Users & Placeholder Employees
    const usersData = [
        { username: 'director01', roleCode: 'DIRECTOR', fullName: 'Nguyễn Văn Giám Đốc', position: 'director' },
        { username: 'accountant01', roleCode: 'ACCOUNTANT', fullName: 'Trần Thị Kế Toán', position: 'accountant' },
        { username: 'manager01', roleCode: 'MANAGER', fullName: 'Lê Văn Quản Lý', position: 'manager' },
        { username: 'sale01', roleCode: 'SALE', fullName: 'Nguyễn Văn Sale', position: 'sale' },
    ];

    const firstBranch = branches[0];

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
                branchId: firstBranch.id,
                fullName: u.fullName,
                position: u.position,
                phone: '0988888888',
            },
        });
    }

    // 5. Products - Upsert to avoid deletion errors
    console.log('Skipping product deletion to preserve Order history...');
    // await prisma.productBonusRule.deleteMany();
    // await prisma.product.deleteMany();

    // Only insert if needed, or skip for now since we have data.
    // For this task, we focus on Users.

    // 6. Telesale & Marketing Salary Rules
    console.log('Seeding Telesale & Marketing Salary Rules...');

    // Telesale rule: Fixed 0.3%
    await prisma.telesaleSalaryRule.deleteMany({});
    await prisma.telesaleSalaryRule.create({
        data: { commissionPercent: 0.3 }
    });

    // Marketing rules for specific employees
    const thai = await prisma.employee.findFirst({ where: { fullName: { contains: 'Thái' } } });
    const nhat = await prisma.employee.findFirst({ where: { fullName: { contains: 'Nhất' } } });

    if (thai) {
        await prisma.marketingSalaryRule.deleteMany({ where: { employeeId: thai.id } });
        await prisma.marketingSalaryRule.create({
            data: { employeeId: thai.id, revenueThreshold: 500000000, commissionPercent: 0.5 }
        });
    }

    if (nhat) {
        await prisma.marketingSalaryRule.deleteMany({ where: { employeeId: nhat.id } });
        await prisma.marketingSalaryRule.create({
            data: { employeeId: nhat.id, revenueThreshold: 600000000, commissionPercent: 0.1 }
        });
    }

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
