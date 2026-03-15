import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma, TransactionType } from '@prisma/client';
import { DeliveryFeeRulesService } from '../delivery-fee-rules/delivery-fee-rules.service';
import { StocksService } from '../stocks/stocks.service';

@Injectable()
export class OrdersService {
    constructor(
        private prisma: PrismaService,
        private deliveryFeeRulesService: DeliveryFeeRulesService,
        private stocksService: StocksService,
    ) { }

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
                    // Upgrade logic: if isUpgrade, check (unitPrice + oldOrderAmount) >= minPrice
                    const effectivePrice = createOrderDto.isUpgrade 
                        ? new Decimal(item.unitPrice).add(new Decimal(createOrderDto.oldOrderAmount || 0))
                        : new Decimal(item.unitPrice);

                    const isBelowMin = effectivePrice.lt(product.minPrice);

                    // Find applicable bonus
                    let bonusAmount = new Decimal(0);
                    let saleBonusAmount = new Decimal(0);
                    let managerBonusAmount = new Decimal(0);

                    if (product.isHighEnd) {
                        const applicableRule = product.bonusRules.find(rule =>
                            effectivePrice.gte(rule.minSellPrice)
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
            const dataToCreate: any = {
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
                // Upgrade fields
                isUpgrade: orderData.isUpgrade || false,
                oldOrderProductName: orderData.oldOrderProductName || null,
                oldOrderAmount: orderData.oldOrderAmount !== undefined ? new Decimal(orderData.oldOrderAmount) : null,
                oldOrderDate: orderData.oldOrderDate || null,
                oldOrderCustomerName: orderData.oldOrderCustomerName || null,
                oldOrderCustomerPhone: orderData.oldOrderCustomerPhone || null,
                oldOrderCustomerAddress: orderData.oldOrderCustomerAddress || null,
                oldOrderProvinceId: orderData.oldOrderProvinceId || null,
                oldOrderWardId: orderData.oldOrderWardId || null,
                oldOrderCustomerCardNumber: orderData.oldOrderCustomerCardNumber || null,
                oldOrderCustomerCardIssueDate: orderData.oldOrderCustomerCardIssueDate || null,
                oldOrderId: (orderData as any).oldOrderId || null,
                oldOrderCode: (orderData as any).oldOrderCode || null,
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
            };

            if (deliveries && deliveries.length > 0) {
                dataToCreate.deliveries = {
                    create: await Promise.all(deliveries.map(async (d: any) => {
                        let fee = await this.deliveryFeeRulesService.getDeliveryFee(d.category, orderData.branchId);

                        // If driverId is provided, check if the employee is a MANAGER
                        if (d.driverId) {
                            const employee = await tx.employee.findUnique({
                                where: { id: d.driverId },
                                include: { user: { include: { role: true } } }
                            });
                            if (employee?.user?.role?.code === 'MANAGER') {
                                fee = 0;
                            }
                        }

                        return {
                            driverId: d.driverId || null,
                            driverType: d.category,
                            category: d.category,
                            role: (d.category === 'COMPANY_DRIVER' || d.category === 'EXTERNAL_DRIVER') ? 'DRIVER' : 'STAFF',
                            deliveryFee: d.deliveryFee !== undefined ? d.deliveryFee : fee,
                        };
                    }))
                };
            }

            const order = await tx.order.create({
                data: dataToCreate,
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

            // 5. Update Stock (DISABLED TEMPORARILY AS PER USER REQUEST)
            /*
            if (finalOrder) {
                for (const item of itemProcessing) {
                    await this.stocksService.createTransaction({
                        type: TransactionType.SALE,
                        fromBranchId: finalOrder.branchId,
                        productId: item.productId,
                        quantity: item.quantity,
                        serialNumbers: (createOrderDto as any).serialNumbers?.[item.productId] || [],
                        note: `Bán lẻ - Đơn hàng ${finalOrder.id}`,
                        createdBy: userId
                    });
                }

                // 6. Handle Upgrade Return Stock
                if (finalOrder.isUpgrade && (createOrderDto as any).oldOrderSerialNumber) {
                    const oldProductId = (createOrderDto as any).oldOrderProductId || itemProcessing[0].productId;
                    
                    await this.stocksService.createTransaction({
                        type: TransactionType.UPGRADE_RETURN,
                        toBranchId: finalOrder.branchId,
                        productId: oldProductId,
                        quantity: 1,
                        serialNumbers: [(createOrderDto as any).oldOrderSerialNumber],
                        note: `Thu hồi nâng cấp - Đơn hàng ${finalOrder.id}`,
                        createdBy: userId
                    });
                }
            }
            */

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

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { role: true }
        });

        if (!user) {
            throw new BadRequestException('User not found');
        }

        const canEditConfirmed = ['ADMIN', 'DIRECTOR', 'MANAGER', 'CHIEF_ACCOUNTANT', 'BRANCH_ACCOUNTANT', 'ACCOUNTANT'].includes(user.role.code);
        if (originalOrder.isPaymentConfirmed && !canEditConfirmed) {
            throw new BadRequestException('Đơn hàng đã được kế toán xác nhận, bạn không có quyền chỉnh sửa.');
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
                        const effectivePrice = (updateOrderDto.isUpgrade || originalOrder.isUpgrade)
                            ? new Decimal(item.unitPrice).add(new Decimal(updateOrderDto.oldOrderAmount || originalOrder.oldOrderAmount || 0))
                            : new Decimal(item.unitPrice);

                        const isBelowMin = effectivePrice.lt(product.minPrice);

                        let bonusAmount = new Decimal(0);
                        let saleBonusAmount = new Decimal(0);
                        let managerBonusAmount = new Decimal(0);

                        if (product.isHighEnd) {
                            const rule = product.bonusRules.find(r => effectivePrice.gte(r.minSellPrice));
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
                        create: await Promise.all((deliveries || []).map(async (d: any) => {
                            let fee = await this.deliveryFeeRulesService.getDeliveryFee(d.category, orderData.branchId || originalOrder.branchId);

                            // If driverId is provided, check if the employee is a MANAGER
                            if (d.driverId) {
                                const employee = await tx.employee.findUnique({
                                    where: { id: d.driverId },
                                    include: { user: { include: { role: true } } }
                                });
                                if (employee?.user?.role?.code === 'MANAGER') {
                                    fee = 0;
                                }
                            }

                            return {
                                driverId: d.driverId || null,
                                driverType: d.category,
                                category: d.category,
                                role: (d.category === 'COMPANY_DRIVER' || d.category === 'EXTERNAL_DRIVER') ? 'DRIVER' : 'STAFF',
                                deliveryFee: d.deliveryFee !== undefined ? d.deliveryFee : fee,
                            };
                        }))
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

            // 6. Rebalance Stock if items changed (DISABLED TEMPORARILY)
            /*
            if (items && finalUpdatedOrder) {
                // Return old items to stock
                for (const oldItem of originalOrder.items) {
                    await this.stocksService.createTransaction({
                        type: TransactionType.RETURN,
                        toBranchId: originalOrder.branchId,
                        productId: oldItem.productId,
                        quantity: oldItem.quantity,
                        note: `Hoàn kho do sửa đơn hàng ${id}`,
                        createdBy: userId
                    });
                }
                // Subtract new items from stock
                for (const newItem of itemProcessing) {
                    await this.stocksService.createTransaction({
                        type: TransactionType.SALE,
                        fromBranchId: finalUpdatedOrder.branchId,
                        productId: newItem.productId,
                        quantity: newItem.quantity,
                        serialNumbers: (updateOrderDto as any).serialNumbers?.[newItem.productId] || [],
                        note: `Trừ kho do sửa đơn hàng ${id}`,
                        createdBy: userId
                    });
                }
            }

            // 7. Handle cancellation reversal
            const newStatus = (orderData as any).status;
            if (newStatus === 'canceled' && originalOrder.status !== 'canceled' && finalUpdatedOrder) {
                for (const item of (finalUpdatedOrder as any).items) {
                    await this.stocksService.createTransaction({
                        type: TransactionType.RETURN,
                        toBranchId: finalUpdatedOrder.branchId,
                        productId: item.productId,
                        quantity: item.quantity,
                        note: `Hoàn kho do hủy đơn hàng ${id}`,
                        createdBy: userId
                    });
                }
            }
            */

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
        deliveryType?: string,
        editStartDate?: string,
        editEndDate?: string,
        editTimeFilter?: string,
        confirmedStartDate?: string,
        confirmedEndDate?: string,
        confirmedTimeFilter?: string,
        debtOnly?: string
    ) {
        let whereClause: any = {
            status: { notIn: ['canceled', 'rejected'] }
        };

        // 0. Handle debtOnly filter (Needs raw query IDs to work with Prisma pagination)
        if (debtOnly === 'true') {
            try {
                const debtOrderIdResult = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
                    `SELECT o.id 
                     FROM orders o
                     LEFT JOIN payments p ON o.id = p.order_id
                     WHERE o.status NOT IN ('canceled', 'rejected')
                     AND o.is_payment_confirmed = false
                     GROUP BY o.id
                     HAVING (o.total_amount - COALESCE(SUM(p.amount), 0)) > 0.01`
                );
                const debtIds = debtOrderIdResult.map(o => o.id);
                whereClause.id = { in: debtIds };
            } catch (error) {
                console.error('Error fetching debt order IDs:', error);
            }
        }

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
            } else if (['DIRECTOR', 'CHIEF_ACCOUNTANT', 'ACCOUNTANT', 'BRANCH_ACCOUNTANT', 'MARKETING', 'ADMIN'].includes(roleCode)) {
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

        if (editStartDate || editEndDate) {
            const editDateFilter: any = {};
            if (editStartDate) {
                const date = new Date(editStartDate);
                if (!isNaN(date.getTime())) editDateFilter.gte = date;
            }
            if (editEndDate) {
                const date = new Date(editEndDate);
                if (!isNaN(date.getTime())) editDateFilter.lte = date;
            }
            if (Object.keys(editDateFilter).length > 0) {
                globalFilters.push({ updatedAt: editDateFilter });
            }
        } else if (editTimeFilter && editTimeFilter !== 'all') {
            const now = new Date();
            const vnTime = new Date(now.getTime() + 7 * 3600 * 1000);
            const y = vnTime.getUTCFullYear();
            const m = vnTime.getUTCMonth();
            const d = vnTime.getUTCDate();

            let startOfVNDayLocal = Date.UTC(y, m, d, 0, 0, 0);

            if (editTimeFilter === 'today') {
            } else if (editTimeFilter === 'week') {
                const date = new Date(startOfVNDayLocal);
                date.setUTCDate(date.getUTCDate() - 7);
                startOfVNDayLocal = date.getTime();
            } else if (editTimeFilter === 'month') {
                const date = new Date(startOfVNDayLocal);
                date.setUTCMonth(date.getUTCMonth() - 1);
                startOfVNDayLocal = date.getTime();
            }

            const utcStart = new Date(startOfVNDayLocal - 7 * 3600 * 1000);
            globalFilters.push({ updatedAt: { gte: utcStart } });
        }

        if (confirmedStartDate || confirmedEndDate) {
            const confirmedFilter: any = {};
            if (confirmedStartDate) {
                const date = new Date(confirmedStartDate);
                if (!isNaN(date.getTime())) confirmedFilter.gte = date;
            }
            if (confirmedEndDate) {
                const date = new Date(confirmedEndDate);
                if (!isNaN(date.getTime())) confirmedFilter.lte = date;
            }
            if (Object.keys(confirmedFilter).length > 0) {
                globalFilters.push({ confirmedAt: confirmedFilter });
            }
        } else if (confirmedTimeFilter && confirmedTimeFilter !== 'all') {
            const now = new Date();
            const vnTime = new Date(now.getTime() + 7 * 3600 * 1000);
            const y = vnTime.getUTCFullYear();
            const m = vnTime.getUTCMonth();
            const d = vnTime.getUTCDate();

            let startOfVNDayLocal = Date.UTC(y, m, d, 0, 0, 0);

            if (confirmedTimeFilter === 'today') {
            } else if (confirmedTimeFilter === 'week') {
                const date = new Date(startOfVNDayLocal);
                date.setUTCDate(date.getUTCDate() - 7);
                startOfVNDayLocal = date.getTime();
            } else if (confirmedTimeFilter === 'month') {
                const date = new Date(startOfVNDayLocal);
                date.setUTCMonth(date.getUTCMonth() - 1);
                startOfVNDayLocal = date.getTime();
            }

            const utcStart = new Date(startOfVNDayLocal - 7 * 3600 * 1000);
            globalFilters.push({ confirmedAt: { gte: utcStart } });
        }

        const dateTimeFilter: any = {};

        if (startDate) {
            const date = new Date(startDate);
            if (!isNaN(date.getTime())) dateTimeFilter.gte = date;
        }
        if (endDate) {
            const date = new Date(endDate);
            if (!isNaN(date.getTime())) dateTimeFilter.lte = date;
        }

        if (startDate || endDate) {
            const isOperational = tab === 'installment' || tab === 'invoice' ||
                paymentStatus === 'pending' || invoiceStatus === 'pending';

            if (isOperational) {
                // Operational views: Still usually filter by all outstanding orders up to end date,
                // but let's respect the start date if provided to avoid confusion.
                const opFilter: any = { lte: dateTimeFilter.lte };
                if (dateTimeFilter.gte) opFilter.gte = dateTimeFilter.gte;
                globalFilters.push({ orderDate: opFilter });
            } else {
                // For the main order listing, users expect the filter to apply to the creation date they see.
                // We no longer alternate between createdAt and confirmedAt here to keep the list predictable.
                globalFilters.push({ orderDate: dateTimeFilter });
            }
        } else if (timeFilter && timeFilter !== 'all') {
            const now = new Date();
            const vnTime = new Date(now.getTime() + 7 * 3600 * 1000);
            const y = vnTime.getUTCFullYear();
            const m = vnTime.getUTCMonth();
            const d = vnTime.getUTCDate();

            const startOfVNDayLocal = Date.UTC(y, m, d, 0, 0, 0);
            let filterStart = startOfVNDayLocal;

            if (timeFilter === 'today') {
            } else if (timeFilter === 'week') {
                const date = new Date(startOfVNDayLocal);
                date.setUTCDate(date.getUTCDate() - 7);
                filterStart = date.getTime();
            } else if (timeFilter === 'month') {
                const date = new Date(startOfVNDayLocal);
                date.setUTCMonth(date.getUTCMonth() - 1);
                filterStart = date.getTime();
            }

            // orderDate is a DATE column (no time), so use UTC midnight directly
            const dateTimeGte = new Date(filterStart);
            globalFilters.push({ orderDate: { gte: dateTimeGte } });
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
                tabFilter = {
                    AND: [
                        { isInvoiceIssued: false },
                        {
                            payments: {
                                some: {
                                    paymentMethod: { in: ['TRANSFER_COMPANY', 'CARD', 'INSTALLMENT', 'CREDIT'] }
                                }
                            }
                        }
                    ]
                };
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
                    upgradedFrom: { select: { id: true } },
                },
                orderBy: [
                    { orderDate: 'desc' },
                    { createdAt: 'desc' }
                ],
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
                    createdAt: { lte: dateTimeFilter.lte }
                }
            }),

