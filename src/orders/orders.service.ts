import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';

@Injectable()
export class OrdersService {
    constructor(private prisma: PrismaService) { }

    async create(createOrderDto: CreateOrderDto, userId: string) {
        const { items, splits, payments, gifts, deliveries, ...orderData } = createOrderDto;

        return this.prisma.$transaction(async (tx) => {
            // 1. Calculate and validate items
            let totalAmount = new Decimal(0);
            let calculatedProductBonusTotal = new Decimal(0);

            const itemProcessing = await Promise.all(
                items.map(async (item: any) => {
                    const product = await tx.product.findUnique({
                        where: { id: item.productId },
                        include: { bonusRules: { orderBy: { minSellPrice: 'desc' } } },
                    });

                    if (!product) {
                        throw new BadRequestException(`Product ${item.productId} not found`);
                    }

                    const lineTotal = new Decimal(item.unitPrice).mul(item.quantity);
                    totalAmount = totalAmount.add(lineTotal);

                    // Logic Snapshot: Min Price & Bonus
                    const isBelowMin = new Decimal(item.unitPrice).lt(product.minPrice);

                    // Find applicable bonus
                    let bonusAmount = new Decimal(0);
                    let saleBonusAmount = new Decimal(0);
                    let managerBonusAmount = new Decimal(0);

                    if (product.isHighEnd) {
                        const applicableRule = product.bonusRules.find(rule =>
                            new Decimal(item.unitPrice).gte(rule.minSellPrice)
                        );

                        if (applicableRule) {
                            bonusAmount = applicableRule.bonusAmount;
                            saleBonusAmount = bonusAmount.mul(applicableRule.salePercent).div(100);
                            managerBonusAmount = bonusAmount.mul(applicableRule.managerPercent).div(100);
                            calculatedProductBonusTotal = calculatedProductBonusTotal.add(bonusAmount.mul(item.quantity));
                        }
                    }

                    return {
                        productId: item.productId,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        totalPrice: lineTotal,
                        minPriceAtSale: product.minPrice,
                        isBelowMin,
                        bonusAmount,
                        saleBonusAmount,
                        managerBonusAmount,
                    };
                }),
            );

            // 1.1 Calculate Gifts
            let totalGiftAmount = new Decimal(0);
            const giftProcessing = gifts ? await Promise.all(
                gifts.map(async (g: any) => {
                    const gift = await tx.gift.findUnique({ where: { id: g.giftId } });
                    if (!gift) throw new BadRequestException(`Gift ${g.giftId} not found`);

                    const gAmount = new Decimal(gift.price).mul(g.quantity);
                    totalGiftAmount = totalGiftAmount.add(gAmount);

                    return {
                        giftId: g.giftId,
                        quantity: g.quantity,
                    };
                })
            ) : [];

            const netRevenue = totalAmount.sub(totalGiftAmount);

            // Validate splits (Total Split Percent must be 100)
            const totalSplitPercent = splits.reduce((sum: number, s: any) => sum + s.splitPercent, 0);
            if (Math.abs(totalSplitPercent - 100) > 0.01) {
                throw new BadRequestException('Total split percentage must be approximately 100%');
            }

            // 2. Create Order
            const order = await tx.order.create({
                data: {
                    ...orderData,
                    totalAmount,
                    giftAmount: totalGiftAmount,
                    status: (deliveries && deliveries.length > 0) ? 'assigned' : 'pending',
                    productBonusAmount: calculatedProductBonusTotal,
                    createdBy: userId,
                    provinceId: orderData.provinceId,
                    wardId: orderData.wardId,
                    orderDate: orderData.orderDate ? new Date(orderData.orderDate) : new Date(),
                    customerCardIssueDate: (orderData.customerCardIssueDate && orderData.customerCardIssueDate.trim() !== '')
                        ? new Date(orderData.customerCardIssueDate)
                        : null,
                    items: {
                        create: itemProcessing,
                    },
                    gifts: gifts ? {
                        create: giftProcessing,
                    } : undefined,
                    splits: {
                        create: splits.map((s: any) => ({
                            employeeId: s.employeeId,
                            branchId: s.branchId,
                            splitPercent: s.splitPercent,
                            splitAmount: s.splitAmount !== undefined ? new Decimal(s.splitAmount) : totalAmount.mul(s.splitPercent).div(100),
                        })),
                    },
                    payments: {
                        create: payments.map((p: any) => ({
                            paymentMethod: p.paymentMethod,
                            amount: p.amount,
                            paidAt: new Date(p.paidAt),
                        })),
                    },
                    deliveries: (deliveries && deliveries.length > 0) ? {
                        create: deliveries.map((d: any) => {
                            let fee = 0;
                            if (d.category === 'COMPANY_DRIVER') fee = 50000;
                            else if (d.category === 'EXTERNAL_DRIVER') fee = 0;
                            else if (d.category === 'STAFF_DELIVERER') fee = 70000;
                            else if (d.category === 'SELLING_SALE') fee = 100000;
                            else if (d.category === 'OTHER_SALE') fee = 200000;

                            return {
                                driverId: d.driverId || null,
                                driverType: d.category, // map to legacy field just in case
                                category: d.category,
                                role: (d.category === 'COMPANY_DRIVER' || d.category === 'EXTERNAL_DRIVER') ? 'DRIVER' : 'STAFF',
                                deliveryFee: d.deliveryFee !== undefined ? d.deliveryFee : fee,
                            };
                        })
                    } : undefined,
                },
            });

            // 3. Fetch full created state for log
            const finalOrder = await tx.order.findUnique({
                where: { id: order.id },
                include: {
                    items: { include: { product: true } },
                    gifts: { include: { gift: true } },
                    splits: { include: { employee: true, branch: true } },
                    payments: true,
                    branch: true,
                    creator: { include: { employee: true } },
                    deliveries: { include: { driver: true } },
                    province: true,
                    ward: true,
                }
            });

            if (finalOrder && (finalOrder as any).creator?.employee) {
                (finalOrder as any).employee = (finalOrder as any).creator.employee;
            }

            // 4. Create Audit Log
            await tx.orderAuditLog.create({
                data: {
                    orderId: order.id,
                    changedBy: userId,
                    action: 'create',
                    newData: finalOrder as any,
                },
            });

            return finalOrder;
        });
    }

