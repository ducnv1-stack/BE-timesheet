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

        // Handle Bonus Policies: delete old policies (cascade deletes rules) then recreate
        await (prisma as any).productBonusPolicy.deleteMany({ where: { productId: p.id } });

        if (p.bonusPolicies) {
            for (const pol of p.bonusPolicies) {
                await (prisma as any).productBonusPolicy.create({
                    data: {
                        id: pol.id,
                        productId: p.id,
                        name: pol.name || null,
                        startDate: new Date(pol.startDate),
                        endDate: pol.endDate ? new Date(pol.endDate) : null,
                        rules: {
                            create: (pol.rules || []).map((br: any) => ({
                                id: br.id,
                                minSellPrice: br.minSellPrice,
                                bonusAmount: br.bonusAmount,
                                salePercent: br.salePercent,
                                managerPercent: br.managerPercent,
                            }))
                        }
                    }
                });
            }
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
