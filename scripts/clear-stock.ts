
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- Đang xóa toàn bộ dữ liệu tồn kho ---');
    
    // 1. Xóa chi tiết từng máy (Serial numbers)
    const stockItems = await prisma.stockItem.deleteMany({});
    console.log(`- Đã xóa ${stockItems.count} bản ghi StockItem.`);

    // 2. Xóa tổng hợp tồn kho tại chi nhánh
    const branchStock = await prisma.branchStock.deleteMany({});
    console.log(`- Đã xóa ${branchStock.count} bản ghi BranchStock.`);

    // 3. Xóa lịch sử giao dịch kho
    const transactions = await prisma.stockTransaction.deleteMany({});
    console.log(`- Đã xóa ${transactions.count} bản ghi StockTransaction.`);

    console.log('--- Hoàn tất xóa sạch dữ liệu kho ---');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