    async update(id: string, updateOrderDto: UpdateOrderDto, userId: string) {
        const { items, splits, payments, gifts, deliveries, ...orderData } = updateOrderDto;

        const originalOrder = await this.prisma.order.findUnique({
            where: { id },
            include: {
                items: { include: { product: true } },
                gifts: { include: { gift: true } },
                splits: { include: { employee: true, branch: true } },
                payments: true,
                branch: true,
                deliveries: { include: { driver: true } },
                creator: { include: { employee: true } },
                province: true,
                ward: true,
            }
        });

        // Map creator's employee for logging UI
        if (originalOrder && (originalOrder as any).creator?.employee) {
            (originalOrder as any).employee = (originalOrder as any).creator.employee;
        }

        if (!originalOrder) {
            throw new BadRequestException(`Order ${id} not found`);
        }

        return this.prisma.$transaction(async (tx) => {
            let totalAmount = new Decimal(0);
            let calculatedProductBonusTotal = new Decimal(0);
            let itemProcessing: any[] = [];

            // 1. Recalculate if items provided
            if (items) {
                itemProcessing = await Promise.all(
                    items.map(async (item) => {
                        const product = await tx.product.findUnique({
                            where: { id: item.productId },
                            include: { bonusRules: { orderBy: { minSellPrice: 'desc' } } },
                        });

                        if (!product) throw new BadRequestException(`Product ${item.productId} not found`);

                        const lineTotal = new Decimal(item.unitPrice).mul(item.quantity);
                        totalAmount = totalAmount.add(lineTotal);
                        const isBelowMin = new Decimal(item.unitPrice).lt(product.minPrice);

                        let bonusAmount = new Decimal(0);
                        let saleBonusAmount = new Decimal(0);
                        let managerBonusAmount = new Decimal(0);

                        if (product.isHighEnd) {
                            const rule = product.bonusRules.find(r => new Decimal(item.unitPrice).gte(r.minSellPrice));
                            if (rule) {
                                bonusAmount = rule.bonusAmount;
                                saleBonusAmount = bonusAmount.mul(rule.salePercent).div(100);
                                managerBonusAmount = bonusAmount.mul(rule.managerPercent).div(100);
                                calculatedProductBonusTotal = calculatedProductBonusTotal.add(bonusAmount.mul(item.quantity));
                            }
                        }

                        return {
                            productId: item.productId,
                            quantity: item.quantity,
                            unitPrice: item.unitPrice,
                            totalPrice: lineTotal,
                            minPriceAtSale: product.minPrice,
                            isBelowMin,
                            bonusAmount,
                            saleBonusAmount,
                            managerBonusAmount,
                        };
                    })
                );
            } else {
                totalAmount = originalOrder.totalAmount;
                calculatedProductBonusTotal = originalOrder.productBonusAmount;
            }

            // 1.1 Calculate Gifts if provided or use original
            let totalGiftAmount = originalOrder.giftAmount;
            let giftProcessing: any[] = [];
            if (gifts) {
                totalGiftAmount = new Decimal(0);
                giftProcessing = await Promise.all(
                    gifts.map(async (g: any) => {
                        const gift = await tx.gift.findUnique({ where: { id: g.giftId } });
                        if (!gift) throw new BadRequestException(`Gift ${g.giftId} not found`);
                        const gAmount = new Decimal(gift.price).mul(g.quantity);
                        totalGiftAmount = totalGiftAmount.add(gAmount);
                        return { giftId: g.giftId, quantity: g.quantity };
                    })
                );
            }

            const netRevenue = totalAmount.sub(totalGiftAmount);

            // 2. Validate splits
            if (splits) {
                const totalSplitPercent = splits.reduce((sum, s) => sum + s.splitPercent, 0);
                if (Math.abs(totalSplitPercent - 100) > 0.01) {
                    throw new BadRequestException('Total split percentage must be approximately 100%');
                }
            }

            // 3. Update Order
            const updatedOrder = await tx.order.update({
                where: { id },
                data: {
                    ...orderData,
                    totalAmount,
                    giftAmount: totalGiftAmount,
                    productBonusAmount: calculatedProductBonusTotal,
                    provinceId: orderData.provinceId,
                    wardId: orderData.wardId,
                    orderDate: orderData.orderDate ? new Date(orderData.orderDate) : originalOrder.orderDate,
                    status: (deliveries && deliveries.length > 0 && (originalOrder as any).status === 'pending')
                        ? 'assigned'
                        : (deliveries === null && (originalOrder as any).status === 'assigned')
                            ? 'pending'
                            : undefined,
                    customerCardIssueDate: orderData.customerCardIssueDate ? new Date(orderData.customerCardIssueDate) : undefined,
                    items: items ? {
                        deleteMany: {},
                        create: itemProcessing,
                    } : undefined,
                    gifts: gifts ? {
                        deleteMany: {},
                        create: giftProcessing,
                    } : undefined,
                    splits: splits ? {
                        deleteMany: {},
                        create: splits.map(s => ({
                            employeeId: s.employeeId,
                            branchId: s.branchId,
                            splitPercent: s.splitPercent,
                            splitAmount: s.splitAmount !== undefined ? new Decimal(s.splitAmount) : totalAmount.mul(s.splitPercent).div(100),
                        })),
                    } : undefined,
                    payments: payments ? {
                        deleteMany: {},
                        create: payments.map(p => ({
                            paymentMethod: p.paymentMethod,
                            amount: p.amount,
                            paidAt: new Date(p.paidAt),
                        })),
                    } : undefined,
                    deliveries: (deliveries !== undefined) ? {
                        deleteMany: {},
                        create: (deliveries || []).map((d: any) => {
                            let fee = 0;
                            if (d.category === 'COMPANY_DRIVER') fee = 50000;
                            else if (d.category === 'EXTERNAL_DRIVER') fee = 0;
                            else if (d.category === 'STAFF_DELIVERER') fee = 70000;
                            else if (d.category === 'SELLING_SALE') fee = 100000;
                            else if (d.category === 'OTHER_SALE') fee = 200000;

                            return {
                                driverId: d.driverId || null,
                                driverType: d.category,
                                category: d.category,
                                role: (d.category === 'COMPANY_DRIVER' || d.category === 'EXTERNAL_DRIVER') ? 'DRIVER' : 'STAFF',
                                deliveryFee: d.deliveryFee !== undefined ? d.deliveryFee : fee,
                            };
                        })
                    } : undefined,
                },
            });

            // 4. Fetch full updated state for log
            const finalUpdatedOrder = await tx.order.findUnique({
                where: { id },
                include: {
                    items: { include: { product: true } },
                    gifts: { include: { gift: true } },
                    splits: { include: { employee: true, branch: true } },
                    payments: true,
                    branch: true,
                    creator: { include: { employee: true } },
                    deliveries: { include: { driver: true } },
                    province: true,
                    ward: true,
                }
            });

            if (finalUpdatedOrder && (finalUpdatedOrder as any).creator?.employee) {
                (finalUpdatedOrder as any).employee = (finalUpdatedOrder as any).creator.employee;
            }

            // 5. Audit Log
            await tx.orderAuditLog.create({
                data: {
                    orderId: id,
                    changedBy: userId,
                    action: 'update',
                    oldData: originalOrder as any,
                    newData: finalUpdatedOrder as any,
                },
            });

            return finalUpdatedOrder;
        });
    }

