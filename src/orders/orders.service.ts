import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { Decimal } from '@prisma/client/runtime/library';

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
                            splitAmount: totalAmount.mul(s.splitPercent).div(100),
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
                            splitAmount: totalAmount.mul(s.splitPercent).div(100),
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

    async findAll(userId?: string, roleCode?: string, branchId?: string) {
        let whereClause: any = {};

        if (userId && roleCode) {
            if (['SALE', 'TELESALE', 'DRIVER'].includes(roleCode)) {
                // SALE/TELESALE/DRIVER: See orders they created OR are assigned to (in splits)
                // TELESALE: Special case - also see ALL orders where source is 'FACEBOOK'
                const orConditions: any[] = [
                    { createdBy: userId },
                    {
                        splits: {
                            some: {
                                employee: {
                                    userId: userId
                                }
                            }
                        }
                    },
                    {
                        deliveries: {
                            some: {
                                driver: {
                                    userId: userId
                                }
                            }
                        }
                    }
                ];

                if (roleCode === 'TELESALE') {
                    orConditions.push({
                        orderSource: { equals: 'FACEBOOK', mode: 'insensitive' }
                    });
                }

                whereClause = {
                    OR: orConditions
                };
            } else if (['MANAGER', 'ACCOUNTANT'].includes(roleCode)) {
                // MANAGER/ACCOUNTANT: See all orders from their branch
                if (branchId) {
                    whereClause = { branchId };
                }
            } else if (['DIRECTOR', 'CHIEF_ACCOUNTANT'].includes(roleCode)) {
                // DIRECTOR/CHIEF_ACCOUNTANT: See all orders (no filter)
                whereClause = {};
            }
        } else if (userId) {
            // Fallback: If no roleCode provided, use old logic
            whereClause = { createdBy: userId };
        }

        return this.prisma.order.findMany({
            where: whereClause,
            include: {
                items: {
                    include: {
                        product: true
                    }
                },
                splits: {
                    include: {
                        employee: true,
                        branch: true
                    }
                },
                payments: true,
                branch: true,
                deliveries: {
                    include: {
                        driver: true
                    }
                },
                creator: {
                    include: {
                        employee: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
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
