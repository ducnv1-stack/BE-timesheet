import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding gifts from JSON...');

    const filePath = path.join(__dirname, 'seed-gifts-data.json');
    if (!fs.existsSync(filePath)) {
        console.error(`Error: ${filePath} not found. Run export script first.`);
        return;
    }

    const rawData = fs.readFileSync(filePath, 'utf8');
    const { gifts } = JSON.parse(rawData);

    for (const g of gifts) {
        console.log(`Upserting gift: ${g.name}`);

        await prisma.gift.upsert({
            where: { id: g.id },
            update: {
                name: g.name,
                price: g.price,
            },
            create: {
                id: g.id,
                name: g.name,
                price: g.price,
                createdAt: g.createdAt,
                updatedAt: g.updatedAt,
            },
        });
    }

    console.log(`Seed completed: ${gifts.length} gifts processed.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
