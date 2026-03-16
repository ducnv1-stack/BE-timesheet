import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Bắt đầu chuyển đổi dữ liệu giá min ---');

    const products = await prisma.product.findMany({});
    console.log(`Tìm thấy ${products.length} sản phẩm.`);

    for (const product of products) {
        // Tạo chính sách giá mặc định từ ngày hôm nay
        await (prisma as any).productMinPricePolicy.create({
            data: {
                productId: product.id,
                minPrice: product.minPrice,
                startDate: new Date('2024-01-01'), // Giả định ngày bắt đầu từ xa để bao phủ các đơn hàng cũ
                endDate: null,
            }
        });
        console.log(`- Đã tạo chính sách giá cho sản phẩm: ${product.name} (Giá: ${product.minPrice})`);
    }

    console.log('--- Hoàn thành chuyển đổi dữ liệu ---');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
