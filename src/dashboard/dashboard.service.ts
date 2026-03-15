import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
    constructor(private prisma: PrismaService) { }

    async getDashboardData(userId: string, startDate?: string, endDate?: string, branchId?: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: {
                role: true,
                employee: true
            }
        });

        console.log(`[DEBUG_DASHBOARD] User: ${user?.username}, Role: ${user?.role?.code}, EmpID: ${user?.employee?.id}, BranchID: ${user?.employee?.branchId}`);

        if (!user) return { error: 'User not found' };

        switch (user.role.code) {
            case 'ADMIN':
            case 'DIRECTOR':
            case 'CHIEF_ACCOUNTANT':
            case 'ACCOUNTANT':
                return this.getAccountingStats(branchId, startDate, endDate, user.employee?.id);
            case 'MANAGER':
                return this.getManagerStats(user.employee?.id, user.employee?.branchId, startDate, endDate);
            case 'SALE':
                return this.getSaleStats(user.employee?.id, startDate, endDate);
            case 'TELESALE':
                return this.getTelesaleStats(user.employee?.id, userId, startDate, endDate);
            case 'MARKETING':
                return this.getMarketingStats(user.employee?.id, startDate, endDate);
            case 'DRIVER':
            case 'COMPANY_DRIVER':
            case 'DELIVERY_STAFF':
            case 'TECHNICIAN':
            case 'WAREHOUSE':
                return this.getDriverStats(user.employee?.id, startDate, endDate);
            default:
                return { message: 'Role not supported for dashboard yet' };
        }
    }

    async getLeaderboardData(userId: string, startStr?: string, endStr?: string, branchId?: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { role: true, employee: true }
        });

        if (!user) return { error: 'User not found' };

        // Manager can only see their own branch
        let effectiveBranchId = branchId;
        if (user.role.code === 'MANAGER') {
            effectiveBranchId = user.employee?.branchId;
            if (!effectiveBranchId) return { error: 'No branch assigned to manager' };
        }

        const { startDate, endDate, orderStartDate, orderEndDate } = this.getVNDateBounds(startStr, endStr);

        // Calculate all rankings
        const rankings = await this.getRankings(undefined, effectiveBranchId, startDate, endDate, orderStartDate, orderEndDate, true);

        return {
            ...rankings,
            userRole: user.role.code,
            branchId: effectiveBranchId
        };
    }

    private async getAccountingStats(branchId?: string, startStr?: string, endStr?: string, employeeId?: string) {
        const { startDate, endDate, orderStartDate, orderEndDate } = this.getVNDateBounds(startStr, endStr);

        // Individual salary for the logged-in user (if they have an employee record)
        let baseSalary = 0;
        let effectiveBaseSalary = 0;
        if (employeeId) {
            const salaryInfo = await this.calculateBaseSalary(employeeId, 0, orderStartDate, orderEndDate);
            baseSalary = salaryInfo.baseSalary;
            effectiveBaseSalary = salaryInfo.effectiveBaseSalary;
        }

        // Base filter for orders (Sales Revenue - theo ngày lên đơn)
        const salesOrderWhere: any = {
            status: { notIn: ['canceled', 'rejected'] },
            orderDate: { gte: orderStartDate, lte: orderEndDate }
        };
        if (branchId) salesOrderWhere.branchId = branchId;

        // Base filter for orders (Completed Revenue - theo ngày xác nhận thanh toán)
        const completedOrderWhere: any = {
            isPaymentConfirmed: true,
            status: { notIn: ['canceled', 'rejected'] },
            confirmedAt: { gte: startDate, lte: endDate }
        };
        if (branchId) completedOrderWhere.branchId = branchId;

        const [revResult, ordersCount, unconfirmedRevResult, unconfirmedCount, pendingInstallmentRevResult, pendingInstallmentCount, unissuedInvoiceCount, employeesCount, salesRevResult, salesOrderCount, debtOrdersData] = await Promise.all([
            this.prisma.order.aggregate({
                where: completedOrderWhere,
                _sum: { totalAmount: true }
            }),
            this.prisma.order.count({
                where: completedOrderWhere
            }),
            this.prisma.order.aggregate({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    isPaymentConfirmed: false,
                    payments: { none: { paymentMethod: 'INSTALLMENT' } },
                    createdAt: { lte: endDate }
                },
                _sum: { totalAmount: true }
            }),
            this.prisma.order.count({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    isPaymentConfirmed: false,
                    payments: { none: { paymentMethod: 'INSTALLMENT' } },
                    createdAt: { lte: endDate }
                }
            }),
            this.prisma.order.aggregate({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    isPaymentConfirmed: false,
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    createdAt: { lte: endDate }
                },
                _sum: { totalAmount: true }
            }),
            this.prisma.order.count({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    isPaymentConfirmed: false,
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    createdAt: { lte: endDate }
                }
            }),
            this.prisma.order.count({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    isInvoiceIssued: false,
                    payments: {
                        some: {
                            paymentMethod: { in: ['TRANSFER_COMPANY', 'CARD', 'INSTALLMENT', 'CREDIT'] }
                        }
                    },
                    createdAt: { lte: endDate }
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
                    orderDate: { gte: orderStartDate, lte: orderEndDate }
                },
                _sum: { totalAmount: true }
            }),
            this.prisma.order.count({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    orderDate: { gte: orderStartDate, lte: orderEndDate }
                }
            }),
            // 11. KHÁCH CÒN NỢ — Tất cả đơn chưa xác nhận thanh toán (lũy kế đến endDate)
            this.prisma.order.findMany({
                where: {
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['canceled', 'rejected'] },
                    isPaymentConfirmed: false,
                    createdAt: { lte: endDate }
                },
                select: {
                    totalAmount: true,
                    payments: {
                        select: { amount: true }
                    }
                }
            })
        ]);

        const totalRevenue = Number(revResult._sum.totalAmount || 0);
        const totalOrders = salesOrderCount; // Bao gồm tất cả đơn trong kỳ (không chỉ đơn đã confirm)
        const salesRevenue = Number(salesRevResult._sum.totalAmount || 0);
        const unconfirmedRevenue = Number(unconfirmedRevResult._sum.totalAmount || 0);
        const pendingInstallmentRevenue = Number(pendingInstallmentRevResult._sum.totalAmount || 0);

        // Calculate Debt Stats
        const processedDebtOrders = debtOrdersData.map(o => {
            const paid = o.payments.reduce((pSum, p) => pSum + Number(p.amount), 0);
            const remaining = Number(o.totalAmount) - paid;
            return { ...o, paid, remaining };
        }).filter(o => o.remaining > 0.01);

        const debtOrderCount = processedDebtOrders.length;
        const debtTotalAmount = processedDebtOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
        const debtPaidAmount = processedDebtOrders.reduce((sum, o) => sum + o.paid, 0);
        const debtRemainingAmount = debtTotalAmount - debtPaidAmount;

        const debtStats = {
            count: debtOrderCount,
            totalAmount: debtTotalAmount,
            paidAmount: debtPaidAmount,
            remainingAmount: debtRemainingAmount
        };

        // Get eligible order IDs for Payment Breakdown (Sử dụng các đơn HT trong kỳ)
        const eligibleOrders = await this.prisma.order.findMany({
            where: completedOrderWhere,
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

        // Filter for branch breakdown
        const branchWhere: any = {
            status: { notIn: ['canceled', 'rejected'] },
            OR: [
                {
                    // Orders created in period (for Sales Revenue)
                    orderDate: { gte: orderStartDate, lte: orderEndDate }
                },
                {
                    // Orders confirmed in period (for Completed Revenue)
                    isPaymentConfirmed: true,
                    confirmedAt: { gte: startDate, lte: endDate }
                },
                {
                    // Pending orders from anytime (for debt count / stats)
                    isPaymentConfirmed: false,
                    createdAt: { lte: endDate }
                },
                {
                    // Orders waiting for invoice
                    isInvoiceIssued: false,
                    createdAt: { lte: endDate }
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
                        branchId: true,
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

        // 5. Tính toán cho từng chi nhánh
        // Lấy tất cả split trong kỳ để tính doanh thu chia sẻ cho chi nhánh
        const [periodSplits, confirmedSplits] = await Promise.all([
            this.prisma.orderSplit.findMany({
                where: {
                    order: {
                        status: { notIn: ['canceled', 'rejected'] },
                        orderDate: { gte: orderStartDate, lte: orderEndDate }
                    }
                }
            }),
            this.prisma.orderSplit.findMany({
                where: {
                    order: {
                        status: { notIn: ['canceled', 'rejected'] },
                        isPaymentConfirmed: true,
                        confirmedAt: { gte: startDate, lte: endDate }
                    }
                }
            })
        ]);

        const branchStats = branches.map(b => {
            // Doanh số bán: Tổng splitAmount của các split thuộc chi nhánh này (đơn trong kỳ)
            const branchPeriodSplits = periodSplits.filter(s => s.branchId === b.id);
            const branchSalesRevenue = branchPeriodSplits.reduce((sum, s) => sum + Number(s.splitAmount), 0);

            // Doanh số hoàn thành: Tổng splitAmount của các split thuộc chi nhánh này (đơn đã xác nhận thanh toán trong kỳ)
            const branchConfirmedSplits = confirmedSplits.filter(s => s.branchId === b.id);
            const revenue = branchConfirmedSplits.reduce((sum, s) => sum + Number(s.splitAmount), 0);

            // Đơn bán: Chỉ tính đơn thuộc chi nhánh chủ quản (không tính đơn được chia)
            const allOrdersControlledByBranch = b.orders.filter(o =>
                o.branchId === b.id && o.orderDate >= orderStartDate && o.orderDate <= orderEndDate
            );
            const salesOrderCount = allOrdersControlledByBranch.length;

            // Đơn hoàn thành: Chỉ tính đơn thuộc chi nhánh chủ quản (Lọc theo confirmedAt)
            const revenueOrdersControlledByBranch = b.orders.filter(o =>
                o.branchId === b.id && o.isPaymentConfirmed && 
                o.confirmedAt && o.confirmedAt >= startDate && o.confirmedAt <= endDate
            );
            const completedOrderCount = revenueOrdersControlledByBranch.length;

            const lowPriceOrders = revenueOrdersControlledByBranch.filter(o => o.items.some(i => i.isBelowMin)).length;

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
                salesRevenue: branchSalesRevenue, // Doanh số bán (Tiền được chia)
                revenue,                           // Doanh số hoàn thành (Tiền được chia)
                pendingRevenue: Math.max(0, branchSalesRevenue - revenue), // Chờ thanh toán
                completedOrderCount,               // Đơn đã xác nhận (Đơn chủ quản)
                salesOrderCount,                   // Tổng đơn phát sinh (Đơn chủ quản)
                orderCount: completedOrderCount,    // BC: Đơn đã xác nhận
                totalOrders: salesOrderCount,      // BC: Tổng đơn phát sinh
                lowPriceRatio: completedOrderCount > 0 ? Math.round((lowPriceOrders / completedOrderCount) * 100) : 0,
                unconfirmedOrders,
                pendingInstallmentOrders,
                pendingInvoices
            };
        });

        // Sort by revenue for Top chart
        const topBranches = [...branchStats].sort((a, b) => b.revenue - a.revenue);

        // ===== Advanced Stats: Best Sellers (Lấy theo orderDate) =====
        const reportOrders = await this.prisma.order.findMany({
            where: {
                ...(branchId ? { branchId } : {}),
                status: { notIn: ['canceled', 'rejected'] },
                orderDate: { gte: orderStartDate, lte: orderEndDate }
            },
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
        });

        // Revenue Trend (ALL SYSTEM) - Show both Sales and Completed based on orderDate
        const allSystemOrders = await this.prisma.order.findMany({
            where: {
                status: { notIn: ['canceled', 'rejected'] },
                ...(branchId ? { branchId } : {}),
                OR: [
                    { orderDate: { gte: orderStartDate, lte: orderEndDate } },
                    { confirmedAt: { gte: startDate, lte: endDate }, isPaymentConfirmed: true }
                ]
            },
            select: {
                totalAmount: true,
                orderDate: true,
                confirmedAt: true,
                isPaymentConfirmed: true
            }
        });

        allSystemOrders.forEach(o => {
            // 1. Sales Trend (Plot on orderDate)
            if (o.orderDate >= orderStartDate && o.orderDate <= orderEndDate) {
                const sDate = new Date(o.orderDate.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
                const sEntry = trendMap.get(sDate) || { date: sDate, salesRevenue: 0, revenue: 0 };
                sEntry.salesRevenue += Number(o.totalAmount);
                trendMap.set(sDate, sEntry);
            }
            
            // 2. Completed Trend (Plot on confirmedAt)
            if (o.isPaymentConfirmed && o.confirmedAt && o.confirmedAt >= startDate && o.confirmedAt <= endDate) {
                const cDate = new Date(o.confirmedAt.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
                const cEntry = trendMap.get(cDate) || { date: cDate, salesRevenue: 0, revenue: 0 };
                cEntry.revenue += Number(o.totalAmount);
                trendMap.set(cDate, cEntry);
            }
        });

        const bestSellers = Array.from(productMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
        const revenueTrend = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        // ===== Top 5 Sales Employees =====
        const splitOrderWhere: any = {
            orderDate: { gte: orderStartDate, lte: orderEndDate },
            status: { notIn: ['canceled', 'rejected'] }
        };

        const topSalesSplits = await this.prisma.orderSplit.findMany({
            where: {
                order: splitOrderWhere,
                ...(branchId ? { branchId } : {})
            },
            include: {
                employee: {
                    include: { branch: true }
                }
            }
        });

        const employeeRevMap = new Map();
        topSalesSplits.forEach(split => {
            if (!split.employee) return;
            const empId = split.employeeId;
            const current = employeeRevMap.get(empId) || {
                id: empId,
                name: split.employee.fullName || '',
                position: split.employee.position || '',
                branchName: split.employee.branch?.name || '',
                revenue: 0,
            };
            current.revenue += Number(split.splitAmount);
            employeeRevMap.set(empId, current);
        });

        const topEmployees = Array.from(employeeRevMap.values())
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

        return {
            role: 'DIRECTOR', // Keep for FE component matching
            baseSalary,
            effectiveBaseSalary,
            isGlobal: !branchId,
            salesRevenue,           // Doanh số bán toàn hệ thống
            salesOrderCount,        // Tổng số đơn bán
            totalRevenue,           // Doanh số hoàn thành (backward compatible)
            completedRevenue: totalRevenue,
            pendingRevenueTotal: debtRemainingAmount, // Chuyển sang dùng nợ thực tế
            debtStats,              // Chi tiết nợ
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
            revenueTrend,
            topEmployees
        };
    }

    private async getManagerStats(employeeId?: string, branchId?: string, startStr?: string, endStr?: string) {
        if (!branchId) return { error: 'No branch assigned' };

        const { startDate, endDate, orderStartDate, orderEndDate } = this.getVNDateBounds(startStr, endStr);

        const currentEmployees = await this.prisma.employee.findMany({
            where: { branchId, status: 'Đang làm việc' },
            select: { id: true }
        });
        const currentEmployeeIds = currentEmployees.map(e => e.id);

        // ========= 1a. DOANH SỐ BÁN chi nhánh — Tất cả đơn theo ngày tạo đơn (createdAt) =========
        // Lấy doanh thu từ tiền được chia (Split)
        const branchSalesSplits = await this.prisma.orderSplit.findMany({
            where: {
                branchId,
                order: {
                    status: { notIn: ['canceled', 'rejected'] },
                    orderDate: { gte: orderStartDate, lte: orderEndDate }
                }
            },
            include: {
                order: {
                    include: {
                        items: { include: { product: true } }
                    }
                },
                employee: { include: { branch: true } }
            }
        });
        const branchSalesRevenue = branchSalesSplits.reduce((sum, s) => sum + Number(s.splitAmount), 0);

        // Đếm số đơn chủ quản của chi nhánh
        const branchSalesOrderCount = await this.prisma.order.count({
            where: {
                branchId,
                status: { notIn: ['canceled', 'rejected'] },
                orderDate: { gte: orderStartDate, lte: orderEndDate }
            }
        });

        // ========= 1b. DOANH SỐ HOÀN THÀNH chi nhánh — Đơn đã xác nhận (Lọc theo orderDate) =========
        // Lấy doanh thu từ tiền được chia (Split)
        const branchOrders = await this.prisma.orderSplit.findMany({
            where: {
                branchId,
                order: {
                    isPaymentConfirmed: true,
                    status: { notIn: ['canceled', 'rejected'] },
                    confirmedAt: { gte: startDate, lte: endDate }
                }
            },
            include: {
                order: {
                    include: {
                        items: { include: { product: true } },
                        deliveries: true
                    }
                },
                employee: {
                    include: { branch: true }
                }
            }
        });

        const branchRevenue = branchOrders.reduce((sum, split) => sum + Number(split.splitAmount), 0);
        const branchPendingRevenue = Math.max(0, branchSalesRevenue - branchRevenue);

        // ========= 2. Tính chỉ số giá dưới Min (branch-level) - Bao gồm cả đơn chưa xác nhận để cảnh báo sớm =========
        let lowPriceOrderCount = 0;
        let lowPriceRevenue = 0; // Tính trên doanh số bán (Sales)
        let lowPriceRatioConfirmed = 0; // Tỷ lệ thực tế (Confirmed)
        let lowPriceRevenueConfirmed = 0;

        for (const split of branchSalesSplits) {
            const order = split.order;
            const shareRatio = Number(split.splitAmount) / Number(order.totalAmount || 1);
            let hasMin = false;

            for (const item of order.items) {
                if (item.isBelowMin) {
                    hasMin = true;
                    const itemValue = Number(item.totalPrice) * shareRatio;
                    lowPriceRevenue += itemValue;
                }
            }
            if (hasMin) lowPriceOrderCount++;
        }

        for (const split of branchOrders) {
            const order = split.order;
            const shareRatio = Number(split.splitAmount) / Number(order.totalAmount || 1);
            for (const item of order.items) {
                if (item.isBelowMin) {
                    const itemValue = Number(item.totalPrice) * shareRatio;
                    lowPriceRevenueConfirmed += itemValue;
                }
            }
        }

        const lowPriceRatio = branchSalesRevenue > 0 ? (lowPriceRevenue / branchSalesRevenue) * 100 : 0;
        lowPriceRatioConfirmed = branchRevenue > 0 ? (lowPriceRevenueConfirmed / branchRevenue) * 100 : 0;

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
        const completedOrderWhere: any = {
            branchId,
            isPaymentConfirmed: true,
            confirmedAt: { gte: startDate, lte: endDate }
        };

        const [totalOrders, unconfirmedCount, pendingInstallmentCount, unissuedInvoiceCount, activeEmployees, eligibleOrders, debtOrdersData] = await Promise.all([
            // Tổng đơn trong kỳ (Bao gồm đơn chưa xác nhận)
            this.prisma.order.count({
                where: {
                    branchId,
                    status: { notIn: ['canceled', 'rejected'] },
                    orderDate: { gte: orderStartDate, lte: orderEndDate }
                }
            }),

            // Chờ khớp tiền (Đơn thường/CK chưa xác nhận - đến mốc endDate)
            this.prisma.order.count({
                where: {
                    branchId,
                    status: { notIn: ['canceled', 'rejected'] },
                    payments: { none: { paymentMethod: 'INSTALLMENT' } },
                    isPaymentConfirmed: false,
                    createdAt: { lte: endDate }
                }
            }),

            // Chờ duyệt trả góp (Đơn trả góp chưa xác nhận - đến mốc endDate)
            this.prisma.order.count({
                where: {
                    branchId,
                    status: { notIn: ['canceled', 'rejected'] },
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    isPaymentConfirmed: false,
                    createdAt: { lte: endDate }
                }
            }),

            // Chờ xuất hóa đơn (Chỉ các đơn theo PTTT quy định - đến mốc endDate)
            this.prisma.order.count({
                where: {
                    branchId,
                    status: { notIn: ['canceled', 'rejected'] },
                    isInvoiceIssued: false,
                    payments: {
                        some: {
                            paymentMethod: { in: ['TRANSFER_COMPANY', 'CARD', 'INSTALLMENT', 'CREDIT'] }
                        }
                    },
                    createdAt: { lte: endDate }
                }
            }),

            // Nhân sự đang làm việc
            this.prisma.employee.count({
                where: { branchId, status: 'Đang làm việc' }
            }),

            // Đơn hàng hợp lệ để tính cơ cấu thanh toán
            this.prisma.order.findMany({
                where: completedOrderWhere,
                select: { id: true }
            }),

            // KHÁCH CÒN NỢ — Tất cả đơn chưa xác nhận thanh toán của chi nhánh (lũy kế đến endDate)
            this.prisma.order.findMany({
                where: {
                    branchId,
                    status: { notIn: ['canceled', 'rejected'] },
                    isPaymentConfirmed: false,
                    createdAt: { lte: endDate }
                },
                select: {
                    totalAmount: true,
                    payments: {
                        select: { amount: true }
                    }
                }
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

        // ===== Advanced Stats: Best Sellers (Lấy theo orderDate & Branch) =====
        const mgrProductMap = new Map();
        const mgrTrendMap = new Map();

        // Lấy riêng danh sách đơn cho Best Sellers theo orderDate
        const bestSellerOrders = await this.prisma.order.findMany({
            where: {
                branchId,
                status: { notIn: ['canceled', 'rejected'] },
                orderDate: { gte: orderStartDate, lte: orderEndDate }
            },
            include: {
                items: { include: { product: { select: { name: true } } } }
            }
        });

        bestSellerOrders.forEach(o => {
            // Products
            o.items.forEach(item => {
                const pName = item.product.name;
                const current = mgrProductMap.get(pName) || { name: pName, quantity: 0, revenue: 0 };
                current.quantity += item.quantity;
                current.revenue += Number(item.totalPrice);
                mgrProductMap.set(pName, current);
            });
        });

        // Vẽ Trend dùng branchOrders (Hoàn thành) theo confirmedAt
        // và branchSalesSplits (Bán) theo orderDate
        branchSalesSplits.forEach(split => {
            const o = split.order;
            if (o.orderDate >= orderStartDate && o.orderDate <= orderEndDate) {
                const sDate = new Date(o.orderDate.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
                const sEntry = mgrTrendMap.get(sDate) || { date: sDate, salesRevenue: 0, revenue: 0 };
                sEntry.salesRevenue += Number(split.splitAmount);
                mgrTrendMap.set(sDate, sEntry);
            }
        });

        branchOrders.forEach(split => {
            const o = split.order;
            if (o.confirmedAt && o.confirmedAt >= startDate && o.confirmedAt <= endDate) {
                const cDate = new Date(o.confirmedAt.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
                const cEntry = mgrTrendMap.get(cDate) || { date: cDate, salesRevenue: 0, revenue: 0 };
                cEntry.revenue += Number(split.splitAmount);
                mgrTrendMap.set(cDate, cEntry);
            }
        });

        const bestSellers = Array.from(mgrProductMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
        const revenueTrend = Array.from(mgrTrendMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        // ===== Top 5 Sales Employees (Branch Specific) =====
        const employeeRevMap = new Map();
        branchSalesSplits.forEach(split => {
            if (!split.employee) return;
            const empId = split.employeeId;
            const current = employeeRevMap.get(empId) || {
                id: empId,
                name: split.employee.fullName || '',
                position: split.employee.position || '',
                branchName: '', // Managers know it's their branch, but keeping format consistent
                revenue: 0,
            };
            current.revenue += Number(split.splitAmount);
            employeeRevMap.set(empId, current);
        });

        const topEmployees = Array.from(employeeRevMap.values())
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5);

        // Calculate Debt Stats
        const processedDebtOrders = debtOrdersData.map(o => {
            const paid = o.payments.reduce((pSum, p) => pSum + Number(p.amount), 0);
            const remaining = Number(o.totalAmount) - paid;
            return { ...o, paid, remaining };
        }).filter(o => o.remaining > 0.01);

        const debtOrderCount = processedDebtOrders.length;
        const debtTotalAmount = processedDebtOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
        const debtPaidAmount = processedDebtOrders.reduce((sum, o) => sum + o.paid, 0);
        const debtRemainingAmount = debtTotalAmount - debtPaidAmount;

        const debtStats = {
            count: debtOrderCount,
            totalAmount: debtTotalAmount,
            paidAmount: debtPaidAmount,
            remainingAmount: debtRemainingAmount
        };

        // Calculate salary based on config and working days (Initial: use 0 as milestone salary to get base config)
        const { baseSalary: configBaseSalary, actualWorkingDays, effectiveStandardDays, effectiveBaseSalary } = await this.calculateBaseSalary(employeeId || '', 0, orderStartDate, orderEndDate);

        // ========= 5. Phản hồi kết quả khi chưa đạt mốc doanh số tối thiểu =========
        if (!achievedRule) {
            return {
                role: 'MANAGER',
                branchSalesRevenue,     // Doanh số bán chi nhánh
                branchRevenue,          // Doanh số hoàn thành chi nhánh
                branchPendingRevenue: debtRemainingAmount,   // Doanh số chờ thanh toán (nợ thực tế)
                debtStats,              // Chi tiết nợ
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
                baseSalary: configBaseSalary,
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
                netIncome: configBaseSalary,
                message: 'Chưa đạt mốc doanh số tối thiểu',
                bestSellers,
                revenueTrend,
                topEmployees,
                actualWorkingDays,
                effectiveStandardDays,
                effectiveBaseSalary,
                ranking: await this.getRankings(employeeId, branchId, startDate, endDate, orderStartDate, orderEndDate)
            };
        }

        const milestoneBaseSalary = Number(achievedRule.baseSalary);
        // Recalculate baseSalary with milestone amount if achieved
        const { baseSalary } = await this.calculateBaseSalary(employeeId || '', milestoneBaseSalary, orderStartDate, orderEndDate);
        
        const baseBonus = Number(achievedRule.bonusAmount);
        const commissionRate = Number(achievedRule.commissionPercent);

        // ========= 6. Tính hoa hồng, thưởng nóng, tiền ship =========
        let managerHotBonus = 0;
        let totalCommission = 0;

        for (const split of branchOrders) {
            const order = split.order;
            const orderTotal = Number(order.totalAmount);
            const splitAmount = Number(split.splitAmount);
            const netRevenue = orderTotal - Number(order.giftAmount || 0);
            const commissionFactor = orderTotal > 0 ? (netRevenue / orderTotal) : 0;
            const shareRatio = orderTotal > 0 ? (splitAmount / orderTotal) : 0;

            // 1. Calculate weighted commission for branch manager based on commissionRate
            // Formula: (SplitAmount - ProportionalGiftAmount) * commissionRate
            totalCommission += (splitAmount * commissionFactor * commissionRate) / 100;

            // 2. Calculate Hot Bonuses
            for (const item of order.items) {
                if (item.product.isHighEnd && item.managerBonusAmount) {
                    managerHotBonus += Number(item.managerBonusAmount) * item.quantity * shareRatio;
                }
            }
        }

        const commission = totalCommission;

        const shippingFees = 0; // Quản lý không được tính phí ship

        // ========= 7. Áp dụng logic phạt/khoan hồng (Dựa trên đơn hoàn thành) =========
        const isPenalty = lowPriceRatioConfirmed >= 20;
        const isClemency = branchRevenue >= Number(achievedRule.targetRevenue) * 1.1;

        let actualBonus = baseBonus;
        if (isPenalty && !isClemency) {
            actualBonus = baseBonus * 0.7;
        }

        // ========= 8. Tính thực nhận =========
        const netIncome = baseSalary + actualBonus + commission + managerHotBonus;
        // Loại bỏ + shippingFees

        return {
            role: 'MANAGER',
            baseSalary,
            effectiveBaseSalary,
            actualBonus,
            commission,
            hotBonus: managerHotBonus,
            netIncome,
            branchSalesRevenue,
            branchRevenue,
            branchPendingRevenue: debtRemainingAmount,
            debtStats,
            branchSalesOrderCount,
            monthlyRevenue: branchRevenue,
            totalOrders,
            cashAmount,
            transferAmount,
            unconfirmedCount,
            pendingInstallmentCount,
            unissuedInvoiceCount,
            activeEmployees,
            paymentMethodBreakdown: paymentBreakdownRaw,
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
            bestSellers,
            revenueTrend,
            topEmployees,
            ranking: await this.getRankings(employeeId, branchId, startDate, endDate, orderStartDate, orderEndDate)
        };
    }

    private async getSaleStats(employeeId?: string, startStr?: string, endStr?: string) {
        if (!employeeId) return { error: 'No employee record found' };

        const { startDate, endDate, orderStartDate, orderEndDate } = this.getVNDateBounds(startStr, endStr);
        const now = new Date();

        // 1. Fetch Salary Rules
        const salaryRules = await this.prisma.salesSalaryRule.findMany({
            orderBy: { targetRevenue: 'desc' }
        });

        // 2a. DOANH SỐ BÁN — Tất cả đơn theo ngày tạo đơn (createdAt)
        const salesSplits = await this.prisma.orderSplit.findMany({
            where: {
                employeeId,
                order: {
                    status: { notIn: ['canceled', 'rejected'] },
                    orderDate: { gte: orderStartDate, lte: orderEndDate }
                }
            },
            include: {
                order: {
                    select: {
                        id: true,
                        orderDate: true,
                        totalAmount: true,
                        isPaymentConfirmed: true,
                        giftAmount: true,
                        items: true
                    }
                }
            }
        });
        const salesRevenue = salesSplits.reduce((sum, s) => sum + Number(s.splitAmount), 0);
        const salesOrderCount = new Set(salesSplits.map(s => s.orderId)).size;


        // 2c. KHÁCH CÒN NỢ (Của nhân viên này) — Tất cả đơn chưa xác nhận thanh toán (lũy kế đến endDate)
        const debtSplitsRaw = await this.prisma.orderSplit.findMany({
            where: {
                employeeId,
                order: {
                    status: { notIn: ['canceled', 'rejected'] },
                    isPaymentConfirmed: false,
                    createdAt: { lte: endDate }
                }
            },
            include: {
                order: {
                    select: {
                        totalAmount: true,
                        payments: { select: { amount: true } }
                    }
                }
            }
        });

        const processedSplits = debtSplitsRaw.map(split => {
            const splitAmount = Number(split.splitAmount);
            const orderTotal = Number(split.order.totalAmount);
            const paidTotal = split.order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
            const orderRemaining = orderTotal - paidTotal;
            const shareRatio = orderTotal > 0 ? (splitAmount / orderTotal) : 0;
            return {
                ...split,
                orderRemaining,
                splitPaid: paidTotal * shareRatio
            };
        }).filter(s => s.orderRemaining > 0.01);

        const debtOrderCount = new Set(processedSplits.map(s => s.orderId)).size;
        let debtTotalAmount = 0;
        let debtPaidAmount = 0;

        for (const split of processedSplits) {
            debtTotalAmount += Number(split.splitAmount);
            debtPaidAmount += split.splitPaid;
        }
        const debtRemainingAmount = debtTotalAmount - debtPaidAmount;

        const debtStats = {
            count: debtOrderCount,
            totalAmount: debtTotalAmount,
            paidAmount: debtPaidAmount,
            remainingAmount: debtRemainingAmount
        };

        let completedRevenue = 0;
        let lowPriceRevenueAll = 0;
        let lowPriceOrderCount = 0;
        let lowPriceRevenueConfirmed = 0;
        let totalCommission = 0;
        let totalHotBonus = 0;

        for (const split of salesSplits) {
            const splitAmount = Number(split.splitAmount);
            const order = split.order;
            const orderTotal = Number(order.totalAmount);

            // Chỉ tính doanh thu hoàn thành và hoa hồng cho đơn đã confirm
            if (order.isPaymentConfirmed) {
                completedRevenue += splitAmount;
            }

            if (orderTotal > 0) {
                const shareRatio = splitAmount / orderTotal;
                const netRevenue = orderTotal - Number(order.giftAmount || 0);
                const commissionFactor = orderTotal > 0 ? (netRevenue / orderTotal) : 0;

                let orderLowPriceValue = 0;
                let hasLowPriceItem = false;

                for (const item of order.items) {
                    const price = Number(item.unitPrice);
                    const minPrice = Number(item.minPriceAtSale);
                    const itemTotal = Number(item.totalPrice);
                    
                    if (order.isPaymentConfirmed) {
                        // Commission = itemTotal * rate (1.8% or 1%) * commissionFactor (to subtract gift)
                        const rate = item.isBelowMin ? 0.01 : 0.018;
                        totalCommission += itemTotal * rate * shareRatio * commissionFactor;

                        // Hot Bonus (Thưởng nóng) = saleBonusAmount (snapshot in OrderItem)
                        totalHotBonus += Number(item.saleBonusAmount) * item.quantity * shareRatio;
                    }

                    if (price < minPrice) {
                        const itemValue = price * item.quantity;
                        orderLowPriceValue += itemValue;
                        hasLowPriceItem = true;
                        
                        if (order.isPaymentConfirmed) {
                            lowPriceRevenueConfirmed += itemValue * shareRatio;
                        }
                    }
                }

                lowPriceRevenueAll += orderLowPriceValue * shareRatio;
                if (hasLowPriceItem) lowPriceOrderCount++;
            }
        }

        const lowPriceRevenue = lowPriceRevenueAll; // Keep variable name for compatibility
        const lowPriceRatioAll = salesRevenue > 0 ? (lowPriceRevenueAll / salesRevenue) : 0;
        const lowPriceRatioConfirmed = completedRevenue > 0 ? (lowPriceRevenueConfirmed / completedRevenue) : 0;

        // 3. Fetch Shipping Fees (from deliveries where sale is the driver)
        const deliveries = await this.prisma.delivery.findMany({
            where: {
                driverId: employeeId,
                order: {
                    isPaymentConfirmed: true,
                    orderDate: { gte: orderStartDate, lte: orderEndDate }
                }
            }
        });
        const shippingFees = deliveries.reduce((sum, d) => sum + Number(d.deliveryFee), 0);

        // 4. Calculate Milestones & Rewards — Dùng DOANH SỐ HOÀN THÀNH để tính lương
        const achievedRule = salaryRules.find(rule => completedRevenue >= Number(rule.targetRevenue));
        const milestoneBonus = achievedRule ? Number(achievedRule.bonusAmount) : 0;

        const lowPriceRatio = lowPriceRatioAll; // For display on card
        const isPenalty = lowPriceRatioConfirmed >= 0.2;
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
            const periodRevenue = salesSplits.filter(s => {
                const o = s.order;
                const orderDate = o.orderDate;
                return o.isPaymentConfirmed && orderDate && orderDate >= p.start && orderDate <= p.end;
            }).reduce((sum, s) => sum + Number(s.splitAmount), 0);

            const periodSalesRevenue = salesSplits.filter(s => {
                const orderDate = s.order.orderDate;
                return orderDate && orderDate >= p.start && orderDate <= p.end;
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
                salesRevenue: periodSalesRevenue,
                revenue: periodRevenue,
                target: periodTarget,
                bonus,
                status
            };
        });

        const totalPeriodBonus = periodStats.reduce((sum, p) => sum + p.bonus, 0);

        // Chờ thanh toán = doanh số bán - doanh số hoàn thành
        const pendingRevenue = salesRevenue - completedRevenue;

        const milestoneBaseSalary = achievedRule ? Number(achievedRule.baseSalary) : 0;
        const { baseSalary, actualWorkingDays, effectiveStandardDays, effectiveBaseSalary } = await this.calculateBaseSalary(employeeId, milestoneBaseSalary, orderStartDate, orderEndDate);

        const netIncome = baseSalary + actualReward + totalCommission + totalHotBonus + shippingFees + totalPeriodBonus;

        return {
            role: 'SALE',
            totalRevenue: Number(allTimeRevenue._sum.splitAmount || 0),
            salesRevenue,           // Doanh số bán (tất cả đơn trong kỳ)
            completedRevenue,       // Doanh số hoàn thành (đã xác nhận thanh toán)
            pendingRevenue: debtRemainingAmount, // Chuyển sang dùng nợ thực tế
            debtStats,                           // Chi tiết nợ
            monthlyRevenue: completedRevenue, // Backward compatible
            salesOrderCount,        // Tổng số đơn bán
            orderCount: salesSplits.filter(s => s.order.isPaymentConfirmed).length, // Số đơn hoàn thành
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
            kpiTarget: 200000000, // Base target 200tr
            actualWorkingDays,
            effectiveStandardDays,
            effectiveBaseSalary,
            ranking: await this.getRankings(employeeId, undefined, startDate, endDate, orderStartDate, orderEndDate)
        };
    }

    private async getTelesaleStats(employeeId?: string, userId?: string, startStr?: string, endStr?: string) {
        // NOTE: For Telesale, since they earn 0.2% commission on the TOTAL system revenue,
        // we don't strictly need the employeeId to calculate the main stats.

        const { startDate, endDate, orderStartDate, orderEndDate } = this.getVNDateBounds(startStr, endStr);

        const orderWhere: any = {
            isPaymentConfirmed: true,
            orderDate: { gte: orderStartDate, lte: orderEndDate },
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

        // 2. Calculate Basic Stats (Sử dụng Gross Amount để đồng bộ với Giám đốc/Kế toán)
        const systemRevenue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

        // Doanh số bán toàn hệ thống (Dùng để hiển thị, vẫn là Gross)
        const systemSalesResult = await this.prisma.order.aggregate({
            where: {
                status: { notIn: ['canceled', 'rejected'] },
                orderDate: { gte: orderStartDate, lte: orderEndDate }
            },
            _sum: { totalAmount: true }
        });
        const systemSalesRevenue = Number(systemSalesResult._sum.totalAmount || 0);

        // Đếm tổng đơn bao gồm cả đơn chưa xác nhận cho thống kê
        const totalOrderCount = await this.prisma.order.count({
            where: {
                status: { notIn: ['canceled', 'rejected'] },
                orderDate: { gte: orderStartDate, lte: orderEndDate }
            }
        });
        // Telesale default base is 6M if not configured
        const { baseSalary, actualWorkingDays, effectiveStandardDays, effectiveBaseSalary } = await this.calculateBaseSalary(employeeId || '', 6000000, orderStartDate, orderEndDate);
        
        // Tính hoa hồng trên doanh thu thực tế (sau khi trừ quà tặng nếu cần) 
        // hoặc tính trên doanh thu gộp để đồng bộ hiển thị. 
        // Ở đây chọn tính trên gross để khớp với "Tiền về hệ thống" đang hiển thị.
        const commission = systemRevenue * 0.002;

        // 3. Branch Stats
        const branches = await this.prisma.branch.findMany();

        const branchStats = await Promise.all(branches.map(async (b) => {
            // Doanh số bán (Tất cả đơn trong kỳ)
            const salesResult = await this.prisma.order.aggregate({
                where: {
                    branchId: b.id,
                    status: { notIn: ['canceled', 'rejected'] },
                    orderDate: { gte: orderStartDate, lte: orderEndDate }
                },
                _sum: { totalAmount: true }
            });
            const branchSalesRevenue = Number(salesResult._sum.totalAmount || 0);

            // Doanh số hoàn thành (Đơn đã xác nhận trong kỳ)
            const revenueResult = await this.prisma.order.aggregate({
                where: {
                    branchId: b.id,
                    isPaymentConfirmed: true,
                    status: { notIn: ['canceled', 'rejected'] },
                    orderDate: { gte: orderStartDate, lte: orderEndDate }
                },
                _sum: { totalAmount: true }
            });
            const branchRevenue = Number(revenueResult._sum.totalAmount || 0);

            // Đếm số đơn bán
            const salesOrderCount = await this.prisma.order.count({
                where: {
                    branchId: b.id,
                    status: { notIn: ['canceled', 'rejected'] },
                    orderDate: { gte: orderStartDate, lte: orderEndDate }
                }
            });

            return {
                id: b.id,
                name: b.name,
                salesRevenue: branchSalesRevenue,
                revenue: branchRevenue,
                orderCount: salesOrderCount
            };
        }));
        branchStats.sort((a, b) => b.salesRevenue - a.salesRevenue);

        // 4. Best Sellers (Lấy theo orderDate toàn bộ hệ thống)
        const productMap = new Map();
        const systemProductOrders = await this.prisma.order.findMany({
            where: {
                status: { notIn: ['canceled', 'rejected'] },
                orderDate: { gte: orderStartDate, lte: orderEndDate }
            },
            include: {
                items: { include: { product: { select: { name: true } } } }
            }
        });

        systemProductOrders.forEach(o => {
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
            const date = new Date(o.orderDate.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
            const current = trendMap.get(date) || { date, revenue: 0, salesRevenue: 0 };
            current.revenue += Number(o.totalAmount);
            trendMap.set(date, current);
        });

        // Add sales revenue to trend
        const allSystemSales = await this.prisma.order.findMany({
            where: {
                status: { notIn: ['canceled', 'rejected'] },
                orderDate: { gte: orderStartDate, lte: orderEndDate }
            },
            select: { orderDate: true, totalAmount: true }
        });

        allSystemSales.forEach(o => {
            const date = new Date(o.orderDate.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
            const current = trendMap.get(date) || { date, revenue: 0, salesRevenue: 0 };
            current.salesRevenue += Number(o.totalAmount);
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
            systemSalesRevenue,
            totalOrderCount,
            completedOrderCount: orders.length,
            baseSalary,
            effectiveBaseSalary,
            commission,
            netIncome: baseSalary + commission,
            branchStats,
            bestSellers,
            revenueTrend,
            sourceBreakdown,
            actualWorkingDays,
            effectiveStandardDays
        };
    }

    private async getMarketingStats(employeeId?: string, startStr?: string, endStr?: string) {
        if (!employeeId) return { error: 'Employee not found' };

        const { startDate, endDate, orderStartDate, orderEndDate } = this.getVNDateBounds(startStr, endStr);

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
                         orderDate: { gte: orderStartDate, lte: orderEndDate }
                     },
                     select: { totalAmount: true, giftAmount: true }
                }
            }
        });

        let totalReward = 0;
        const branchStats = branches.map(b => {
            const revenue = b.orders.reduce((sum, o) => {
                const netOrderRevenue = Number(o.totalAmount) - Number(o.giftAmount || 0);
                return sum + netOrderRevenue;
            }, 0);

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

        const { baseSalary, actualWorkingDays, effectiveStandardDays, effectiveBaseSalary } = await this.calculateBaseSalary(employeeId, 0, orderStartDate, orderEndDate);

        return {
            role: 'MARKETING',
            baseSalary,
            totalReward,
            netIncome: baseSalary + totalReward,
            branchStats,
            actualWorkingDays,
            effectiveStandardDays,
            effectiveBaseSalary
        };
    }

    async getViolatedOrders(userId: string, branchId: string, startStr?: string, endStr?: string) {
        const { startDate, endDate, orderStartDate, orderEndDate } = this.getVNDateBounds(startStr, endStr);

        // Logic lọc đơn hàng đồng bộ hoàn toàn với getAccountingStats -> branchWhere & revenueOrders filter
        const orderWhere: any = {
            status: { notIn: ['canceled', 'rejected'] },
            items: {
                some: { isBelowMin: true }
            },
            orderDate: { gte: orderStartDate, lte: orderEndDate }
        };

        // Nếu là Manager thì chỉ xem được chi nhánh của mình
        if (branchId) {
            orderWhere.branchId = branchId;
        }

        const orders = await this.prisma.order.findMany({
            where: orderWhere,
            include: {
                items: {
                    where: { isBelowMin: true },
                    select: {
                        unitPrice: true,
                        minPriceAtSale: true,
                        quantity: true,
                        product: { select: { name: true } }
                    }
                },
                payments: true, // Needed if we want to double check or display
                splits: {
                    where: branchId ? { branchId } : {}, 
                    include: { employee: true }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        return orders.map(o => {
            const branchTotalPercent = o.splits.reduce((sum, s) => sum + Number(s.splitPercent), 0);
            const shareRatio = branchTotalPercent / 100;

            return {
                id: o.id,
                customerName: o.customerName,
                totalAmount: Number(o.totalAmount),
                orderDate: o.orderDate,
                createdAt: o.createdAt,
                employeeName: o.splits.map(s => s.employee?.fullName).join(', ') || o.staffCode || 'N/A',
                isSplit: branchTotalPercent > 0 && branchTotalPercent < 100,
                branchSharePercent: branchTotalPercent,
                violatedItems: o.items.map(i => ({
                    productName: i.product.name,
                    unitPrice: Number(i.unitPrice),
                    minPrice: Number(i.minPriceAtSale),
                    splitUnitPrice: Number(i.unitPrice) * shareRatio,
                    splitMinPrice: Number(i.minPriceAtSale) * shareRatio,
                    quantity: i.quantity
                }))
            };
        });
    }

    private async getDriverStats(employeeId?: string, startStr?: string, endStr?: string) {
        if (!employeeId) return { error: 'No employee record found' };

        const { startDate, endDate, orderStartDate, orderEndDate } = this.getVNDateBounds(startStr, endStr);

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
                            totalAmount: true,
                            customerName: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            }),
            this.prisma.delivery.aggregate({
                where: { driverId: employeeId },
                _count: { id: true },
                _sum: { deliveryFee: true }
            })
        ]);

        const monthlyDeliveredCount = deliveries.filter(d => d.order.status === 'delivered').length;
        const monthlyPendingCount = deliveries.filter(d => d.order.status === 'assigned' || d.order.status === 'pending').length;
        const completedShippingFees = deliveries
            .filter(d => d.order.status === 'delivered')
            .reduce((sum, d) => sum + Number(d.deliveryFee || 0), 0);
        const estimatedShippingFees = deliveries.reduce((sum, d) => sum + Number(d.deliveryFee || 0), 0);

        const { baseSalary, actualWorkingDays, effectiveStandardDays, effectiveBaseSalary } = await this.calculateBaseSalary(employeeId, 0, orderStartDate, orderEndDate);

        return {
            role: 'DRIVER',
            baseSalary,
            effectiveBaseSalary,
            actualWorkingDays,
            effectiveStandardDays,
            netIncome: baseSalary + completedShippingFees,
            monthlyStats: {
                totalTrips: deliveries.length,
                deliveredCount: monthlyDeliveredCount,
                pendingCount: monthlyPendingCount,
                completedShippingFees,
                estimatedShippingFees,
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
                date: d.createdAt,
            customerName: d.order.customerName
            }))
        };
    }

    private async calculateBaseSalary(employeeId: string, baseSalaryFromMilestone: number, orderStartDate: Date, orderEndDate: Date) {
        const employee = await this.prisma.employee.findUnique({
            where: { id: employeeId },
            include: { pos: true }
        });

        if (!employee) return { baseSalary: baseSalaryFromMilestone, actualWorkingDays: 0, effectiveStandardDays: 27, effectiveBaseSalary: baseSalaryFromMilestone };

        const attendances = await this.prisma.attendance.findMany({
            where: {
                employeeId,
                date: { gte: orderStartDate, lte: orderEndDate },
                checkInTime: { not: null }
            }
        });

        const actualWorkingDays = attendances.length;
        const rawConfigBaseSalary = (employee as any).customBaseSalary ?? (employee as any).pos?.baseSalary;
        const rawConfigStandardDays = (employee as any).customStandardWorkingDays ?? (employee as any).pos?.standardWorkingDays;

        const effectiveBaseSalary = rawConfigBaseSalary != null ? Number(rawConfigBaseSalary) : baseSalaryFromMilestone;
        const effectiveStandardDays = rawConfigStandardDays != null ? Number(rawConfigStandardDays) : 27;

        console.log(`[DEBUG] Employee: ${employee.fullName}, raw: ${rawConfigBaseSalary}, effectiveSalary: ${effectiveBaseSalary}, fromMilestone: ${baseSalaryFromMilestone}`);

        let baseSalary = 0;
        if (effectiveStandardDays > 0) {
            if (actualWorkingDays >= effectiveStandardDays) {
                baseSalary = effectiveBaseSalary;
            } else {
                baseSalary = (actualWorkingDays / effectiveStandardDays) * effectiveBaseSalary;
            }
        } else {
            baseSalary = effectiveBaseSalary;
        }

        return {
            baseSalary,
            effectiveBaseSalary,
            actualWorkingDays,
            effectiveStandardDays
        };
    }

    private async getRankings(employeeId?: string, branchId?: string, startDate?: Date, endDate?: Date, orderStartDate?: Date, orderEndDate?: Date, fullStats: boolean = false) {
        if (!startDate || !endDate) return null;

        // 1. Get splits to calculate ranks
        const whereSales: any = {
            order: {
                status: { notIn: ['canceled', 'rejected'] },
                orderDate: { gte: orderStartDate, lte: orderEndDate }
            }
        };
        const whereCompleted: any = {
            order: {
                status: { notIn: ['canceled', 'rejected'] },
                isPaymentConfirmed: true,
                orderDate: { gte: orderStartDate, lte: orderEndDate }
            }
        };

        // Calculate rankings globally so "Top Server" rank is correct even for non-global views
        // No longer filtering by branchId here.

        const [salesSplits, completedSplits] = await Promise.all([
            this.prisma.orderSplit.findMany({
                where: whereSales,
                select: { employeeId: true, splitAmount: true, branchId: true }
            }),
            this.prisma.orderSplit.findMany({
                where: whereCompleted,
                select: { employeeId: true, splitAmount: true, branchId: true }
            })
        ]);

        const processRankMap = (splits: any[]) => {
            const empMap = new Map<string, number>();
            const branchMap = new Map<string, number>();
            const empToMainBranch = new Map<string, string>(); // Track employee's branch from splits

            splits.forEach(s => {
                if (s.employeeId) {
                    empMap.set(s.employeeId, (empMap.get(s.employeeId) || 0) + Number(s.splitAmount));
                    if (s.branchId) empToMainBranch.set(s.employeeId, s.branchId);
                }
                if (s.branchId) {
                    branchMap.set(s.branchId, (branchMap.get(s.branchId) || 0) + Number(s.splitAmount));
                }
            });

            const empSorted = Array.from(empMap.entries()).sort((a, b) => b[1] - a[1]);
            const branchSorted = Array.from(branchMap.entries()).sort((a, b) => b[1] - a[1]);

            // Group employees by branch to calculate branch rank
            const branchGroups = new Map<string, { id: string, amount: number }[]>();
            empSorted.forEach(([id, amount]) => {
                const bId = empToMainBranch.get(id) || 'unknown';
                if (!branchGroups.has(bId)) branchGroups.set(bId, []);
                branchGroups.get(bId)?.push({ id, amount });
            });

            const branchRankMap = new Map<string, number>(); // employeeId -> rank in its branch
            branchGroups.forEach((emps) => {
                // emps are already sorted by amount because they come from empSorted
                emps.forEach((e, idx) => {
                    branchRankMap.set(e.id, idx + 1);
                });
            });

            return {
                employeeRanks: empSorted.map(([id, amount], idx) => ({
                    id,
                    amount,
                    rank: idx + 1,
                    branchRank: branchRankMap.get(id) || null
                })),
                branchRanks: branchSorted.map(([id, amount], idx) => ({ id, amount, rank: idx + 1 })),
                empToMainBranch
            };
        };

        const salesStats = processRankMap(salesSplits);
        const completedStats = processRankMap(completedSplits);

        const result: any = {};

        if (fullStats) {
            // Find all active employees with roles SALE or TELESALE
            // and also any employee who had sales/completed orders in this period
            const employeeIdsWithSplits = Array.from(new Set([
                ...salesStats.employeeRanks.map(r => r.id),
                ...completedStats.employeeRanks.map(r => r.id)
            ]));

            const employees = await this.prisma.employee.findMany({
                where: {
                    OR: [
                        { id: { in: employeeIdsWithSplits } },
                        {
                            status: { not: 'Nghỉ việc' },
                            user: {
                                role: { code: { in: ['SALE'] } },
                                isActive: true
                            }
                        }
                    ]
                },
                include: { branch: true }
            });

            // Map results and filter by branchId if requested for the LIST view
            const mapEmp = (ranks: any[]) => {
                const existingIds = new Set(ranks.map(r => r.id));
                const fullList = [...ranks];

                // Append employees who are in the target group but had no sales in this period
                employees.forEach(emp => {
                    if (!existingIds.has(emp.id)) {
                        fullList.push({
                            id: emp.id,
                            amount: 0,
                            rank: fullList.length + 1,
                            branchRank: null
                        });
                    }
                });

                let filtered = fullList;
                if (branchId) {
                    filtered = fullList.filter(r => {
                        const emp = employees.find(e => e.id === r.id);
                        return emp?.branchId === branchId;
                    });
                }
                return filtered.map(r => {
                    const emp = employees.find(e => e.id === r.id);
                    return {
                        ...r,
                        name: emp?.fullName,
                        position: emp?.position,
                        branchName: (emp as any)?.branch?.name,
                        branchId: emp?.branchId,
                        avatarUrl: emp?.avatarUrl
                    };
                });
            };

            result.employees = {
                sales: mapEmp(salesStats.employeeRanks),
                completed: mapEmp(completedStats.employeeRanks)
            };

            const branchIds = Array.from(new Set([
                ...salesStats.branchRanks.map(r => r.id),
                ...completedStats.branchRanks.map(r => r.id)
            ]));

            const branches = await this.prisma.branch.findMany({
                where: { id: { in: branchIds } }
            });

            const mapBranch = (ranks: any[]) => {
                let filtered = ranks;
                if (branchId) {
                    filtered = ranks.filter(r => r.id === branchId);
                }
                return filtered.map(r => {
                    const br = branches.find(b => b.id === r.id);
                    return { ...r, name: br?.name };
                });
            };

            result.branches = {
                sales: mapBranch(salesStats.branchRanks),
                completed: mapBranch(completedStats.branchRanks)
            };
        }

        if (employeeId) {
            const sRankFull = salesStats.employeeRanks.find(r => r.id === employeeId);
            const cRankFull = completedStats.employeeRanks.find(r => r.id === employeeId);

            const branchIdOfEmp = salesStats.empToMainBranch.get(employeeId);
            const branchEmpCount = Array.from(salesStats.empToMainBranch.values()).filter(id => id === branchIdOfEmp).length;

            result.employee = {
                sales: { rank: sRankFull?.rank || null, totalCount: salesStats.employeeRanks.length },
                completed: { rank: cRankFull?.rank || null, totalCount: completedStats.employeeRanks.length },
                branchSales: { rank: sRankFull?.branchRank || null, totalCount: branchEmpCount },
                branchCompleted: { rank: cRankFull?.branchRank || null, totalCount: branchEmpCount }
            };
        }

        if (branchId) {
            const sRank = salesStats.branchRanks.find(r => r.id === branchId);
            const cRank = completedStats.branchRanks.find(r => r.id === branchId);

            result.branch = {
                sales: { rank: sRank?.rank || null, totalCount: salesStats.branchRanks.length },
                completed: { rank: cRank?.rank || null, totalCount: completedStats.branchRanks.length }
            };

            // Top performer in branch (Local rank)
            const branchEmpSales = salesStats.employeeRanks
                .filter(r => salesStats.empToMainBranch.get(r.id) === branchId)
                .sort((a, b) => b.amount - a.amount);
            const branchEmpCompleted = completedStats.employeeRanks
                .filter(r => completedStats.empToMainBranch.get(r.id) === branchId)
                .sort((a, b) => b.amount - a.amount);

            const topStaffIds = Array.from(new Set([
                branchEmpSales[0]?.id,
                branchEmpCompleted[0]?.id
            ].filter(id => !!id)));

            const topStaffDetails = topStaffIds.length > 0
                ? await this.prisma.employee.findMany({
                    where: { id: { in: topStaffIds } }
                })
                : [];

            const findDetail = (id: string) => topStaffDetails.find(e => e.id === id);

            result.branchTopStaff = {
                sales: branchEmpSales[0] ? {
                    id: branchEmpSales[0].id,
                    amount: branchEmpSales[0].amount,
                    name: findDetail(branchEmpSales[0].id)?.fullName,
                    avatarUrl: findDetail(branchEmpSales[0].id)?.avatarUrl
                } : null,
                completed: branchEmpCompleted[0] ? {
                    id: branchEmpCompleted[0].id,
                    amount: branchEmpCompleted[0].amount,
                    name: findDetail(branchEmpCompleted[0].id)?.fullName,
                    avatarUrl: findDetail(branchEmpCompleted[0].id)?.avatarUrl
                } : null
            };

            // Top performers from this branch on Global Leaderboard (Server rank)
            // Note: branchEmpSales are already part of global salesStats.employeeRanks
            result.serverTopStaff = {
                sales: branchEmpSales[0] ? {
                    ...branchEmpSales[0],
                    name: findDetail(branchEmpSales[0].id)?.fullName,
                    avatarUrl: findDetail(branchEmpSales[0].id)?.avatarUrl,
                    totalCount: salesStats.employeeRanks.length
                } : null,
                completed: branchEmpCompleted[0] ? {
                    ...branchEmpCompleted[0],
                    name: findDetail(branchEmpCompleted[0].id)?.fullName,
                    avatarUrl: findDetail(branchEmpCompleted[0].id)?.avatarUrl,
                    totalCount: completedStats.employeeRanks.length
                } : null
            };
        }

        return result;
    }

    private getVNDateBounds(startStr?: string, endStr?: string) {
        // For TIMESTAMP columns (confirmedAt, createdAt, updatedAt) — need VN timezone offset
        let startDate: Date;
        let endDate: Date;
        // For DATE columns (orderDate) — need UTC midnight (no timezone offset)
        let orderStartDate: Date;
        let orderEndDate: Date;

        if (startStr) {
            startDate = new Date(`${startStr}T00:00:00+07:00`);
            orderStartDate = new Date(`${startStr}T00:00:00Z`);
        } else {
            const now = new Date();
            // Mặc định là đầu tháng hiện tại theo giờ VN
            startDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1) - 7 * 60 * 60 * 1000);
            orderStartDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
        }

        if (endStr) {
            endDate = new Date(`${endStr}T23:59:59.999+07:00`);
            orderEndDate = new Date(`${endStr}T23:59:59.999Z`);
        } else {
            const now = new Date();
            // Mặc định là cuối tháng hiện tại theo giờ VN
            endDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999) - 7 * 60 * 60 * 1000);
            orderEndDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));
        }

        return { startDate, endDate, orderStartDate, orderEndDate };
    }
}
