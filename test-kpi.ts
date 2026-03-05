import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testKPIPeriods() {
    const username = 'sale01';
    const user = await prisma.user.findUnique({
        where: { username },
        include: { employee: true }
    });

    if (!user || !user.employee) {
        console.log('Không tìm thấy nhân viên test.');
        return;
    }

    console.log(`Đang kiểm tra KPI cho: ${user.employee.fullName} (ID: ${user.employee.id})`);

    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const confirmedOrders = await prisma.orderSplit.findMany({
        where: {
            employeeId: user.employee.id,
            order: {
                isPaymentConfirmed: true,
                confirmedAt: {
                    gte: startDate,
                    lte: endDate
                }
            }
        },
        include: { order: true }
    });

    console.log(`Tổng số đơn hoàn thành trong tháng: ${confirmedOrders.length}`);

    // Periods definintion
    const periods = [
        { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth(), 10, 23, 59, 59, 999), label: 'Kỳ 1' },
        { start: new Date(now.getFullYear(), now.getMonth(), 11), end: new Date(now.getFullYear(), now.getMonth(), 20, 23, 59, 59, 999), label: 'Kỳ 2' },
        { start: new Date(now.getFullYear(), now.getMonth(), 21), end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999), label: 'Kỳ 3' }
    ];

    const target = 200000000 / 3;
    console.log(`Chỉ tiêu mỗi kỳ: ${target.toLocaleString()}đ`);
    console.log('--- Chi tiết từng kỳ ---');

    let totalBonus = 0;

    periods.forEach((p, idx) => {
        const periodRevenue = confirmedOrders.filter(s => {
            const confirmedAt = s.order.confirmedAt;
            return confirmedAt && confirmedAt >= p.start && confirmedAt <= p.end;
        }).reduce((sum, s) => sum + Number(s.splitAmount), 0);

        const isFinished = now > p.end;
        const isOngoing = now >= p.start && now <= p.end;
        const isAchieved = periodRevenue >= target;

        let bonus = 0;
        if (isFinished || isOngoing) {
            bonus = isAchieved ? 300000 : -200000;
            totalBonus += bonus;
        }

        console.log(`${p.label}: Doanh số ${periodRevenue.toLocaleString()}đ - ${isAchieved ? 'ĐẠT' : 'KHÔNG ĐẠT'} - Thưởng/Phạt: ${bonus.toLocaleString()}đ`);
    });

    console.log(`--- TỔNG THƯỞNG KỲ: ${totalBonus.toLocaleString()}đ ---`);
}

testKPIPeriods()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
