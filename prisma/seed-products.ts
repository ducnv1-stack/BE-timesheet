import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding products from JSON...');

    const filePath = path.join(__dirname, 'seed-products-data.json');
    if (!fs.existsSync(filePath)) {
        console.error(`Error: ${filePath} not found. Run export script first.`);
        return;
    }

    const rawData = fs.readFileSync(filePath, 'utf8');
    const { products } = JSON.parse(rawData);

    for (const p of products) {
        console.log(`Upserting product: ${p.name}`);

        // Upsert Product
        await prisma.product.upsert({
            where: { id: p.id },
            update: {
                name: p.name,
                minPrice: p.minPrice,
                isHighEnd: p.isHighEnd,
                hotBonus: p.hotBonus,
            },
            create: {
                id: p.id,
                name: p.name,
                minPrice: p.minPrice,
                isHighEnd: p.isHighEnd,
                hotBonus: p.hotBonus,
                createdAt: p.createdAt,
            },
        });

        // Handle Bonus Rules
        // Note: For simplicity and since these are linked to product, we delete and recreate or upsert
        // If there are many rules, upsert is better. Let's do deleteMany + createMany for simplicity
        // because it's a seed script.
        await prisma.productBonusRule.deleteMany({ where: { productId: p.id } });

        for (const br of p.bonusRules) {
            await prisma.productBonusRule.create({
                data: {
                    id: br.id,
                    productId: p.id,
                    minSellPrice: br.minSellPrice,
                    bonusAmount: br.bonusAmount,
                    salePercent: br.salePercent,
                    managerPercent: br.managerPercent,
                }
            });
        }
    }

    console.log(`Seed completed: ${products.length} products processed.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