    async findOne(id: string) {
        return this.prisma.order.findUnique({
            where: { id },
            include: {
                items: { include: { product: true } },
                gifts: { include: { gift: true } },
                splits: { include: { employee: true, branch: true } },
                payments: true,
                branch: true,
                deliveries: true,
                province: true,
                ward: true,
            }
        });
    }

    async getLogs(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { role: true, employee: true }
        });

        if (!user) throw new BadRequestException('User not found');

        let where: any = {};
        const role = user.role.code;

        if (role === 'SALE') {
            where = { order: { createdBy: userId } };
        } else if (role === 'DRIVER') {
            const employeeId = user.employee?.id;
            where = {
                OR: [
                    { order: { createdBy: userId } },
                    {
                        oldData: {
                            path: ['deliveries'],
                            array_contains: [{ driverId: employeeId }]
                        }
                    },
                    {
                        newData: {
                            path: ['deliveries'],
                            array_contains: [{ driverId: employeeId }]
                        }
                    }
                ]
            };
        } else if (role === 'MANAGER') {
            where = { order: { branchId: user.employee?.branchId } };
        }

        const logs = await this.prisma.orderAuditLog.findMany({
            where,
            include: {
                order: {
                    include: { branch: true }
                }
            },
            orderBy: { changedAt: 'desc' }
        });

        // Batch fetch users to include names in logs
        const userIds = [...new Set(logs.map(l => l.changedBy))];
        const users = await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            include: { employee: true }
        });

        return logs.map(l => ({
            ...l,
            changedByUser: users.find(u => u.id === l.changedBy)
        }));
    }

    async findAll(
        userId?: string,
        roleCode?: string,
        branchId?: string,
        page: number = 1,
        limit: number = 20,
        search?: string,
        status?: string,
        paymentStatus?: string,
        paymentMethod?: string,
        invoiceStatus?: string,
        timeFilter?: string,
        startDate?: string,
        endDate?: string,
        tab?: string,
        employeeId?: string,
        lowPrice?: string,
        excludeInstallment?: string,
        deliveryType?: string
    ) {
        let whereClause: any = {
            status: { notIn: ['canceled', 'rejected'] }
        };

        // 1. Role-based Base Filter (Security & Scope)
        if (userId && roleCode) {
            if (['SALE', 'TELESALE', 'DRIVER'].includes(roleCode)) {
                const orConditions: any[] = [
                    { createdBy: userId },
                    { splits: { some: { employee: { userId: userId } } } },
                    { deliveries: { some: { driver: { userId: userId } } } }
                ];

                if (roleCode === 'TELESALE') {
                    orConditions.push({ orderSource: { equals: 'FACEBOOK', mode: 'insensitive' } });
                }
                whereClause.OR = orConditions;
            } else if (['MANAGER'].includes(roleCode)) {
                if (branchId && branchId !== 'all') {
                    whereClause.OR = [
                        { branchId: branchId },
                        { splits: { some: { branchId: branchId } } }
                    ];
                }
            } else if (['DIRECTOR', 'CHIEF_ACCOUNTANT', 'ACCOUNTANT', 'BRANCH_ACCOUNTANT', 'MARKETING'].includes(roleCode)) {
                // Global view - Only filter branch if explicitly provided
                if (branchId && branchId !== 'all') {
                    whereClause.OR = [
                        { branchId: branchId },
                        { splits: { some: { branchId: branchId } } }
                    ];
                }
            }
        } else if (userId) {
            whereClause.createdBy = userId;
        }

        // 2. Global Filters (Search, Status, Time, etc.)
        const globalFilters: any[] = [];

        if (search) {
            // Find orders by ID if search looks like a UUID or first part of it (hex + hyphens)
            let orderIdsByCode: string[] = [];
            if (/^[0-9a-fA-F-]+$/.test(search) && search.length >= 4) {
                try {
                    const matchedIds = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
                        `SELECT id FROM orders WHERE id::text ILIKE $1`,
                        `%${search}%`
                    );
                    orderIdsByCode = matchedIds.map(o => o.id);
                } catch (e) {
                    console.error('Error searching by order ID:', e);
                }
            }

            globalFilters.push({
                OR: [
                    { customerName: { contains: search, mode: 'insensitive' } },
                    { customerPhone: { contains: search } },
                    ...(orderIdsByCode.length > 0 ? [{ id: { in: orderIdsByCode } }] : [])
                ]
            });
        }

        if (employeeId && employeeId !== 'all') {
            globalFilters.push({
                OR: [
                    { createdBy: employeeId },
                    { splits: { some: { employeeId } } }
                ]
            });
        }

        if (lowPrice === 'true') {
            console.log('[OrdersService] Applying lowPrice filter');
            globalFilters.push({
                items: {
                    some: {
                        isBelowMin: true
                    }
                }
            });
        }

        if (status && status !== 'all') {
            globalFilters.push({ status });
        }

        if (paymentStatus === 'pending') {
            globalFilters.push({
                isPaymentConfirmed: false,
                ...(excludeInstallment === 'true' ? { payments: { none: { paymentMethod: 'INSTALLMENT' } } } : {})
            });
        } else if (paymentStatus === 'confirmed') {
            globalFilters.push({ isPaymentConfirmed: true });
        }

        if (paymentMethod && paymentMethod !== 'all') {
            globalFilters.push({ payments: { some: { paymentMethod } } });
        }

        if (excludeInstallment === 'true') {
            globalFilters.push({
                payments: {
                    none: { paymentMethod: 'INSTALLMENT' }
                }
            });
        }

        if (invoiceStatus === 'pending') {
            globalFilters.push({
                isInvoiceIssued: false
            });
        } else if (invoiceStatus === 'issued') {
            globalFilters.push({ isInvoiceIssued: true });
        }

        if (deliveryType && deliveryType !== 'all') {
            globalFilters.push({
                deliveries: {
                    some: {
                        category: deliveryType === 'company' ? 'COMPANY_DRIVER' : 'EXTERNAL_DRIVER'
                    }
                }
            });
        }

        if (startDate || endDate) {
            const dateFilter: any = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                dateFilter.gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                dateFilter.lte = end;
            }

            // Phân biệt logic lọc ngày:
            // 1. Operational (Các tab Đợi...): Lấy tất cả đơn tồn đọng tính đến endDate
            // 2. Reporting (Tab Tất cả / Báo cáo): Lấy theo logic tính doanh thu chuẩn của Dashboard
            const isOperational = tab === 'installment' || tab === 'invoice' ||
                paymentStatus === 'pending' || invoiceStatus === 'pending';

            if (isOperational) {
                globalFilters.push({ orderDate: { lte: dateFilter.lte } });
            } else {
                globalFilters.push({
                    OR: [
                        {
                            payments: { none: { paymentMethod: 'INSTALLMENT' } },
                            orderDate: dateFilter
                        },
                        {
                            payments: { some: { paymentMethod: 'INSTALLMENT' } },
                            isPaymentConfirmed: true,
                            confirmedAt: dateFilter
                        },
                        {
                            // Include pending installments in the date range so "All" tab shows all created orders
                            payments: { some: { paymentMethod: 'INSTALLMENT' } },
                            isPaymentConfirmed: false,
                            orderDate: dateFilter
                        }
                    ]
                });
            }
        } else if (timeFilter && timeFilter !== 'all') {
            const now = new Date();
            let start = new Date();
            if (timeFilter === 'today') {
                start.setHours(0, 0, 0, 0);
            } else if (timeFilter === 'week') {
                start.setDate(now.getDate() - 7);
            } else if (timeFilter === 'month') {
                start.setMonth(now.getMonth() - 1);
            }
            const dashboardTimeFilter = {
                OR: [
                    {
                        payments: { none: { paymentMethod: 'INSTALLMENT' } },
                        orderDate: { gte: start }
                    },
                    {
                        payments: { some: { paymentMethod: 'INSTALLMENT' } },
                        isPaymentConfirmed: true,
                        confirmedAt: { gte: start }
                    },
                    {
                        payments: { some: { paymentMethod: 'INSTALLMENT' } },
                        isPaymentConfirmed: false,
                        orderDate: { gte: start }
                    }
                ]
            };
            globalFilters.push(dashboardTimeFilter);
        }

        // 3. Tab Specific Filter
        let tabFilter: any = null;
        if (tab && tab !== 'all') {
            if (tab === 'created' && userId) {
                tabFilter = { createdBy: userId };
            } else if (tab === 'assigned' && userId) {
                tabFilter = {
                    AND: [
                        { splits: { some: { employee: { userId: userId } } } },
                        { createdBy: { not: userId } }
                    ]
                };
            } else if (tab === 'installment') {
                tabFilter = {
                    AND: [
                        { payments: { some: { paymentMethod: 'INSTALLMENT' } } },
                        { isPaymentConfirmed: false }
                    ]
                };
            } else if (tab === 'invoice') {
                tabFilter = { isInvoiceIssued: false };
            }
        }

        // Base where for the main query
        const mainWhere: Prisma.OrderWhereInput = { ...whereClause };
        const mainFilters = [...globalFilters];
        if (tabFilter) mainFilters.push(tabFilter);
        if (mainFilters.length > 0) {
            mainWhere.AND = [...(mainWhere.AND as any[] || []), ...mainFilters];
        }

        // 4. Pagination & Fetch
        const skip = (page - 1) * limit;
        const take = Number(limit);

        const [orders, total] = await Promise.all([
            this.prisma.order.findMany({
                where: mainWhere,
                include: {
                    items: { include: { product: true } },
                    gifts: { include: { gift: true } },
                    splits: { include: { employee: true, branch: true } },
                    payments: true,
                    branch: true,
                    deliveries: { include: { driver: true } },
                    creator: { include: { employee: true } },
                    confirmer: { include: { employee: true } },
                    province: true,
                    ward: true,
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take,
            }),
            this.prisma.order.count({ where: mainWhere })
        ]);

        // 5. Calculate Counts for Tabs (Strictly aligned with Dashboard)
        const [all, created, assigned, installment, invoice] = await Promise.all([
            // Tất cả đơn hàng (Theo bộ lọc hện tại)
            this.prisma.order.count({
                where: { ...whereClause, AND: globalFilters }
            }),

            // Tab "Tôi tạo"
            this.prisma.order.count({
                where: { ...whereClause, createdBy: userId }
            }),

            // Tab "Được chia"
            this.prisma.order.count({
                where: {
                    ...whereClause,
                    splits: { some: { employee: { userId: userId } } },
                    createdBy: { not: userId }
                }
            }),

            // Tab "Chờ trả góp" (Tất cả đơn tồn đọng đến endDate)
            this.prisma.order.count({
                where: {
                    branchId: branchId && branchId !== 'all' ? branchId : whereClause.branchId,
                    status: { notIn: ['canceled', 'rejected'] },
                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                    isPaymentConfirmed: false,
                    orderDate: { lte: endDate ? new Date(endDate) : undefined }
                }
            }),

            // Tab "Chờ xuất HĐ" (Tất cả đơn tồn đọng đến endDate)
            this.prisma.order.count({
                where: {
                    branchId: branchId && branchId !== 'all' ? branchId : whereClause.branchId,
                    status: { notIn: ['canceled', 'rejected'] },
                    isInvoiceIssued: false,
                    orderDate: { lte: endDate ? new Date(endDate) : undefined }
                }
            })
        ]);

        return {
            data: orders,
            meta: {
                total,
                page: Number(page),
                limit: take,
                totalPages: Math.ceil(total / take),
                counts: { all, created, assigned, installment, invoice }
            }
        };
    }

    async remove(id: string, userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { role: true },
        });

        if (!user) throw new BadRequestException('User not found');

        const role = user.role.code;
        if (!['DIRECTOR', 'CHIEF_ACCOUNTANT', 'ACCOUNTANT', 'BRANCH_ACCOUNTANT'].includes(role)) {
            throw new BadRequestException('Unauthorized: Only Director, Chief Accountant or Accountant can delete orders');
        }

        const order = await this.prisma.order.findUnique({
            where: { id },
            include: {
                items: true,
                splits: true,
                payments: true,
                deliveries: { include: { driver: true } },
            },
        });

        if (!order) throw new BadRequestException('Order not found');

        return this.prisma.$transaction(async (tx) => {
            // Audit Log: Record deletion before it's gone
            await tx.orderAuditLog.create({
                data: {
                    orderId: id,
                    changedBy: userId,
                    action: 'delete',
                    oldData: order as any,
                },
            });

            await tx.order.delete({
                where: { id },
            });

            return { message: 'Order deleted successfully' };
        });
    }

    async confirmPayment(id: string, userId: string) {
        const order = await this.prisma.order.findUnique({
            where: { id },
            include: {
                items: { include: { product: true } },
                splits: { include: { employee: true, branch: true } },
                payments: true,
                branch: true,
                deliveries: { include: { driver: true } },
            }
        });

        if (!order) throw new BadRequestException('Order not found');

        const totalPaid = order.payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;
        const totalAmount = Number(order.totalAmount);

        if (totalPaid < totalAmount) {
            throw new BadRequestException(`Đơn hàng chưa thanh toán đủ (Thiếu: ${totalAmount - totalPaid}). Vui lòng cập nhật thông tin thanh toán trước khi xác nhận.`);
        }

        return this.prisma.$transaction(async (tx) => {
            const updatedOrder = await tx.order.update({
                where: { id },
                data: {
                    isPaymentConfirmed: true,
                    confirmedById: userId,
                    confirmedAt: new Date(),
                },
                include: {
                    items: { include: { product: true } },
                    splits: { include: { employee: true, branch: true } },
                    payments: true,
                    branch: true,
                    deliveries: { include: { driver: true } },
                    confirmer: { include: { employee: true } },
                }
            });

            // Audit Log
            await tx.orderAuditLog.create({
                data: {
                    orderId: id,
                    changedBy: userId,
                    action: 'update',
                    oldData: order as any,
                    newData: updatedOrder as any,
                },
            });

            return updatedOrder;
        });
    }

    async confirmInvoice(id: string, userId: string) {
        const order = await this.prisma.order.findUnique({
            where: { id },
            include: {
                items: { include: { product: true } },
                splits: { include: { employee: true, branch: true } },
                payments: true,
                branch: true,
                deliveries: { include: { driver: true } },
            }
        });

        if (!order) throw new BadRequestException('Order not found');

        return this.prisma.$transaction(async (tx) => {
            const updatedOrder = await tx.order.update({
                where: { id },
                data: {
                    isInvoiceIssued: true,
                    invoiceIssuedById: userId,
                    invoiceIssuedAt: new Date(),
                },
                include: {
                    items: { include: { product: true } },
                    splits: { include: { employee: true, branch: true } },
                    payments: true,
                    branch: true,
                    deliveries: { include: { driver: true } },
                    invoiceIssuer: { include: { employee: true } },
                }
            });

            // Audit Log
            await tx.orderAuditLog.create({
                data: {
                    orderId: id,
                    changedBy: userId,
                    action: 'update',
                    oldData: order as any,
                    newData: updatedOrder as any,
                },
            });

            return updatedOrder;
        });
    }

    async confirmDelivery(id: string, userId: string) {
        const order = await this.prisma.order.findUnique({
            where: { id },
            include: {
                items: { include: { product: true } },
                splits: { include: { employee: true, branch: true } },
                payments: true,
                branch: true,
                deliveries: { include: { driver: true } },
            }
        });

        if (!order) throw new BadRequestException('Order not found');

        return this.prisma.$transaction(async (tx) => {
            const updatedOrder = await tx.order.update({
                where: { id },
                // @ts-ignore
                data: { status: 'delivered' },
                include: {
                    items: { include: { product: true } },
                    splits: { include: { employee: true, branch: true } },
                    payments: true,
                    branch: true,
                    deliveries: { include: { driver: true } },
                }
            });

            // Create Audit Log
            await tx.orderAuditLog.create({
                data: {
                    orderId: id,
                    changedBy: userId,
                    action: 'update',
                    oldData: order as any,
                    newData: updatedOrder as any,
                },
            });

            return updatedOrder;
        });
    }

    async getAuditLogs(orderId: string) {
        const logs = await this.prisma.orderAuditLog.findMany({
            where: { orderId },
            orderBy: { changedAt: 'desc' }
        });

        // Fetch order creator to include in oldData/newData if missing
        const order = await this.prisma.order.findUnique({
            where: { id: orderId },
            include: { creator: { include: { employee: true } } }
        });

        if (order && order.creator) {
            return logs.map(l => {
                if (l.oldData && typeof l.oldData === 'object') {
                    (l.oldData as any).creator = order.creator;
                }
                if (l.newData && typeof l.newData === 'object') {
                    (l.newData as any).creator = order.creator;
                }
                return l;
            });
        }

        return logs;
    }

    async addImages(orderId: string, imageUrls: string[], userId: string) {
        const order = await this.prisma.order.findUnique({
            where: { id: orderId },
            include: {
                items: { include: { product: true } },
                splits: { include: { employee: true, branch: true } },
                payments: true,
                branch: true,
                deliveries: { include: { driver: true } },
            }
        });
        if (!order) throw new NotFoundException('Order not found');

        return this.prisma.$transaction(async (tx) => {
            const updatedOrder = await tx.order.update({
                where: { id: orderId },
                data: {
                    images: {
                        push: imageUrls
                    }
                },
                include: {
                    items: { include: { product: true } },
                    splits: { include: { employee: true, branch: true } },
                    payments: true,
                    branch: true,
                    deliveries: { include: { driver: true } },
                }
            });

            await tx.orderAuditLog.create({
                data: {
                    orderId: orderId,
                    changedBy: userId,
                    action: 'update',
                    oldData: order as any,
                    newData: updatedOrder as any,
                },
            });

            return updatedOrder;
        });
    }

    async removeImage(orderId: string, imageUrl: string, userId: string) {
        const order = await this.prisma.order.findUnique({
            where: { id: orderId },
            include: {
                items: { include: { product: true } },
                splits: { include: { employee: true, branch: true } },
                payments: true,
                branch: true,
                deliveries: { include: { driver: true } },
            }
        });
        if (!order) throw new NotFoundException('Order not found');

        // Remove from DB array
        const updatedImages = order.images.filter(img => img !== imageUrl);

        return this.prisma.$transaction(async (tx) => {
            const updatedOrder = await tx.order.update({
                where: { id: orderId },
                data: { images: updatedImages },
                include: {
                    items: { include: { product: true } },
                    splits: { include: { employee: true, branch: true } },
                    payments: true,
                    branch: true,
                    deliveries: { include: { driver: true } },
                }
            });

            await tx.orderAuditLog.create({
                data: {
                    orderId: orderId,
                    changedBy: userId,
                    action: 'update',
                    oldData: order as any,
                    newData: updatedOrder as any,
                },
            });

            return updatedOrder;
        });
    }

    async getSystemImages(orderId: string) {
        const fs = require('fs');
        const path = require('path');
        const dirPath = path.join(process.cwd(), 'public', 'uploads', 'orders');

        let physicalFiles: string[] = [];
        if (fs.existsSync(dirPath)) {
            const files = fs.readdirSync(dirPath);
            // Lọc ra các file ảnh hợp lệ
            const validFiles = files.filter((f: string) => f.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i));

            // Lấy thêm thông tin để sắp xếp mới nhất lên đầu (tùy chọn)
            const fileStats = validFiles.map((f: string) => ({
                name: f,
                time: fs.statSync(path.join(dirPath, f)).mtime.getTime()
            })).sort((a: any, b: any) => b.time - a.time).slice(0, 200); // Lấy tối đa 200 ảnh mới nhất

            physicalFiles = fileStats.map((f: any) => `/uploads/orders/${f.name}`);
        }

        return physicalFiles;
    }
}
