import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    const policy = await prisma.attendancePolicy.findFirst({
        where: { name: 'Chính sách Khối Sale' },
        include: { days: true }
    });
    
    if (!policy) {
        console.log('Không tìm thấy chính sách');
    } else {
        console.log('Policy Name:', policy.name);
        console.log('Days Data:');
        policy.days.sort((a, b) => a.dayOfWeek - b.dayOfWeek).forEach(d => {
            console.log(`Day ${d.dayOfWeek}: ${d.startTime} - ${d.endTime} (Off: ${d.isOff})`);
        });
    }
    
    await prisma.$disconnect();
}

main().catch(console.error);
