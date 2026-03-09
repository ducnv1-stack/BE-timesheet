import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class DeliveryFeeRulesService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.deliveryFeeRule.findMany({
            include: { branch: true },
            orderBy: [
                { branchId: { sort: 'asc', nulls: 'first' } },
                { deliveryCategory: 'asc' },
            ],
        });
    }

    async create(data: { branchId?: string; deliveryCategory: string; feeAmount: number }) {
        return this.prisma.deliveryFeeRule.create({
            data: {
                branchId: data.branchId || null,
                deliveryCategory: data.deliveryCategory,
                feeAmount: new Decimal(data.feeAmount),
            },
            include: { branch: true },
        });
    }

    async update(id: string, data: { feeAmount?: number; isActive?: boolean }) {
        return this.prisma.deliveryFeeRule.update({
            where: { id },
            data: {
                ...(data.feeAmount !== undefined && { feeAmount: new Decimal(data.feeAmount) }),
                ...(data.isActive !== undefined && { isActive: data.isActive }),
            },
            include: { branch: true },
        });
    }

    async remove(id: string) {
        return this.prisma.deliveryFeeRule.delete({ where: { id } });
    }

    /**
     * Lấy phí giao hàng theo category và branchId.
     * Ưu tiên: rule cụ thể cho chi nhánh → rule mặc định (branchId = null) → fallback = 0.
     */
    async getDeliveryFee(category: string, branchId: string): Promise<number> {
        // 1. Tìm rule cụ thể cho chi nhánh
        const specificRule = await this.prisma.deliveryFeeRule.findFirst({
            where: {
                branchId,
                deliveryCategory: category,
                isActive: true,
            },
        });

        if (specificRule) return Number(specificRule.feeAmount);

        // 2. Tìm rule mặc định (branchId = null)
        const defaultRule = await this.prisma.deliveryFeeRule.findFirst({
            where: {
                branchId: null,
                deliveryCategory: category,
                isActive: true,
            },
        });

        if (defaultRule) return Number(defaultRule.feeAmount);

        // 3. Fallback
        return 0;
    }
}
