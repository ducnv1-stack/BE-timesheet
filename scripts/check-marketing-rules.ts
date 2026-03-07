import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const rules = await prisma.marketingSalaryRule.findMany({
        include: {
            employee: {
                select: {
                    fullName: true,
                    position: true
                }
            }
        }
    });

    console.log('--- Marketing Salary Rules ---');
    rules.forEach(r => {
        console.log(`Employee: ${r.employee.fullName}`);
        console.log(`Threshold: ${Number(r.revenueThreshold).toLocaleString()} đ`);
        console.log(`Percent: ${Number(r.commissionPercent)} %`);
        console.log('----------------------------');
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
