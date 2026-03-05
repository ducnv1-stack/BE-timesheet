import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    console.log('Exporting products and bonus rules...');

    const products = await prisma.product.findMany({
        include: {
            bonusRules: true,
        },
    });

    const data = {
        products: products.map(p => ({
            id: p.id,
            name: p.name,
            minPrice: p.minPrice.toString(),
            isHighEnd: p.isHighEnd,
            hotBonus: p.hotBonus.toString(),
            createdAt: p.createdAt,
            bonusRules: p.bonusRules.map(br => ({
                id: br.id,
                minSellPrice: br.minSellPrice.toString(),
                bonusAmount: br.bonusAmount.toString(),
                salePercent: br.salePercent.toString(),
                managerPercent: br.managerPercent.toString(),
            })),
        })),
    };

    const filePath = path.join(__dirname, 'seed-products-data.json');
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    console.log(`Exported ${products.length} products to ${filePath}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
