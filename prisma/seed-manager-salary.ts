import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedManagerSalaryRules() {
    console.log('🌱 Seeding Manager Salary Rules...');

    // Lấy danh sách chi nhánh
    const branches = await prisma.branch.findMany();

    // Tìm chi nhánh 1012 Láng
    const lang1012 = branches.find(b => b.name.includes('1012') || b.name.includes('Láng'));

    // Các chi nhánh còn lại (Thanh Hóa, Hải Phòng, Hà Đông, 258 NLB, 131 TN)
    const otherBranches = branches.filter(b => b.id !== lang1012?.id);

    // ============================================
    // Bảng lương cho chi nhánh Thanh Hóa, Hải Phòng, Hà Đông, 258 NLB, 131 TN
    // ============================================
    const standardMilestones = [
        { percent: 40, revenue: 320000000, baseSalary: 6000000, bonus: 0, commission: 0 },
        { percent: 40, revenue: 320000000, baseSalary: 8000000, bonus: 0, commission: 0.80 },
        { percent: 60, revenue: 480000000, baseSalary: 10000000, bonus: 0, commission: 1.00 },
        { percent: 80, revenue: 640000000, baseSalary: 12000000, bonus: 0, commission: 1.30 },
        { percent: 100, revenue: 1000000000, baseSalary: 15000000, bonus: 5000000, commission: 1.50 },
        { percent: 100, revenue: 1300000000, baseSalary: 15000000, bonus: 10000000, commission: 1.50 },
        { percent: 100, revenue: 1600000000, baseSalary: 15000000, bonus: 15000000, commission: 1.50 },
        { percent: 100, revenue: 2000000000, baseSalary: 15000000, bonus: 20000000, commission: 1.50 },
    ];

    for (const branch of otherBranches) {
        console.log(`  Seeding for ${branch.name}...`);

        for (const milestone of standardMilestones) {
            const existing = await prisma.branchManagerSalaryRule.findFirst({
                where: {
                    branchId: branch.id,
                    targetPercent: milestone.percent,
                    targetRevenue: milestone.revenue
                }
            });

            if (existing) {
                await prisma.branchManagerSalaryRule.update({
                    where: { id: existing.id },
                    data: {
                        baseSalary: milestone.baseSalary,
                        bonusAmount: milestone.bonus,
                        commissionPercent: milestone.commission
                    }
                });
            } else {
                await prisma.branchManagerSalaryRule.create({
                    data: {
                        branchId: branch.id,
                        targetPercent: milestone.percent,
                        targetRevenue: milestone.revenue,
                        baseSalary: milestone.baseSalary,
                        bonusAmount: milestone.bonus,
                        commissionPercent: milestone.commission
                    }
                });
            }
        }
    }

    // ============================================
    // Bảng lương cho chi nhánh 1012 Láng
    // ============================================
    if (lang1012) {
        console.log(`  Seeding for ${lang1012.name} (1012 Láng)...`);

        const lang1012Milestones = [
            { percent: 40, revenue: 1000000000, baseSalary: 6000000, bonus: 0, commission: 0.00 },
            { percent: 40, revenue: 1000000000, baseSalary: 8000000, bonus: 0, commission: 0.80 },
            { percent: 60, revenue: 1600000000, baseSalary: 10000000, bonus: 0, commission: 1.00 },
            { percent: 80, revenue: 2000000000, baseSalary: 12000000, bonus: 0, commission: 1.00 },
            { percent: 100, revenue: 2500000000, baseSalary: 15000000, bonus: 10000000, commission: 1.00 },
            { percent: 125, revenue: 2500000000, baseSalary: 15000000, bonus: 15000000, commission: 1.00 },
            { percent: 150, revenue: 3000000000, baseSalary: 15000000, bonus: 20000000, commission: 1.00 },
            { percent: 200, revenue: 4000000000, baseSalary: 15000000, bonus: 25000000, commission: 1.00 },
        ];

        for (const milestone of lang1012Milestones) {
            const existing = await prisma.branchManagerSalaryRule.findFirst({
                where: {
                    branchId: lang1012.id,
                    targetPercent: milestone.percent,
                    targetRevenue: milestone.revenue
                }
            });

            if (existing) {
                await prisma.branchManagerSalaryRule.update({
                    where: { id: existing.id },
                    data: {
                        baseSalary: milestone.baseSalary,
                        bonusAmount: milestone.bonus,
                        commissionPercent: milestone.commission
                    }
                });
            } else {
                await prisma.branchManagerSalaryRule.create({
                    data: {
                        branchId: lang1012.id,
                        targetPercent: milestone.percent,
                        targetRevenue: milestone.revenue,
                        baseSalary: milestone.baseSalary,
                        bonusAmount: milestone.bonus,
                        commissionPercent: milestone.commission
                    }
                });
            }
        }
    }

    console.log('✅ Manager Salary Rules seeded successfully!');
}

seedManagerSalaryRules()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
