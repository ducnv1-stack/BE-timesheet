
import { PrismaClient } from '@prisma/client';
import * as readline from 'readline';

const prisma = new PrismaClient();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query: string): Promise<string> {
    return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
    console.log('🚀 Đang kiểm tra dữ liệu đơn hàng...');

    const orderCount = await prisma.order.count();

    if (orderCount === 0) {
        console.log('✅ Không có đơn hàng nào trong hệ thống.');
        rl.close();
        return;
    }

    console.log(`⚠️ Tìm thấy ${orderCount} đơn hàng trong hệ thống.`);
    console.log('CẢNH BÁO: Hành động này sẽ xóa TẤT CẢ đơn hàng và các dữ liệu liên quan (chi tiết, thanh toán, giao hàng, quà tặng, v.v.)');

    const answer = await askQuestion('Bạn có chắc chắn muốn xóa không? (y/N): ');

    if (answer.toLowerCase() === 'y') {
        process.stdout.write('🗑️ Đang xóa đơn hàng... ');
        
        try {
            const result = await prisma.order.deleteMany();
            console.log('Xong!');
            console.log(`✅ Đã xóa thành công ${result.count} đơn hàng.`);
        } catch (error) {
            console.error('\n❌ Đã xảy ra lỗi khi xóa đơn hàng:', error);
        }
    } else {
        console.log('❌ Đã hủy thao tác xóa.');
    }

    rl.close();
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
