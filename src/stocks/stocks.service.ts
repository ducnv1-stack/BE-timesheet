import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionType, StockItemStatus } from '@prisma/client';

@Injectable()
export class StocksService {
    constructor(private prisma: PrismaService) { }

    async createTransaction(dto: {
        type: TransactionType,
        fromBranchId?: string,
        toBranchId?: string,
        productId: string,
        quantity: number,
        serialNumbers?: string[],
        note?: string,
        createdBy: string
    }) {
        return this.prisma.$transaction(async (tx) => {
            // 1. Generate code (simplistic for demo: TYPE-TIMESTAMP)
            const code = `${dto.type}-${Date.now()}`;

            // 2. Handle StockItems (Serials) if provided
            if (dto.serialNumbers && dto.serialNumbers.length > 0) {
                if (dto.serialNumbers.length !== dto.quantity) {
                    throw new BadRequestException('Số lượng số lượng Serial không khớp với số lượng hàng');
                }

                for (const serial of dto.serialNumbers) {
                    if (dto.type === TransactionType.IMPORT) {
                        // Create new StockItem
                        await tx.stockItem.create({
                            data: {
                                serialNumber: serial,
                                productId: dto.productId,
                                branchId: dto.toBranchId!,
                                status: StockItemStatus.AVAILABLE,
                            }
                        });
                    } else if (dto.type === TransactionType.TRANSFER) {
                        // Update existing StockItem status
                        const item = await tx.stockItem.findUnique({ where: { serialNumber: serial } });
                        if (!item || item.branchId !== dto.fromBranchId) {
                            throw new BadRequestException(`Serial ${serial} không tồn tại trong kho gửi`);
                        }
                        await tx.stockItem.update({
                            where: { serialNumber: serial },
                            data: { branchId: dto.toBranchId!, status: StockItemStatus.AVAILABLE }
                        });
                    } else if (dto.type === TransactionType.SALE) {
                        await tx.stockItem.update({
                            where: { serialNumber: serial },
                            data: { status: StockItemStatus.SOLD }
                        });
                    } else if (dto.type === TransactionType.UPGRADE_RETURN) {
                        // For upgrade return, the machine might already exist (if it was sold through the system)
                        // or it might be new (legacy machine).
                        const existing = await tx.stockItem.findUnique({ where: { serialNumber: serial } });
                        if (existing) {
                            await tx.stockItem.update({
                                where: { serialNumber: serial },
                                data: { branchId: dto.toBranchId!, status: StockItemStatus.RETRIEVED }
                            });
                        } else {
                            await tx.stockItem.create({
                                data: {
                                    serialNumber: serial,
                                    productId: dto.productId,
                                    branchId: dto.toBranchId!,
                                    status: StockItemStatus.RETRIEVED,
                                }
                            });
                        }
                    }
                }
            }

            // 3. Update BranchStock (Summary)
            if (dto.fromBranchId) {
                await this.updateBranchStock(tx, dto.fromBranchId, dto.productId, -dto.quantity);
            }
            if (dto.toBranchId) {
                await this.updateBranchStock(tx, dto.toBranchId, dto.productId, dto.quantity);
            }

            // 4. Record Transaction
            return tx.stockTransaction.create({
                data: {
                    code,
                    type: dto.type,
                    fromBranchId: dto.fromBranchId,
                    toBranchId: dto.toBranchId,
                    productId: dto.productId,
                    quantity: dto.quantity,
                    serialNumbers: dto.serialNumbers || [],
                    note: dto.note,
                    createdBy: dto.createdBy,
                }
            });
        });
    }

    private async updateBranchStock(tx: any, branchId: string, productId: string, delta: number) {
        const stock = await tx.branchStock.findUnique({
            where: { branchId_productId: { branchId, productId } }
        });

        if (stock) {
            const newQuantity = stock.quantity + delta;
            if (newQuantity < 0) {
                throw new BadRequestException(`Kho ${branchId} không đủ tồn kho cho sản phẩm ${productId}`);
            }
            await tx.branchStock.update({
                where: { id: stock.id },
                data: { quantity: newQuantity }
            });
        } else {
            if (delta < 0) {
                throw new BadRequestException(`Kho ${branchId} không có sản phẩm ${productId}`);
            }
            await tx.branchStock.create({
                data: { branchId, productId, quantity: delta }
            });
        }
    }

    async getHistory(filters: { branchId?: string, productId?: string, type?: TransactionType }) {
        return this.prisma.stockTransaction.findMany({
            where: {
                OR: filters.branchId ? [
                    { fromBranchId: filters.branchId },
                    { toBranchId: filters.branchId }
                ] : undefined,
                productId: filters.productId,
                type: filters.type,
            },
            include: {
                fromBranch: true,
                toBranch: true,
                product: true,
                creator: { include: { employee: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    async getInventory(branchId?: string) {
        return this.prisma.branchStock.findMany({
            where: { branchId },
            include: {
                branch: true,
                product: {
                    include: {
                        stockItems: {
                            where: { branchId, status: StockItemStatus.AVAILABLE }
                        }
                    }
                }
            },
            orderBy: { branchId: 'asc' }
        });
    }
}
