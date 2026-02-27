import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDuplicates() {
    console.log('Checking for employees with empty string idCardNumber...');

    try {
        const counts = await prisma.employee.groupBy({
            by: ['idCardNumber'],
            _count: {
                idCardNumber: true,
            },
        });

        console.log('Value counts for idCardNumber:');
        counts.forEach(c => {
            console.log(`- "${c.idCardNumber}": ${c._count.idCardNumber}`);
        });

        const emptyStringEmployees = await prisma.employee.findMany({
            where: { idCardNumber: '' },
            select: { id: true, fullName: true }
        });

        console.log(`\nFound ${emptyStringEmployees.length} employees with idCardNumber = ""`);
        emptyStringEmployees.forEach(e => {
            console.log(`- ${e.fullName} (ID: ${e.id})`);
        });

    } catch (error) {
        console.error('Error checking duplicates:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkDuplicates();
