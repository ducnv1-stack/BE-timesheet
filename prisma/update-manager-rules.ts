import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Starting Manager Salary Rules update...');

    // Group 1: Thanh Hóa, Đà Nẵng, Hà Đông, 258 NLB, 131 TN
    const group1Keywords = ['Thanh Hóa', 'Đà Nẵng', 'Hà Đông', '258 NLB', '131 TN'];

    // Group 2: Hải Phòng
    const group2Keywords = ['Hải Phòng'];

    // Group 3: 1012 Láng
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
            console.log(`Setting group 1 rules for branch: ${branch.name}`);
        } else if (group2Keywords.some(k => branch.name.includes(k))) {
            selectedRules = rulesGroup2;
            console.log(`Setting group 2 rules for branch: ${branch.name}`);
        } else if (group3Keywords.some(k => branch.name.includes(k))) {
            selectedRules = rulesGroup3;
            console.log(`Setting group 3 rules for branch: ${branch.name}`);
        }

        if (selectedRules) {
            // Delete existing rules for this branch first
            await prisma.branchManagerSalaryRule.deleteMany({
                where: { branchId: branch.id }
            });

            // Insert new rules
            // We'll assign percentages to spread them on the progress bar
            // Lowest non-zero threshold = 100%, then 125, 150, 175, 200, 250, 300
            const percentages = [300, 250, 200, 175, 150, 125, 100, 0];

            for (let i = 0; i < selectedRules.length; i++) {
                const r = selectedRules[i];
                await prisma.branchManagerSalaryRule.create({
                    data: {
                        branchId: branch.id,
                        targetRevenue: r.targetRevenue,
                        baseSalary: r.baseSalary,
                        bonusAmount: r.bonusAmount,
                        commissionPercent: r.commissionPercent,
                        targetPercent: percentages[i] || 0,
                    }
                });
            }
        }
    }

    console.log('Update completed successfully.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
