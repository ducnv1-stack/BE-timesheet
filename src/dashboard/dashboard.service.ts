import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
    constructor(private prisma: PrismaService) { }

    async getDashboardData(userId: string, startDate?: string, endDate?: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: {
                role: true,
                employee: true
            }
        });

        if (!user) return { error: 'User not found' };

        switch (user.role.code) {
            case 'DIRECTOR':
            case 'CHIEF_ACCOUNTANT':
            case 'ACCOUNTANT':
                return this.getAccountingStats(undefined, startDate, endDate);
            case 'MANAGER':
                return this.getManagerStats(user.employee?.branchId, startDate, endDate);
            case 'SALE':
                return this.getSaleStats(user.employee?.id, startDate, endDate);
            case 'TELESALE':
                return this.getTelesaleStats(user.employee?.id, userId, startDate, endDate);
            case 'MARKETING':
                return this.getMarketingStats(user.employee?.id, startDate, endDate);
            case 'DRIVER':
            case 'COMPANY_DRIVER':
                return this.getDriverStats(user.employee?.id, startDate, endDate);
            default:
                return { message: 'Role not supported for dashboard yet' };
        }
    }

    private async getAccountingStats(branchId?: string, startStr?: string, endStr?: string) {
        const now = new Date();
        const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = endStr ? new Date(endStr) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        // Ensure endDate covers the whole day if only date is provided
        if (endStr && !endStr.includes('T')) {
            endDate.setHours(23, 59, 59, 999);
        }

        // Base filter for orders (ONLY confirmed orders count towards revenue)
        const orderWhere: any = {
            isPaymentConfirmed: true,
            confirmedAt: { gte: startDate, lte: endDate }
        };
        if (branchId) orderWhere.branchId = branchId;

        const [revResult, ordersCount, unconfirmedRevResult, unconfirmedCount, pendingInstallmentRevResult, pendingInstallmentCount, unissuedInvoiceCount, employeesCount, salesRevResult, salesOrderCount] = await Promise.all([
            this.prisma.order.aggregate({
                where: { ...orderWhere, status: { notIn: ['canceled', 'rejected'] } },
                _sum: { totalAmount: true }
            }),
            this.prisma.order.count({
                where: { ...orderWhere, status: { notIn: ['canceled', 'rejected'] } }
            }),
            this.prisma.order.aggregate({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    isPaymentConfirmed: false,
                    payments: { none: { paymentMethod: 'INSTALLMENT' } },
                    orderDate: { lte: endDate }
                },
                _sum: { totalAmount: true }
            }),
            this.prisma.order.count({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    isPaymentConfirmed: false,
                    payments: { none: { paymentMethod: 'INSTALLMENT' } },
                    orderDate: { lte: endDate }
                }
            }),
            this.prisma.order.aggregate({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    isPaymentConfirmed: false,
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    orderDate: { lte: endDate }
                },
                _sum: { totalAmount: true }
            }),
            this.prisma.order.count({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    isPaymentConfirmed: false,
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    orderDate: { lte: endDate }
                }
            }),
            this.prisma.order.count({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    isInvoiceIssued: false,
                    orderDate: { lte: endDate }
                }
            }),
            this.prisma.employee.count({
                where: {
                    status: 'Đang làm việc',
                    ...(branchId ? { branchId } : {})
                }
            }),
            // DOANH SỐ BÁN — Tất cả đơn theo orderDate (không cần confirm)
            this.prisma.order.aggregate({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    orderDate: { gte: startDate, lte: endDate }
                },
                _sum: { totalAmount: true }
            }),
            this.prisma.order.count({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    orderDate: { gte: startDate, lte: endDate }
                }
            })
        ]);

        const totalRevenue = Number(revResult._sum.totalAmount || 0);
        const totalOrders = salesOrderCount; // Bao gồm tất cả đơn trong kỳ (không chỉ đơn đã confirm)
        const salesRevenue = Number(salesRevResult._sum.totalAmount || 0);
        const unconfirmedRevenue = Number(unconfirmedRevResult._sum.totalAmount || 0);
        const pendingInstallmentRevenue = Number(pendingInstallmentRevResult._sum.totalAmount || 0);

        // Get eligible order IDs to avoid circular reference in Prisma
        // (filtering payment -> order -> payments creates a circular relation)
        const eligibleOrders = await this.prisma.order.findMany({
            where: orderWhere,
            select: { id: true }
        });
        const eligibleOrderIds = eligibleOrders.map(o => o.id);

        // Detailed Payment Method Breakdown (using orderIds to avoid circular reference)
        const methods = ['CASH', 'TRANSFER_COMPANY', 'TRANSFER_PERSONAL', 'CARD', 'INSTALLMENT'];
        const paymentMethodBreakdown = await Promise.all(methods.map(async method => {
            const sum = await this.prisma.payment.aggregate({
                where: {
                    paymentMethod: method,
                    orderId: { in: eligibleOrderIds }
                },
                _sum: { amount: true }
            });
            return {
                method,
                amount: Number(sum._sum.amount || 0)
            };
        }));

        // Filter for branch breakdown (Confirmed in period OR Pending at mốc endDate)
        const branchWhere: any = {
            status: { notIn: ['canceled', 'rejected'] },
            OR: [
                {
                    isPaymentConfirmed: true,
                    confirmedAt: { gte: startDate, lte: endDate }
                },
                {
                    isPaymentConfirmed: false,
                    orderDate: { lte: endDate }
                },
                {
                    // Catch orders confirmed outside range but still pending invoice
                    isInvoiceIssued: false,
                    orderDate: { lte: endDate }
                },
                {
                    // All orders in period for salesRevenue calculation
                    orderDate: { gte: startDate, lte: endDate }
                }
            ]
        };

        const branches = await this.prisma.branch.findMany({
            ...(branchId ? { where: { id: branchId } } : {}),
            include: {
                orders: {
                    where: branchWhere,
                    select: {
                        totalAmount: true,
                        orderDate: true,
                        isPaymentConfirmed: true,
                        confirmedAt: true,
                        isInvoiceIssued: true,
                        payments: {
                            select: { paymentMethod: true }
                        },
                        items: {
                            select: { isBelowMin: true }
                        }
                    }
                }
            }
        });

        const branchStats = branches.map(b => {
            // Doanh số bán (tất cả đơn trong kỳ theo orderDate)
            const allOrdersInPeriod = b.orders.filter(o =>
                (o as any).orderDate >= startDate && (o as any).orderDate <= endDate
            );
            const branchSalesRevenue = allOrdersInPeriod.reduce((sum, o) => sum + Number(o.totalAmount), 0);

            // Doanh số hoàn thành (chỉ đơn đã confirm)
            const revenueOrders = b.orders.filter(o =>
                o.isPaymentConfirmed &&
                o.confirmedAt &&
                o.confirmedAt >= startDate &&
                o.confirmedAt <= endDate
            );
            const revenue = revenueOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
            const lowPriceOrders = revenueOrders.filter(o => o.items.some(i => i.isBelowMin)).length;

            // Non-installment unconfirmed (All time up to endDate)
            const unconfirmedOrders = b.orders.filter(o =>
                o.payments.every(p => p.paymentMethod !== 'INSTALLMENT') && !o.isPaymentConfirmed
            ).length;

            // Installment pending (All time up to endDate)
            const pendingInstallmentOrders = b.orders.filter(o =>
                o.payments.some(p => p.paymentMethod === 'INSTALLMENT') && !o.isPaymentConfirmed
            ).length;

            // Pending invoices (All time up to endDate)
            const pendingInvoices = b.orders.filter(o => !o.isInvoiceIssued).length;

            return {
                id: b.id,
                name: b.name,
                salesRevenue: branchSalesRevenue, // Doanh số bán
                revenue,                           // Doanh số hoàn thành
                pendingRevenue: Math.max(0, branchSalesRevenue - revenue), // Chờ thanh toán
                orderCount: revenueOrders.length, // Đơn đã xác nhận
                totalOrders: allOrdersInPeriod.length, // Tổng đơn phát sinh (bao gồm cả đơn chưa xác nhận)
                salesOrderCount: allOrdersInPeriod.length,
                lowPriceRatio: revenueOrders.length > 0 ? Math.round((lowPriceOrders / revenueOrders.length) * 100) : 0,
                unconfirmedOrders,
                pendingInstallmentOrders,
                pendingInvoices
            };
        });

        // Sort by revenue for Top chart
        const topBranches = [...branchStats].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

        // ===== Advanced Stats: Best Sellers & Revenue Trend (ALL SYSTEM) =====
        const reportOrders = await this.prisma.order.findMany({
            where: orderWhere,
            include: {
                items: { include: { product: { select: { name: true } } } }
            }
        });

        const productMap = new Map();
        const trendMap = new Map();

        reportOrders.forEach(o => {
            // Products
            o.items.forEach(item => {
                const pName = item.product.name;
                const current = productMap.get(pName) || { name: pName, quantity: 0, revenue: 0 };
                current.quantity += item.quantity;
                current.revenue += Number(item.totalPrice);
                productMap.set(pName, current);
            });

            // Trend (Adjust to GMT+7 before grouping by date)
            const date = new Date(o.confirmedAt!.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
            const currentTrend = trendMap.get(date) || { date, revenue: 0 };
            currentTrend.revenue += Number(o.totalAmount);
            trendMap.set(date, currentTrend);
        });

        const bestSellers = Array.from(productMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
        const revenueTrend = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        return {
            role: 'DIRECTOR', // Keep for FE component matching
            isGlobal: !branchId,
            salesRevenue,           // Doanh số bán toàn hệ thống
            salesOrderCount,        // Tổng số đơn bán
            totalRevenue,           // Doanh số hoàn thành (backward compatible)
            completedRevenue: totalRevenue,
            pendingRevenueTotal: Math.max(0, salesRevenue - totalRevenue),
            totalOrders,
            orderCount: ordersCount, // Số đơn đã xác nhận
            unconfirmedCount,
            unconfirmedRevenue,
            pendingInstallmentCount,
            pendingInstallmentRevenue,
            unissuedInvoiceCount,
            activeEmployees: employeesCount,
            paymentMethodBreakdown,
            paymentSummary: {
                cash: paymentMethodBreakdown.find(p => p.method === 'CASH')?.amount || 0,
                transfer: (paymentMethodBreakdown.find(p => p.method === 'TRANSFER_COMPANY')?.amount || 0) +
                    (paymentMethodBreakdown.find(p => p.method === 'TRANSFER_PERSONAL')?.amount || 0),
                card: paymentMethodBreakdown.find(p => p.method === 'CARD')?.amount || 0,
                installment: paymentMethodBreakdown.find(p => p.method === 'INSTALLMENT')?.amount || 0,
            },
            topBranches,
            branchDetails: branchStats.sort((a, b) => b.revenue - a.revenue),
            kpiAlerts: branchStats.filter(s => s.lowPriceRatio > 10).map(s => ({
                branchId: s.id,
                branchName: s.name,
                count: Math.round((s.lowPriceRatio / 100) * s.orderCount),
                total: s.orderCount,
                ratio: s.lowPriceRatio
            })),
            bestSellers,
            revenueTrend
        };
    }

    private async getManagerStats(branchId?: string, startStr?: string, endStr?: string) {
        if (!branchId) return { error: 'No branch assigned' };

        const now = new Date();
        const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = endStr ? new Date(endStr) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        if (endStr && !endStr.includes('T')) {
            endDate.setHours(23, 59, 59, 999);
        }

        // ========= 1a. DOANH SỐ BÁN chi nhánh — Tất cả đơn theo ngày tạo đơn (orderDate) =========
        const branchSalesSplits = await this.prisma.orderSplit.findMany({
            where: {
                employee: { branchId },
                order: {
                    status: { notIn: ['canceled', 'rejected'] },
                    orderDate: { gte: startDate, lte: endDate }
                }
            },
            select: { splitAmount: true }
        });
        const branchSalesRevenue = branchSalesSplits.reduce((sum, s) => sum + Number(s.splitAmount), 0);
        const branchSalesOrderCount = branchSalesSplits.length;

        // ========= 1b. DOANH SỐ HOÀN THÀNH chi nhánh — Đơn đã xác nhận (confirmedAt) =========
        const branchOrders = await this.prisma.orderSplit.findMany({
            where: {
                employee: { branchId },
                order: {
                    isPaymentConfirmed: true,
                    confirmedAt: { gte: startDate, lte: endDate }
                }
            },
            include: {
                order: {
                    include: {
                        items: {
                            include: {
                                product: true
                            }
                        },
                        deliveries: true
                    }
                }
            }
        });

        const branchRevenue = branchOrders.reduce((sum, split) => sum + Number(split.splitAmount), 0);
        const branchPendingRevenue = Math.max(0, branchSalesRevenue - branchRevenue);

        // ========= 2. Tính chỉ số giá dưới Min (branch-level) =========
        let lowPriceOrderCount = 0;
        let lowPriceRevenue = 0;

        for (const split of branchOrders) {
            for (const item of split.order.items) {
                if (item.isBelowMin) {
                    lowPriceOrderCount++;
                    lowPriceRevenue += Number(item.totalPrice);
                }
            }
        }

        const lowPriceRatio = branchRevenue > 0 ? (lowPriceRevenue / branchRevenue) * 100 : 0;

        // ========= 3. Tìm mốc lương đạt được =========
        const salaryRules = await this.prisma.branchManagerSalaryRule.findMany({
            where: { branchId },
            orderBy: { targetRevenue: 'desc' }
        });

        const achievedRule = salaryRules.find(rule => branchRevenue >= Number(rule.targetRevenue));
        const nextRule = [...salaryRules].reverse().find(rule => branchRevenue < Number(rule.targetRevenue));

        // ========= 4. Lấy thống kê vận hành chi nhánh (Operational Stats) =========
        // Quy tắc: Các chỉ số "Chờ xử lý" (Pending) sẽ đếm TẤT CẢ các đơn tồn đọng đến thời điểm endDate
        // (Không giới hạn bởi startDate để tránh bỏ sót các đơn cũ chưa xử lý xong)

        // 4.1. Tổng đơn hàng phát sinh trong kỳ (bao gồm đơn thường và đơn trả góp đã confirm)
        const orderWhere: any = {
            branchId,
            isPaymentConfirmed: true,
            confirmedAt: { gte: startDate, lte: endDate }
        };

        const [totalOrders, unconfirmedCount, pendingInstallmentCount, unissuedInvoiceCount, activeEmployees, eligibleOrders] = await Promise.all([
            // Tổng đơn trong kỳ (Bao gồm đơn chưa xác nhận)
            this.prisma.order.count({
                where: {
                    branchId,
                    status: { notIn: ['canceled', 'rejected'] },
                    orderDate: { gte: startDate, lte: endDate }
                }
            }),

            // Chờ khớp tiền (Đơn thường/CK chưa xác nhận - đến mốc endDate)
            this.prisma.order.count({
                where: {
                    branchId,
                    status: { notIn: ['canceled', 'rejected'] },
                    payments: { none: { paymentMethod: 'INSTALLMENT' } },
                    isPaymentConfirmed: false,
                    orderDate: { lte: endDate }
                }
            }),

            // Chờ duyệt trả góp (Đơn trả góp chưa xác nhận - đến mốc endDate)
            this.prisma.order.count({
                where: {
                    branchId,
                    status: { notIn: ['canceled', 'rejected'] },
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    isPaymentConfirmed: false,
                    orderDate: { lte: endDate }
                }
            }),

            // Chờ xuất hóa đơn (Tất cả đơn chưa xuất hóa đơn - theo yêu cầu: không phân biệt gấp/không gấp)
            this.prisma.order.count({
                where: {
                    branchId,
                    status: { notIn: ['canceled', 'rejected'] },
                    isInvoiceIssued: false,
                    orderDate: { lte: endDate }
                }
            }),

            // Nhân sự đang làm việc
            this.prisma.employee.count({
                where: { branchId, status: 'Đang làm việc' }
            }),

            // Đơn hàng hợp lệ để tính cơ cấu thanh toán
            this.prisma.order.findMany({
                where: orderWhere,
                select: { id: true }
            })
        ]);

        const eligibleOrderIds = eligibleOrders.map(o => o.id);
        const paymentMethods = ['CASH', 'TRANSFER_COMPANY', 'TRANSFER_PERSONAL', 'CARD', 'INSTALLMENT'];
        const paymentBreakdownRaw = await Promise.all(paymentMethods.map(async method => {
            const sum = await this.prisma.payment.aggregate({
                where: { paymentMethod: method, orderId: { in: eligibleOrderIds } },
                _sum: { amount: true }
            });
            return { method, amount: Number(sum._sum.amount || 0) };
        }));

        const cashAmount = paymentBreakdownRaw.find(p => p.method === 'CASH')?.amount || 0;
        const transferAmount = paymentBreakdownRaw
            .filter(p => ['TRANSFER_COMPANY', 'TRANSFER_PERSONAL', 'CARD'].includes(p.method))
            .reduce((s, p) => s + p.amount, 0);

        // Các mốc để hiển thị KPI progress bar
        const allMilestones = [...salaryRules].reverse().map(rule => ({
            percent: rule.targetPercent,
            targetRevenue: Number(rule.targetRevenue),
            baseSalary: Number(rule.baseSalary),
            bonusAmount: Number(rule.bonusAmount),
            commissionRate: Number(rule.commissionPercent),
            isAchieved: branchRevenue >= Number(rule.targetRevenue)
        }));

        // ===== Advanced Stats: Best Sellers & Revenue Trend (BRANCH SPECIFIC) =====
        const mgrProductMap = new Map();
        const mgrTrendMap = new Map();

        branchOrders.forEach(split => {
            const o = split.order;
            // Products
            o.items.forEach(item => {
                const pName = item.product.name;
                const current = mgrProductMap.get(pName) || { name: pName, quantity: 0, revenue: 0 };
                current.quantity += item.quantity;
                current.revenue += Number(item.totalPrice);
                mgrProductMap.set(pName, current);
            });

            // Trend (by confirmedAt date, adjusted to GMT+7)
            if (o.confirmedAt) {
                const date = new Date(o.confirmedAt.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
                const currentTrend = mgrTrendMap.get(date) || { date, revenue: 0 };
                currentTrend.revenue += Number(split.splitAmount);
                mgrTrendMap.set(date, currentTrend);
            }
        });

        const bestSellers = Array.from(mgrProductMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
        const revenueTrend = Array.from(mgrTrendMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        // ========= 5. Phản hồi kết quả khi chưa đạt mốc doanh số tối thiểu =========
        if (!achievedRule) {
            return {
                role: 'MANAGER',
                branchSalesRevenue,     // Doanh số bán chi nhánh
                branchRevenue,          // Doanh số hoàn thành chi nhánh
                branchPendingRevenue,   // Doanh số chờ thanh toán
                branchSalesOrderCount,  // Tổng số đơn bán
                monthlyRevenue: branchRevenue,
                totalOrders,
                cashAmount,
                transferAmount,
                unconfirmedCount,
                pendingInstallmentCount,
                unissuedInvoiceCount,
                activeEmployees,
                paymentMethodBreakdown: paymentBreakdownRaw,
                baseSalary: 0,
                baseBonus: 0,
                actualBonus: 0,
                commission: 0,
                hotBonus: 0,
                shippingFees: 0,
                lowPriceStats: {
                    count: lowPriceOrderCount,
                    value: lowPriceRevenue,
                    ratio: lowPriceRatio
                },
                performance: {
                    milestone: 0,
                    milestonePercent: 0,
                    nextMilestone: nextRule ? Number(nextRule.targetRevenue) : null,
                    isPenalty: false,
                    isClemency: false
                },
                milestones: allMilestones,
                netIncome: 0,
                message: 'Chưa đạt mốc doanh số tối thiểu',
                bestSellers,
                revenueTrend
            };
        }

        const baseSalary = Number(achievedRule.baseSalary);
        const baseBonus = Number(achievedRule.bonusAmount);
        const commissionRate = Number(achievedRule.commissionPercent);

        // ========= 6. Tính hoa hồng, thưởng nóng, tiền ship =========
        const commission = (branchRevenue * commissionRate) / 100;

        let managerHotBonus = 0;
        for (const split of branchOrders) {
            for (const item of split.order.items) {
                if (item.product.isHighEnd && item.managerBonusAmount) {
                    const splitRatio = Number(split.splitAmount) / Number(split.order.totalAmount);
                    managerHotBonus += Number(item.managerBonusAmount) * item.quantity * splitRatio;
                }
            }
        }

        const shippingFees = branchOrders.reduce((sum, split) => {
            const splitRatio = Number(split.splitAmount) / Number(split.order.totalAmount);
            const deliveryFees = split.order.deliveries.reduce((dSum, delivery) =>
                dSum + Number(delivery.deliveryFee || 0), 0);
            return sum + (deliveryFees * splitRatio);
        }, 0);

        // ========= 7. Áp dụng logic phạt/khoan hồng =========
        const isPenalty = lowPriceRatio >= 20;
        const isClemency = branchRevenue >= Number(achievedRule.targetRevenue) * 1.1;

        let actualBonus = baseBonus;
        if (isPenalty && !isClemency) {
            actualBonus = baseBonus * 0.7;
        }

        // ========= 8. Tính thực nhận =========
        const netIncome = baseSalary + actualBonus + commission + managerHotBonus + shippingFees;

        return {
            role: 'MANAGER',
            branchSalesRevenue,     // Doanh số bán chi nhánh
            branchRevenue,          // Doanh số hoàn thành chi nhánh
            branchPendingRevenue,   // Doanh số chờ thanh toán
            branchSalesOrderCount,  // Tổng số đơn bán
            monthlyRevenue: branchRevenue,
            totalOrders,
            cashAmount,
            transferAmount,
            unconfirmedCount,
            pendingInstallmentCount,
            unissuedInvoiceCount,
            activeEmployees,
            paymentMethodBreakdown: paymentBreakdownRaw,
            baseSalary,
            baseBonus,
            actualBonus,
            commission,
            hotBonus: managerHotBonus,
            shippingFees,
            lowPriceStats: {
                count: lowPriceOrderCount,
                value: lowPriceRevenue,
                ratio: lowPriceRatio
            },
            performance: {
                milestone: Number(achievedRule.targetRevenue),
                milestonePercent: achievedRule.targetPercent,
                nextMilestone: nextRule ? Number(nextRule.targetRevenue) : null,
                isPenalty,
                isClemency
            },
            milestones: allMilestones,
            netIncome,
            bestSellers,
            revenueTrend
        };
    }

    private async getSaleStats(employeeId?: string, startStr?: string, endStr?: string) {
        if (!employeeId) return { error: 'No employee record found' };

        const now = new Date();
        const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = endStr ? new Date(endStr) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        if (endStr && !endStr.includes('T')) {
            endDate.setHours(23, 59, 59, 999);
        }

        // 1. Fetch Salary Rules
        const salaryRules = await this.prisma.salesSalaryRule.findMany({
            orderBy: { targetRevenue: 'desc' }
        });

        // 2a. DOANH SỐ BÁN — Tất cả đơn theo ngày tạo đơn (orderDate)
        const salesSplits = await this.prisma.orderSplit.findMany({
            where: {
                employeeId,
                order: {
                    status: { notIn: ['canceled', 'rejected'] },
                    orderDate: { gte: startDate, lte: endDate }
                }
            },
            select: { splitAmount: true }
        });
        const salesRevenue = salesSplits.reduce((sum, s) => sum + Number(s.splitAmount), 0);
        const salesOrderCount = salesSplits.length;

        // 2b. DOANH SỐ HOÀN THÀNH — Đơn đã xác nhận thanh toán (confirmedAt)
        const splits = await this.prisma.orderSplit.findMany({
            where: {
                employeeId,
                order: {
                    isPaymentConfirmed: true,
                    confirmedAt: { gte: startDate, lte: endDate }
                }
            },
            include: {
                order: {
                    include: {
                        items: {
                            include: { product: true }
                        }
                    }
                }
            }
        });

        let completedRevenue = 0;
        let lowPriceRevenue = 0;
        let lowPriceOrderCount = 0;
        let totalCommission = 0;
        let totalHotBonus = 0;

        for (const split of splits) {
            const splitAmount = Number(split.splitAmount);
            completedRevenue += splitAmount;

            const order = split.order;
            const orderTotal = Number(order.totalAmount);

            if (orderTotal > 0) {
                const shareRatio = splitAmount / orderTotal;
                let orderLowPriceValue = 0;
                let hasLowPriceItem = false;

                for (const item of order.items) {
                    const price = Number(item.unitPrice);
                    const minPrice = Number(item.product.minPrice);
                    const itemTotal = Number(item.totalPrice);

                    // Commission = itemTotal * rate (1.8% or 1%)
                    const rate = item.isBelowMin ? 0.01 : 0.018;
                    totalCommission += itemTotal * rate * shareRatio;

                    // Hot Bonus (Thưởng nóng) = saleBonusAmount (snapshot in OrderItem)
                    totalHotBonus += Number(item.saleBonusAmount) * item.quantity * shareRatio;

                    if (price < minPrice) {
                        orderLowPriceValue += price * item.quantity;
                        hasLowPriceItem = true;
                    }
                }

                lowPriceRevenue += orderLowPriceValue * shareRatio;
                if (hasLowPriceItem) lowPriceOrderCount++;
            }
        }

        // 3. Fetch Shipping Fees (from deliveries where sale is the driver)
        const deliveries = await this.prisma.delivery.findMany({
            where: {
                driverId: employeeId,
                order: {
                    isPaymentConfirmed: true,
                    confirmedAt: { gte: startDate, lte: endDate }
                }
            }
        });
        const shippingFees = deliveries.reduce((sum, d) => sum + Number(d.deliveryFee), 0);

        // 4. Calculate Milestones & Rewards — Dùng DOANH SỐ HOÀN THÀNH để tính lương
        const achievedRule = salaryRules.find(rule => completedRevenue >= Number(rule.targetRevenue));
        const milestoneBonus = achievedRule ? Number(achievedRule.bonusAmount) : 0;

        const lowPriceRatio = completedRevenue > 0 ? (lowPriceRevenue / completedRevenue) : 0;
        const isPenalty = lowPriceRatio >= 0.2;
        let isClemency = false;
        let actualReward = milestoneBonus;

        if (isPenalty) {
            actualReward = milestoneBonus * 0.7;
            if (achievedRule && completedRevenue >= Number(achievedRule.targetRevenue) * 1.1) {
                actualReward = milestoneBonus;
                isClemency = true;
            }
        }

        // 5. All-time revenue for total stats
        const allTimeRevenue = await this.prisma.orderSplit.aggregate({
            where: {
                employeeId,
                order: {
                    isPaymentConfirmed: true
                }
            },
            _sum: { splitAmount: true }
        });

        // 6. Calculate Period KPI (3 periods per month)
        const periodTarget = 200000000 / 3;
        const periods = [
            { start: new Date(startDate.getFullYear(), startDate.getMonth(), 1), end: new Date(startDate.getFullYear(), startDate.getMonth(), 10, 23, 59, 59, 999), label: 'Kỳ 1' },
            { start: new Date(startDate.getFullYear(), startDate.getMonth(), 11), end: new Date(startDate.getFullYear(), startDate.getMonth(), 20, 23, 59, 59, 999), label: 'Kỳ 2' },
            { start: new Date(startDate.getFullYear(), startDate.getMonth(), 21), end: new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0, 23, 59, 59, 999), label: 'Kỳ 3' }
        ];

        const periodStats = periods.map(p => {
            const periodRevenue = splits.filter(s => {
                const confirmedAt = s.order.confirmedAt;
                return confirmedAt && confirmedAt >= p.start && confirmedAt <= p.end;
            }).reduce((sum, s) => sum + Number(s.splitAmount), 0);

            const isUpcoming = now < p.start;
            const isOngoing = now >= p.start && now <= p.end;
            const isFinished = now > p.end;

            const isAchieved = periodRevenue >= periodTarget;
            let bonus = 0;
            let status = 'upcoming';

            if (isFinished || isOngoing) {
                bonus = isAchieved ? 300000 : -200000;
                status = isOngoing ? 'ongoing' : (isAchieved ? 'achieved' : 'failed');
            }

            return {
                label: p.label,
                startDate: p.start,
                endDate: p.end,
                revenue: periodRevenue,
                target: periodTarget,
                bonus,
                status
            };
        });

        const totalPeriodBonus = periodStats.reduce((sum, p) => sum + p.bonus, 0);

        // Chờ thanh toán = doanh số bán - doanh số hoàn thành
        const pendingRevenue = salesRevenue - completedRevenue;

        const baseSalary = 8000000;
        const netIncome = baseSalary + actualReward + totalCommission + totalHotBonus + shippingFees + totalPeriodBonus;

        return {
            role: 'SALE',
            totalRevenue: Number(allTimeRevenue._sum.splitAmount || 0),
            salesRevenue,           // Doanh số bán (tất cả đơn trong kỳ)
            completedRevenue,       // Doanh số hoàn thành (đã xác nhận thanh toán)
            pendingRevenue: Math.max(0, pendingRevenue), // Doanh số chờ thanh toán
            monthlyRevenue: completedRevenue, // Backward compatible
            salesOrderCount,        // Tổng số đơn bán
            orderCount: splits.length, // Số đơn hoàn thành
            totalCommission,
            hotBonus: totalHotBonus,
            shippingFees,
            baseSalary, // Fixed base salary for Sales staff (NVBH)
            periodBonus: totalPeriodBonus,
            periodStats,
            netIncome,
            lowPriceStats: {
                count: lowPriceOrderCount,
                value: lowPriceRevenue,
                ratio: lowPriceRatio * 100
            },
            performance: {
                milestone: achievedRule ? Number(achievedRule.targetRevenue) : 0,
                milestoneBonus,
                actualReward,
                isPenalty,
                isClemency
            },
            kpiTarget: 200000000 // Base target 200tr
        };
    }

    private async getTelesaleStats(employeeId?: string, userId?: string, startStr?: string, endStr?: string) {
        // NOTE: For Telesale, since they earn 0.2% commission on the TOTAL system revenue,
        // we don't strictly need the employeeId to calculate the main stats.

        const now = new Date();
        const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = endStr ? new Date(endStr) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        if (endStr && !endStr.includes('T')) {
            endDate.setHours(23, 59, 59, 999);
        }

        const orderWhere: any = {
            isPaymentConfirmed: true,
            confirmedAt: { gte: startDate, lte: endDate },
            status: { notIn: ['canceled', 'rejected'] }
        };

        // 1. Fetch orders with necessary inclusions for breakdown
        const orders = await this.prisma.order.findMany({
            where: orderWhere,
            include: {
                branch: { select: { name: true } },
                items: { include: { product: { select: { name: true } } } }
            }
        });

        // 2. Calculate Basic Stats
        const systemRevenue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
        // Đếm tổng đơn bao gồm cả đơn chưa xác nhận cho thống kê
        const totalOrderCount = await this.prisma.order.count({
            where: {
                status: { notIn: ['canceled', 'rejected'] },
                orderDate: { gte: startDate, lte: endDate }
            }
        });
        const baseSalary = 6000000;
        const commission = systemRevenue * 0.002;

        // 3. Branch Stats
        const branchMap = new Map();
        orders.forEach(o => {
            const bName = o.branch.name;
            const current = branchMap.get(bName) || { name: bName, revenue: 0, orderCount: 0 };
            current.revenue += Number(o.totalAmount);
            current.orderCount += 1;
            branchMap.set(bName, current);
        });
        const branchStats = Array.from(branchMap.values()).sort((a, b) => b.revenue - a.revenue);

        // 4. Best Sellers
        const productMap = new Map();
        orders.forEach(o => {
            o.items.forEach(item => {
                const pName = item.product.name;
                const current = productMap.get(pName) || { name: pName, quantity: 0, revenue: 0 };
                current.quantity += item.quantity;
                current.revenue += Number(item.totalPrice);
                productMap.set(pName, current);
            });
        });
        const bestSellers = Array.from(productMap.values())
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 5);

        // 5. Revenue Trend (Daily, adjusted to GMT+7)
        const trendMap = new Map();
        orders.forEach(o => {
            const date = new Date(o.confirmedAt!.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
            const current = trendMap.get(date) || { date, revenue: 0 };
            current.revenue += Number(o.totalAmount);
            trendMap.set(date, current);
        });
        const revenueTrend = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        // 6. Source Breakdown
        const sourceMap = new Map();
        orders.forEach(o => {
            const source = o.orderSource || 'Vãng lai';
            const current = sourceMap.get(source) || { source, revenue: 0, count: 0 };
            current.revenue += Number(o.totalAmount);
            current.count += 1;
            sourceMap.set(source, current);
        });
        const sourceBreakdown = Array.from(sourceMap.values()).sort((a, b) => b.revenue - a.revenue);

        return {
            role: 'TELESALE',
            systemRevenue,
            totalOrderCount,
            baseSalary,
            commission,
            netIncome: baseSalary + commission,
            branchStats,
            bestSellers,
            revenueTrend,
            sourceBreakdown
        };
    }

    private async getMarketingStats(employeeId?: string, startStr?: string, endStr?: string) {
        if (!employeeId) return { error: 'Employee not found' };

        const now = new Date();
        const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = endStr ? new Date(endStr) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        if (endStr && !endStr.includes('T')) {
            endDate.setHours(23, 59, 59, 999);
        }

        // 1. Get Marketing Rules for this employee
        const rules = await this.prisma.marketingSalaryRule.findMany({
            where: { employeeId }
        });

        if (rules.length === 0) {
            return {
                role: 'MARKETING',
                totalReward: 0,
                branchStats: [],
                message: 'Chưa cấu hình mốc thưởng Marketing'
            };
        }

        const branches = await this.prisma.branch.findMany({
            include: {
                orders: {
                    where: {
                        isPaymentConfirmed: true,
                        confirmedAt: { gte: startDate, lte: endDate }
                    },
                    select: { totalAmount: true }
                }
            }
        });

        let totalReward = 0;
        const branchStats = branches.map(b => {
            const revenue = b.orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

            // Find applicable rule (highest threshold achieved?)
            // Usually there is just one rule per employee for Marketing, applying to each branch.
            const rule = rules[0]; // Assuming one rule for simplicity, as per Excel image
            const isAchieved = revenue >= Number(rule.revenueThreshold);
            const reward = isAchieved ? revenue * (Number(rule.commissionPercent) / 100) : 0;

            totalReward += reward;

            return {
                branchId: b.id,
                branchName: b.name,
                revenue,
                threshold: Number(rule.revenueThreshold),
                percent: Number(rule.commissionPercent),
                isAchieved,
                reward
            };
        });

        return {
            role: 'MARKETING',
            totalReward,
            branchStats
        };
    }

    async getViolatedOrders(userId: string, branchId: string, startStr?: string, endStr?: string) {
        const now = new Date();
        const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = endStr ? new Date(endStr) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        if (endStr && !endStr.includes('T')) {
            endDate.setHours(23, 59, 59, 999);
        }

        // Logic lọc đơn hàng đồng bộ hoàn toàn với getAccountingStats -> branchWhere & revenueOrders filter
        const orderWhere: any = {
            branchId,
            status: { notIn: ['canceled', 'rejected'] },
            items: {
                some: { isBelowMin: true }
            },
            isPaymentConfirmed: true,
            confirmedAt: { gte: startDate, lte: endDate }
        };

        const orders = await this.prisma.order.findMany({
            where: orderWhere,
            include: {
                items: {
                    where: { isBelowMin: true },
                    include: { product: true }
                },
                payments: true, // Needed if we want to double check or display
                splits: {
                    include: { employee: true },
                    take: 1
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        // Cẩn thận: getAccountingStats dùng filter thủ công trên mảng. 
        // Logic Prisma OR ở trên đã cover khá sát.
        // Ta map lại kết quả.

        return orders.map(o => ({
            id: o.id,
            customerName: o.customerName,
            totalAmount: Number(o.totalAmount),
            createdAt: o.createdAt,
            employeeName: o.splits[0]?.employee?.fullName || o.staffCode || 'N/A',
            violatedItems: o.items.map(i => ({
                productName: i.product.name,
                unitPrice: Number(i.unitPrice),
                minPrice: Number(i.product.minPrice),
                quantity: i.quantity
            }))
        }));
    }

    private async getDriverStats(employeeId?: string, startStr?: string, endStr?: string) {
        if (!employeeId) return { error: 'No employee record found' };

        const now = new Date();
        const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = endStr ? new Date(endStr) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        if (endStr && !endStr.includes('T')) {
            endDate.setHours(23, 59, 59, 999);
        }

        // 1. Fetch deliveries for this driver in the specified period
        const [deliveries, allTimeStats] = await Promise.all([
            this.prisma.delivery.findMany({
                where: {
                    driverId: employeeId,
                    createdAt: { gte: startDate, lte: endDate }
                },
                include: {
                    order: {
                        select: {
                            status: true,
                            totalAmount: true
                        }
                    }
                }
            }),
            this.prisma.delivery.aggregate({
                where: { driverId: employeeId },
                _count: { id: true },
                _sum: { deliveryFee: true }
            })
        ]);

        const monthlyDeliveredCount = deliveries.filter(d => d.order.status === 'delivered').length;
        const monthlyPendingCount = deliveries.filter(d => d.order.status === 'assigned' || d.order.status === 'pending').length;
        const monthlyShippingFees = deliveries.reduce((sum, d) => sum + Number(d.deliveryFee || 0), 0);

        return {
            role: 'DRIVER',
            monthlyStats: {
                totalTrips: deliveries.length,
                deliveredCount: monthlyDeliveredCount,
                pendingCount: monthlyPendingCount,
                shippingFees: monthlyShippingFees,
            },
            allTimeStats: {
                totalTrips: allTimeStats._count.id,
                totalShippingFees: Number(allTimeStats._sum.deliveryFee || 0)
            },
            recentDeliveries: deliveries.slice(0, 5).map(d => ({
                id: d.id,
                orderId: d.orderId,
                status: d.order.status,
                fee: Number(d.deliveryFee),
                date: d.createdAt
            }))
        };
    }
}
