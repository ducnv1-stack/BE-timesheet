
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🧹 Starting cleanup of orphan orders...');

    // 1. Get all valid User IDs
    const users = await prisma.user.findMany({ select: { id: true } });
    const validUserIds = new Set(users.map(u => u.id));

    // 2. Find orders with invalid createdBy
    const allOrders = await prisma.order.findMany({ select: { id: true, createdBy: true } });

    const orphanOrderIds = allOrders
        .filter(o => !validUserIds.has(o.createdBy))
        .map(o => o.id);

    if (orphanOrderIds.length > 0) {
        console.log(`⚠️ Found ${orphanOrderIds.length} orphan orders (invalid createdBy). Deleting...`);

        // Delete them
        const result = await prisma.order.deleteMany({
            where: {
                id: { in: orphanOrderIds }
            }
        });

        console.log(`✅ Deleted ${result.count} orphan orders.`);
    } else {
        console.log('✅ No orphan orders found.');
    }

    console.log('🏁 Cleanup finished.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
