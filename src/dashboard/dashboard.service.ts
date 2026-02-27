import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
    constructor(private prisma: PrismaService) { }

    async getDashboardData(userId: string) {
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
            case 'ACCOUNTANT':
            case 'CHIEF_ACCOUNTANT':
                return this.getDirectorStats();
            case 'MANAGER':
                return this.getManagerStats(user.employee?.branchId);
            case 'SALE':
                return this.getSaleStats(user.employee?.id);
            case 'TELESALE':
                return this.getTelesaleStats(user.employee?.id, userId);
            case 'MARKETING':
                return this.getMarketingStats(user.employee?.id);
            default:
                return { message: 'Role not supported for dashboard yet' };
        }
    }

    private async getDirectorStats() {
        const [revResult, ordersCount, employeesCount] = await Promise.all([
            this.prisma.order.aggregate({
                _sum: { totalAmount: true }
            }),
            this.prisma.order.count(),
            this.prisma.employee.count({
                where: { status: 'Đang làm việc' }
            })
        ]);

        const totalRevenue = Number(revResult._sum.totalAmount || 0);

        // Top Branches
        const topBranches = await this.prisma.branch.findMany({
            include: {
                orders: {
                    select: { totalAmount: true }
                }
            }
        });

        // Calculate branch revenue and alerts manually
        const kpiAlerts: any[] = [];
        const branchStats = await Promise.all(topBranches.map(async b => {
            const revenue = b.orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

            // Calculate low price stats for this branch
            const ordersWithLowPrice = await this.prisma.order.count({
                where: {
                    branchId: b.id,
                    items: { some: { isBelowMin: true } }
                }
            });

            const totalBranchOrders = b.orders.length;
            if (totalBranchOrders > 0) {
                const ratio = ordersWithLowPrice / totalBranchOrders;
                if (ratio > 0.1) { // Alert if > 10%
                    kpiAlerts.push({
                        branchName: b.name,
                        count: ordersWithLowPrice,
                        total: totalBranchOrders,
                        ratio: Math.round(ratio * 100)
                    });
                }
            }

            return {
                name: b.name,
                revenue,
                orderCount: totalBranchOrders
            };
        }));

        branchStats.sort((a, b) => b.revenue - a.revenue);

        // Diagnostic log
        console.log(`[Dashboard] Revenue: ${totalRevenue}, Orders: ${ordersCount}, Employees: ${employeesCount}`);

        return {
            role: 'DIRECTOR', // Keep consistent for frontend check, or update both
            totalRevenue: totalRevenue,
            totalOrders: Number(ordersCount),
            activeEmployees: Number(employeesCount),
            topBranches: branchStats.slice(0, 5),
            kpiAlerts
        };
    }

    private async getManagerStats(branchId?: string, month?: number, year?: number) {
        if (!branchId) return { error: 'No branch assigned' };

        const now = new Date();
        const targetMonth = month || now.getMonth() + 1;
        const targetYear = year || now.getFullYear();

        const startDate = new Date(targetYear, targetMonth - 1, 1);
        const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

        // ========= 1. Tính tổng doanh số chi nhánh =========
        const branchOrders = await this.prisma.orderSplit.findMany({
            where: {
                employee: { branchId },
                order: {
                    orderDate: {
                        gte: startDate,
                        lte: endDate
                    }
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
        const nextRule = salaryRules.reverse().find(rule => branchRevenue < Number(rule.targetRevenue));

        if (!achievedRule) {
            return {
                role: 'MANAGER',
                branchRevenue: 0,
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

        // ========= 9. Lấy danh sách các mốc để hiển thị KPI =========
        const allMilestones = salaryRules.reverse().map(rule => ({
            percent: rule.targetPercent,
            targetRevenue: Number(rule.targetRevenue),
            baseSalary: Number(rule.baseSalary),
            bonusAmount: Number(rule.bonusAmount),
            commissionRate: Number(rule.commissionPercent),
            isAchieved: branchRevenue >= Number(rule.targetRevenue)
        }));

        return {
            role: 'MANAGER',
            branchRevenue,
            monthlyRevenue: branchRevenue,
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

    private async getSaleStats(employeeId?: string) {
        if (!employeeId) return { error: 'No employee record found' };

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        // 1. Fetch Salary Rules
        const salaryRules = await this.prisma.salesSalaryRule.findMany({
            orderBy: { targetRevenue: 'desc' }
        });

        // 2. Fetch Order Splits for this month
        const splits = await this.prisma.orderSplit.findMany({
            where: {
                employeeId,
                order: {
                    orderDate: { gte: startOfMonth, lte: endOfMonth }
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
                createdAt: { gte: startOfMonth, lte: endOfMonth }
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
            where: { employeeId },
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

    private async getTelesaleStats(employeeId?: string, userId?: string) {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

        // Get ALL orders where source is 'FACEBOOK' for the current month
        const orders = await this.prisma.order.findMany({
            where: {
                orderSource: { equals: 'FACEBOOK', mode: 'insensitive' },
                createdAt: { gte: firstDay }
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

    private async getMarketingStats(employeeId?: string) {
        if (!employeeId) return { error: 'Employee not found' };

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

        // For now, Marketing logic applies to all branches? 
        // Or do we have a specific list of branches they manage?
        // User image says "mỗi CN ds >= 500tr", implying we check all.
        const branches = await this.prisma.branch.findMany({
            include: {
                orders: {
                    where: {
                        createdAt: {
                            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                        }
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
}
