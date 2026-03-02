import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';

@Injectable()
export class OrdersService {
    constructor(private prisma: PrismaService) { }

    async create(createOrderDto: CreateOrderDto, userId: string) {
        const { items, splits, payments, driverId, driverType, ...orderData } = createOrderDto;

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
                    // @ts-ignore
                    status: driverId ? 'assigned' : 'pending',
                    productBonusAmount: calculatedProductBonusTotal,
                    createdBy: userId,
                    orderDate: new Date(orderData.orderDate),
                    customerCardIssueDate: orderData.customerCardIssueDate ? new Date(orderData.customerCardIssueDate) : null,
                    items: {
                        create: itemProcessing,
                    },
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
                    deliveries: driverId ? {
                        create: {
                            driverId: driverId,
                            driverType: driverType || 'internal',
                            deliveryFee: driverType === 'sale' ? 100000 : 50000,
                        }
                    } : undefined,
                },
            });

            // 3. Fetch full created state for log
            const finalOrder = await tx.order.findUnique({
                where: { id: order.id },
                include: {
                    items: { include: { product: true } },
                    splits: { include: { employee: true, branch: true } },
                    payments: true,
                    branch: true,
                    creator: { include: { employee: true } },
                    deliveries: { include: { driver: true } },
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
        const { items, splits, payments, driverId, driverType, ...orderData } = updateOrderDto;

        const originalOrder = await this.prisma.order.findUnique({
            where: { id },
            include: {
                items: { include: { product: true } },
                splits: { include: { employee: true, branch: true } },
                payments: true,
                branch: true,
                deliveries: { include: { driver: true } },
                creator: { include: { employee: true } },
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
                    // @ts-ignore
                    status: (driverId && (originalOrder as any).status === 'pending')
                        ? 'assigned'
                        : (!driverId && (originalOrder as any).status === 'assigned')
                            ? 'pending'
                            : undefined,
                    productBonusAmount: calculatedProductBonusTotal,
                    orderDate: orderData.orderDate ? new Date(orderData.orderDate) : undefined,
                    customerCardIssueDate: orderData.customerCardIssueDate ? new Date(orderData.customerCardIssueDate) : undefined,
                    items: items ? {
                        deleteMany: {},
                        create: itemProcessing,
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
                    deliveries: driverId !== undefined ? {
                        deleteMany: {},
                        ...(driverId ? {
                            create: {
                                driverId: driverId,
                                driverType: driverType || 'internal',
                                deliveryFee: driverType === 'sale' ? 100000 : 50000,
                            }
                        } : {})
                    } : undefined,
                },
            });

            // 4. Fetch full updated state for log
            const finalUpdatedOrder = await tx.order.findUnique({
                where: { id },
                include: {
                    items: { include: { product: true } },
                    splits: { include: { employee: true, branch: true } },
                    payments: true,
                    branch: true,
                    creator: { include: { employee: true } },
                    deliveries: { include: { driver: true } },
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
                splits: { include: { employee: true, branch: true } },
                payments: true,
                branch: true,
                deliveries: true,
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
        } else if (role === 'MANAGER' || role === 'ACCOUNTANT') {
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
        limit: number = 50,
        search?: string,
        status?: string,
        paymentStatus?: string,
        paymentMethod?: string,
        invoiceStatus?: string,
        timeFilter?: string,
        tab?: string,
        employeeId?: string,
        lowPrice?: string,
        startDate?: string,
        endDate?: string
    ) {
        let whereClause: any = {};

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
            } else if (['MANAGER', 'BRANCH_ACCOUNTANT'].includes(roleCode)) {
                if (branchId) whereClause.branchId = branchId;
            } else if (['DIRECTOR', 'CHIEF_ACCOUNTANT', 'ACCOUNTANT', 'MARKETING'].includes(roleCode)) {
                // Global view - Only filter branch if explicitly provided
                if (branchId && branchId !== 'all') {
                    whereClause.branchId = branchId;
                }
            }
        } else if (userId) {
            whereClause.createdBy = userId;
        }

        // 2. Global Filters (Search, Status, Time, etc.)
        const globalFilters: any[] = [];

        if (search) {
            globalFilters.push({
                OR: [
                    { customerName: { contains: search, mode: 'insensitive' } },
                    { customerPhone: { contains: search } },
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
                payments: { some: { paymentMethod: 'INSTALLMENT' } }
            });
        } else if (paymentStatus === 'confirmed') {
            globalFilters.push({ isPaymentConfirmed: true });
        }

        if (paymentMethod && paymentMethod !== 'all') {
            globalFilters.push({ payments: { some: { paymentMethod } } });
        }

        if (invoiceStatus === 'pending') {
            globalFilters.push({
                isInvoiceIssued: false,
                OR: [
                    { payments: { none: { paymentMethod: 'INSTALLMENT' } } },
                    {
                        payments: { some: { paymentMethod: 'INSTALLMENT' } },
                        isPaymentConfirmed: true
                    }
                ]
            });
        } else if (invoiceStatus === 'issued') {
            globalFilters.push({ isInvoiceIssued: true });
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
            const dashboardDateFilter = {
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
                        payments: { some: { paymentMethod: 'INSTALLMENT' } },
                        isPaymentConfirmed: false,
                        orderDate: dateFilter
                    }
                ]
            };
            globalFilters.push(dashboardDateFilter);
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
                    splits: { include: { employee: true, branch: true } },
                    payments: true,
                    branch: true,
                    deliveries: { include: { driver: true } },
                    creator: { include: { employee: true } },
                    confirmer: { include: { employee: true } }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take,
            }),
            this.prisma.order.count({ where: mainWhere })
        ]);

        // 5. Calculate Counts for Tabs (Correct approach for UI)
        // Use globalFilters as base for all tab counts to ensure isolation
        const countBaseFilters = [...(whereClause.AND as any[] || []), ...globalFilters];

        const [all, created, assigned, installment, invoice] = await Promise.all([
            this.prisma.order.count({
                where: { ...whereClause, AND: countBaseFilters }
            }),
            this.prisma.order.count({
                where: { ...whereClause, AND: [...countBaseFilters, { createdBy: userId }] }
            }),
            this.prisma.order.count({
                where: { ...whereClause, AND: [...countBaseFilters, { splits: { some: { employee: { userId: userId } } } }, { createdBy: { not: userId } }] }
            }),
            this.prisma.order.count({
                where: { ...whereClause, AND: [...countBaseFilters, { payments: { some: { paymentMethod: 'INSTALLMENT' } } }, { isPaymentConfirmed: false }] }
            }),
            this.prisma.order.count({
                where: {
                    ...whereClause,
                    AND: [
                        ...countBaseFilters,
                        { isInvoiceIssued: false },
                        {
                            OR: [
                                { payments: { none: { paymentMethod: 'INSTALLMENT' } } },
                                {
                                    payments: { some: { paymentMethod: 'INSTALLMENT' } },
                                    isPaymentConfirmed: true
                                }
                            ]
                        }
                    ]
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
        if (role !== 'DIRECTOR' && role !== 'CHIEF_ACCOUNTANT') {
            throw new BadRequestException('Unauthorized: Only Director or Chief Accountant can delete orders');
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
}
