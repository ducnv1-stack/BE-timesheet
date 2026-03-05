import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('Exporting gifts...');

    const gifts = await prisma.gift.findMany();

    const data = {
        gifts: gifts.map(g => ({
            id: g.id,
            name: g.name,
            price: g.price.toString(),
            createdAt: g.createdAt,
            updatedAt: g.updatedAt,
        })),
    };

    const filePath = path.join(__dirname, 'seed-gifts-data.json');
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    console.log(`Exported ${gifts.length} gifts to ${filePath}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
