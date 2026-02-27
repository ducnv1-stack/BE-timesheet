import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding Telesale & Marketing data...');

    // 1. Ensure Roles exist
    const roles = [
        { code: 'TELESALE', name: 'Telesale' },
        { code: 'MARKETING', name: 'Marketing' }
    ];

    for (const role of roles) {
        await prisma.role.upsert({
            where: { code: role.code },
            update: { name: role.name },
            create: { code: role.code, name: role.name }
        });
    }
    console.log('✅ Roles updated');

    // 2. Find existing Employees for Thái and Nhất
    const thai = await prisma.employee.findFirst({
        where: { fullName: { contains: 'Thái' } }
    });

    const nhat = await prisma.employee.findFirst({
        where: { fullName: { contains: 'Nhất' } }
    });

    if (!thai || !nhat) {
        throw new Error('Could not find employee Thái or Nhất in database to apply Marketing rules.');
    }

    console.log(`✅ Found employees: ${thai.fullName} (${thai.id}), ${nhat.fullName} (${nhat.id})`);

    // 3. Seed Marketing Salary Rules
    // Clear old rules first
    await prisma.marketingSalaryRule.deleteMany({
        where: { employeeId: { in: [thai.id, nhat.id] } }
    });

    // Thái: >= 500tr -> 0.5%
    await prisma.marketingSalaryRule.create({
        data: {
            employeeId: thai.id,
            revenueThreshold: 500000000,
            commissionPercent: 0.5
        }
    });

    // Nhất: >= 600tr -> 0.1%
    await prisma.marketingSalaryRule.create({
        data: {
            employeeId: nhat.id,
            revenueThreshold: 600000000,
            commissionPercent: 0.1
        }
    });
    console.log('✅ Marketing salary rules seeded');

    // 4. Seed Telesale Salary Rule (Fixed 0.3%)
    await prisma.telesaleSalaryRule.deleteMany({});
    await prisma.telesaleSalaryRule.create({
        data: {
            commissionPercent: 0.3
        }
    });
    console.log('✅ Telesale salary rule seeded (0.3%)');

    console.log('🏁 Seeding completed!');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
