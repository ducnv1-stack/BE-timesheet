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
                return this.getAccountingStats(undefined, startDate, endDate);
            case 'ACCOUNTANT':
                return this.getAccountingStats(user.employee?.branchId, startDate, endDate);
            case 'MANAGER':
                return this.getManagerStats(user.employee?.branchId, startDate, endDate);
            case 'SALE':
                return this.getSaleStats(user.employee?.id, startDate, endDate);
            case 'TELESALE':
                return this.getTelesaleStats(user.employee?.id, userId, startDate, endDate);
            case 'MARKETING':
                return this.getMarketingStats(user.employee?.id, startDate, endDate);
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

        // Base filter for orders
        const orderWhere: any = {
            OR: [
                {
                    payments: { none: { paymentMethod: 'INSTALLMENT' } },
                    orderDate: { gte: startDate, lte: endDate }
                },
                {
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    isPaymentConfirmed: true,
                    confirmedAt: { gte: startDate, lte: endDate }
                }
            ]
        };
        if (branchId) orderWhere.branchId = branchId;

        const [revResult, ordersCount, unconfirmedRevResult, unconfirmedCount, unissuedInvoiceCount, employeesCount] = await Promise.all([
            this.prisma.order.aggregate({
                where: orderWhere,
                _sum: { totalAmount: true }
            }),
            this.prisma.order.count({ where: orderWhere }),
            this.prisma.order.aggregate({
                where: {
                    ...(branchId ? { branchId } : {}),
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    isPaymentConfirmed: false,
                    orderDate: { gte: startDate, lte: endDate }
                },
                _sum: { totalAmount: true }
            }),
            this.prisma.order.count({
                where: {
                    ...(branchId ? { branchId } : {}),
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    isPaymentConfirmed: false,
                    orderDate: { gte: startDate, lte: endDate }
                }
            }),
            this.prisma.order.count({
                where: { ...orderWhere, isInvoiceIssued: false }
            }),
            this.prisma.employee.count({
                where: {
                    status: 'Đang làm việc',
                    ...(branchId ? { branchId } : {})
                }
            })
        ]);

        const totalRevenue = Number(revResult._sum.totalAmount || 0);
        const unconfirmedRevenue = Number(unconfirmedRevResult._sum.totalAmount || 0);

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

        // Top Branches / All Branches Table
        const branchWhere: any = {
            OR: [
                {
                    payments: { none: { paymentMethod: 'INSTALLMENT' } },
                    orderDate: { gte: startDate, lte: endDate }
                },
                {
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    isPaymentConfirmed: true,
                    confirmedAt: { gte: startDate, lte: endDate }
                },
                {
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    isPaymentConfirmed: false,
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
                        isPaymentConfirmed: true,
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
            const revenueOrders = b.orders.filter(o =>
                (o.payments.every(p => p.paymentMethod !== 'INSTALLMENT')) ||
                (o.payments.some(p => p.paymentMethod === 'INSTALLMENT') && o.isPaymentConfirmed)
            );
            const revenue = revenueOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
            const lowPriceOrders = revenueOrders.filter(o => o.items.some(i => i.isBelowMin)).length;

            // Pending Installments specifically for "Chờ khớp tiền"
            const unconfirmedOrders = b.orders.filter(o =>
                o.payments.some(p => p.paymentMethod === 'INSTALLMENT') && !o.isPaymentConfirmed
            ).length;

            const pendingInvoices = revenueOrders.filter(o => !o.isInvoiceIssued).length;

            return {
                id: b.id,
                name: b.name,
                revenue,
                orderCount: revenueOrders.length,
                lowPriceRatio: revenueOrders.length > 0 ? Math.round((lowPriceOrders / revenueOrders.length) * 100) : 0,
                unconfirmedOrders,
                pendingInvoices
            };
        });

        // Sort by revenue for Top chart
        const topBranches = [...branchStats].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

        return {
            role: 'DIRECTOR', // Keep for FE component matching
            isGlobal: !branchId,
            totalRevenue,
            unconfirmedRevenue,
            totalOrders: ordersCount,
            unconfirmedCount,
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
            }))
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

        // ========= 1. Tính tổng doanh số chi nhánh =========
        const branchOrders = await this.prisma.orderSplit.findMany({
            where: {
                employee: { branchId },
                order: {
                    OR: [
                        {
                            payments: { none: { paymentMethod: 'INSTALLMENT' } },
                            orderDate: { gte: startDate, lte: endDate }
                        },
                        {
                            payments: { some: { paymentMethod: 'INSTALLMENT' } },
                            isPaymentConfirmed: true,
                            confirmedAt: { gte: startDate, lte: endDate }
                        }
                    ]
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

        // Các mốc để hiển thị KPI progress bar
        const allMilestones = [...salaryRules].reverse().map(rule => ({
            percent: rule.targetPercent,
            targetRevenue: Number(rule.targetRevenue),
            baseSalary: Number(rule.baseSalary),
            bonusAmount: Number(rule.bonusAmount),
            commissionRate: Number(rule.commissionPercent),
            isAchieved: branchRevenue >= Number(rule.targetRevenue)
        }));

        // Nếu chưa đạt mốc nào → lương/thưởng = 0, vẫn trả đủ dữ liệu
        if (!achievedRule) {
            // Vẫn cần tính operational stats trước khi return
            const earlyOrderWhere: any = {
                branchId,
                OR: [
                    {
                        payments: { none: { paymentMethod: 'INSTALLMENT' } },
                        orderDate: { gte: startDate, lte: endDate }
                    },
                    {
                        payments: { some: { paymentMethod: 'INSTALLMENT' } },
                        isPaymentConfirmed: true,
                        confirmedAt: { gte: startDate, lte: endDate }
                    }
                ]
            };
            const [earlyTotalOrders, earlyUnconfirmed, earlyUnissued, earlyActiveEmp, earlyEligibleOrders] = await Promise.all([
                this.prisma.order.count({ where: earlyOrderWhere }),
                this.prisma.order.count({
                    where: {
                        branchId,
                        payments: { some: { paymentMethod: 'INSTALLMENT' } },
                        isPaymentConfirmed: false,
                        orderDate: { gte: startDate, lte: endDate }
                    }
                }),
                this.prisma.order.count({ where: { ...earlyOrderWhere, isInvoiceIssued: false } }),
                this.prisma.employee.count({ where: { branchId, status: 'Đang làm việc' } }),
                this.prisma.order.findMany({ where: earlyOrderWhere, select: { id: true } })
            ]);
            const earlyEligibleIds = earlyEligibleOrders.map(o => o.id);
            const earlyMethods = ['CASH', 'TRANSFER_COMPANY', 'TRANSFER_PERSONAL', 'CARD', 'INSTALLMENT'];
            const earlyBreakdown = await Promise.all(earlyMethods.map(async method => {
                const sum = await this.prisma.payment.aggregate({
                    where: { paymentMethod: method, orderId: { in: earlyEligibleIds } },
                    _sum: { amount: true }
                });
                return { method, amount: Number(sum._sum.amount || 0) };
            }));
            const earlyCash = earlyBreakdown.find(p => p.method === 'CASH')?.amount || 0;
            const earlyTransfer = earlyBreakdown.filter(p => ['TRANSFER_COMPANY', 'TRANSFER_PERSONAL', 'CARD'].includes(p.method)).reduce((s, p) => s + p.amount, 0);

            return {
                role: 'MANAGER',
                branchRevenue,
                monthlyRevenue: branchRevenue,
                totalOrders: earlyTotalOrders,
                cashAmount: earlyCash,
                transferAmount: earlyTransfer,
                unconfirmedCount: earlyUnconfirmed,
                unissuedInvoiceCount: earlyUnissued,
                activeEmployees: earlyActiveEmp,
                paymentMethodBreakdown: earlyBreakdown,
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
                message: 'Chưa đạt mốc doanh số tối thiểu'
            };
        }

        const baseSalary = Number(achievedRule.baseSalary);
        const baseBonus = Number(achievedRule.bonusAmount);
        const commissionRate = Number(achievedRule.commissionPercent);

        // ========= 4. Tính hoa hồng =========
        const commission = (branchRevenue * commissionRate) / 100;

        // ========= 5. Tính thưởng nóng (30% từ nhân viên) =========
        let totalBranchHotBonus = 0;

        for (const split of branchOrders) {
            for (const item of split.order.items) {
                if (item.product.isHighEnd && item.saleBonusAmount) {
                    const splitRatio = Number(split.splitPercent) / 100;
                    totalBranchHotBonus += Number(item.saleBonusAmount) * item.quantity * splitRatio;
                }
            }
        }

        const managerHotBonus = totalBranchHotBonus * 0.3;

        // ========= 6. Tính tiền ship (từ deliveries) =========
        const shippingFees = branchOrders.reduce((sum, split) => {
            const splitRatio = Number(split.splitPercent) / 100;
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

        // ========= 9. Lấy thống kê vận hành chi nhánh =========
        const orderWhere: any = {
            branchId,
            OR: [
                {
                    payments: { none: { paymentMethod: 'INSTALLMENT' } },
                    orderDate: { gte: startDate, lte: endDate }
                },
                {
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    isPaymentConfirmed: true,
                    confirmedAt: { gte: startDate, lte: endDate }
                }
            ]
        };

        const [totalOrders, unconfirmedCount, unissuedInvoiceCount, activeEmployees, eligibleOrders] = await Promise.all([
            this.prisma.order.count({ where: orderWhere }),
            this.prisma.order.count({
                where: {
                    branchId,
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    isPaymentConfirmed: false,
                    orderDate: { gte: startDate, lte: endDate }
                }
            }),
            this.prisma.order.count({
                where: { ...orderWhere, isInvoiceIssued: false }
            }),
            this.prisma.employee.count({
                where: { branchId, status: 'Đang làm việc' }
            }),
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

        return {
            role: 'MANAGER',
            branchRevenue,
            monthlyRevenue: branchRevenue,
            totalOrders,
            cashAmount,
            transferAmount,
            unconfirmedCount,
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
            netIncome
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

        // 2. Fetch Order Splits for this month
        const splits = await this.prisma.orderSplit.findMany({
            where: {
                employeeId,
                order: {
                    OR: [
                        {
                            payments: { none: { paymentMethod: 'INSTALLMENT' } },
                            orderDate: { gte: startDate, lte: endDate }
                        },
                        {
                            payments: { some: { paymentMethod: 'INSTALLMENT' } },
                            isPaymentConfirmed: true,
                            confirmedAt: { gte: startDate, lte: endDate }
                        }
                    ]
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

        let monthlyRevenue = 0;
        let lowPriceRevenue = 0;
        let lowPriceOrderCount = 0;
        let totalCommission = 0;
        let totalHotBonus = 0;

        for (const split of splits) {
            const splitAmount = Number(split.splitAmount);
            monthlyRevenue += splitAmount;

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
                    OR: [
                        {
                            payments: { none: { paymentMethod: 'INSTALLMENT' } },
                            orderDate: { gte: startDate, lte: endDate }
                        },
                        {
                            payments: { some: { paymentMethod: 'INSTALLMENT' } },
                            isPaymentConfirmed: true,
                            confirmedAt: { gte: startDate, lte: endDate }
                        }
                    ]
                }
            }
        });
        const shippingFees = deliveries.reduce((sum, d) => sum + Number(d.deliveryFee), 0);

        // 4. Calculate Milestones & Rewards (consistent with employees.service.ts)
        const achievedRule = salaryRules.find(rule => monthlyRevenue >= Number(rule.targetRevenue));
        const milestoneBonus = achievedRule ? Number(achievedRule.bonusAmount) : 0;

        const lowPriceRatio = monthlyRevenue > 0 ? (lowPriceRevenue / monthlyRevenue) : 0;
        const isPenalty = lowPriceRatio >= 0.2;
        let isClemency = false;
        let actualReward = milestoneBonus;

        if (isPenalty) {
            actualReward = milestoneBonus * 0.7;
            if (achievedRule && monthlyRevenue >= Number(achievedRule.targetRevenue) * 1.1) {
                actualReward = milestoneBonus;
                isClemency = true;
            }
        }

        // 5. All-time revenue for total stats
        const allTimeRevenue = await this.prisma.orderSplit.aggregate({
            where: {
                employeeId,
                order: {
                    OR: [
                        { payments: { none: { paymentMethod: 'INSTALLMENT' } } },
                        { payments: { some: { paymentMethod: 'INSTALLMENT' } }, isPaymentConfirmed: true }
                    ]
                }
            },
            _sum: { splitAmount: true }
        });

        return {
            role: 'SALE',
            totalRevenue: Number(allTimeRevenue._sum.splitAmount || 0),
            monthlyRevenue,
            orderCount: splits.length,
            totalCommission,
            hotBonus: totalHotBonus,
            shippingFees,
            baseSalary: 8000000, // Fixed base salary for Sales staff (NVBH)
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
        if (!employeeId) return { error: 'No employee record found' };

        const now = new Date();
        const startDate = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = endStr ? new Date(endStr) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        if (endStr && !endStr.includes('T')) {
            endDate.setHours(23, 59, 59, 999);
        }

        // Get ALL orders where source is 'FACEBOOK' for the current month
        const orders = await this.prisma.order.findMany({
            where: {
                orderSource: { equals: 'FACEBOOK', mode: 'insensitive' },
                OR: [
                    {
                        payments: { none: { paymentMethod: 'INSTALLMENT' } },
                        orderDate: { gte: startDate, lte: endDate }
                    },
                    {
                        payments: { some: { paymentMethod: 'INSTALLMENT' } },
                        isPaymentConfirmed: true,
                        confirmedAt: { gte: startDate, lte: endDate }
                    }
                ]
            }
        });

        // Revenue is the sum of totalAmount for all monthly Facebook orders
        const fbRevenue = orders.reduce((sum, order) => sum + Number(order.totalAmount), 0);
        const fbOrderCount = orders.length;

        // Get commission rule (0.3% default if not in DB)
        const rule = await this.prisma.telesaleSalaryRule.findFirst();
        const rate = rule ? Number(rule.commissionPercent) / 100 : 0.003;
        const commission = fbRevenue * rate;

        return {
            role: 'TELESALE',
            fbRevenue,
            fbOrderCount,
            commission,
            recentOrders: orders.slice(0, 5)
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
                        OR: [
                            {
                                payments: { none: { paymentMethod: 'INSTALLMENT' } },
                                orderDate: { gte: startDate, lte: endDate }
                            },
                            {
                                payments: { some: { paymentMethod: 'INSTALLMENT' } },
                                isPaymentConfirmed: true,
                                confirmedAt: { gte: startDate, lte: endDate }
                            }
                        ]
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

        // Logic lọc đơn hàng giống getAccountingStats
        const orderWhere: any = {
            branchId,
            items: {
                some: { isBelowMin: true }
            },
            OR: [
                {
                    payments: { none: { paymentMethod: 'INSTALLMENT' } },
                    orderDate: { gte: startDate, lte: endDate }
                },
                {
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    isPaymentConfirmed: true,
                    confirmedAt: { gte: startDate, lte: endDate }
                }
            ]
        };

        const orders = await this.prisma.order.findMany({
            where: orderWhere,
            include: {
                items: {
                    where: { isBelowMin: true },
                    include: { product: true }
                },
                splits: {
                    include: { employee: true },
                    take: 1
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 20
        });

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
}