            // Tab "Chờ xuất HĐ" (Chỉ các đơn theo PTTT quy định - đến mốc endDate)
            this.prisma.order.count({
                where: {
                    branchId: branchId && branchId !== 'all' ? branchId : whereClause.branchId,
                    status: { notIn: ['canceled', 'rejected'] },
                    isInvoiceIssued: false,
                    payments: {
                        some: {
                            paymentMethod: { in: ['TRANSFER_COMPANY', 'CARD', 'INSTALLMENT', 'CREDIT'] }
                        }
                    },
                    createdAt: { lte: dateTimeFilter.lte }
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
        if (!['DIRECTOR', 'CHIEF_ACCOUNTANT', 'ACCOUNTANT', 'BRANCH_ACCOUNTANT', 'ADMIN'].includes(role)) {
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

            // Reversal of Stock
            if (order.status !== 'canceled') {
                for (const item of order.items) {
                    await this.stocksService.createTransaction({
                        type: TransactionType.RETURN,
                        toBranchId: order.branchId,
                        productId: item.productId,
                        quantity: item.quantity,
                        note: `Hoàn kho do xóa đơn hàng ${id}`,
                        createdBy: userId
                    });
                }
            }

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

        // Fetch users to include names in logs
        const userIds = [...new Set(logs.map(l => l.changedBy))];
        const users = await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            include: { employee: true }
        });

        // Fetch order creator to include in oldData/newData if missing
        const order = await this.prisma.order.findUnique({
            where: { id: orderId },
            include: { creator: { include: { employee: true } } }
        });

        return logs.map(l => {
            const changedByUser = users.find(u => u.id === l.changedBy);
            if (order && order.creator) {
                if (l.oldData && typeof l.oldData === 'object') {
                    (l.oldData as any).creator = order.creator;
                }
                if (l.newData && typeof l.newData === 'object') {
                    (l.newData as any).creator = order.creator;
                }
            }
            return {
                ...l,
                changedByUser
            };
        });
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
