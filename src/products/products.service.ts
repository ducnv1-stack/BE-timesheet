import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return (this.prisma.product as any).findMany({
            include: {
                bonusPolicies: {
                    include: { rules: true },
                    orderBy: { startDate: 'desc' }
                },
                minPricePolicies: true
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    async findOne(id: string) {
        const product = await (this.prisma.product as any).findUnique({
            where: { id },
            include: {
                bonusPolicies: {
                    include: { rules: true },
                    orderBy: { startDate: 'desc' }
                },
                minPricePolicies: true
            },
        });
        if (!product) throw new NotFoundException('Sản phẩm không tồn tại');
        return product;
    }

    async create(createProductDto: CreateProductDto) {
        const { bonusRules, minPricePolicies, ...productData } = createProductDto;

        return (this.prisma.product as any).create({
            data: {
                ...productData,
                // Legacy: If bonusRules are passed, create a default policy with those rules
                bonusPolicies: bonusRules ? {
                    create: [{
                        name: 'Chính sách mặc định',
                        startDate: new Date('2000-01-01'),
                        rules: {
                            create: bonusRules.map(rule => ({
                                minSellPrice: rule.minSellPrice,
                                bonusAmount: rule.bonusAmount,
                                salePercent: rule.salePercent || 0,
                                managerPercent: rule.managerPercent || 0,
                            }))
                        }
                    }]
                } : undefined,
                minPricePolicies: minPricePolicies ? {
                    create: minPricePolicies.map(policy => ({
                        minPrice: policy.minPrice,
                        startDate: new Date(policy.startDate),
                        endDate: policy.endDate ? new Date(policy.endDate) : null,
                    }))
                } : undefined,
            },
            include: {
                bonusPolicies: {
                    include: { rules: true },
                    orderBy: { startDate: 'desc' }
                },
                minPricePolicies: true
            },
        });
    }

    async update(id: string, updateProductDto: UpdateProductDto) {
        const { bonusRules, minPricePolicies, ...productData } = updateProductDto;

        // If bonusRules provided (legacy format), delete old policies+rules and recreate
        if (bonusRules) {
            // Delete all existing policies (cascade will delete rules too)
            await (this.prisma as any).productBonusPolicy.deleteMany({
                where: { productId: id }
            });
        }

        if (minPricePolicies) {
            await (this.prisma as any).productMinPricePolicy.deleteMany({
                where: { productId: id }
            });
        }

        return (this.prisma.product as any).update({
            where: { id },
            data: {
                ...productData,
                bonusPolicies: bonusRules ? {
                    create: [{
                        name: 'Chính sách mặc định',
                        startDate: new Date('2000-01-01'),
                        rules: {
                            create: bonusRules.map(rule => ({
                                minSellPrice: rule.minSellPrice,
                                bonusAmount: rule.bonusAmount,
                                salePercent: rule.salePercent || 0,
                                managerPercent: rule.managerPercent || 0,
                            }))
                        }
                    }]
                } : undefined,
                minPricePolicies: minPricePolicies ? {
                    create: minPricePolicies.map(policy => ({
                        minPrice: policy.minPrice,
                        startDate: new Date(policy.startDate),
                        endDate: policy.endDate ? new Date(policy.endDate) : null,
                    }))
                } : undefined,
            },
            include: {
                bonusPolicies: {
                    include: { rules: true },
                    orderBy: { startDate: 'desc' }
                },
                minPricePolicies: true
            },
        });
    }

    async remove(id: string) {
        // Cascade delete is handled by Prisma schema for bonusPolicies and minPricePolicies
        return this.prisma.product.delete({
            where: { id }
        });
    }

    // 🆕 Bonus Policy CRUD
    async findBonusPolicies(productId: string) {
        return (this.prisma as any).productBonusPolicy.findMany({
            where: { productId },
            include: { rules: { orderBy: { minSellPrice: 'asc' } } },
            orderBy: { startDate: 'desc' },
        });
    }

    async createBonusPolicy(productId: string, data: any) {
        return (this.prisma as any).productBonusPolicy.create({
            data: {
                productId,
                name: data.name || null,
                startDate: new Date(data.startDate),
                endDate: data.endDate ? new Date(data.endDate) : null,
                rules: data.rules ? {
                    create: data.rules.map((r: any) => ({
                        minSellPrice: r.minSellPrice,
                        bonusAmount: r.bonusAmount,
                        salePercent: r.salePercent || 70,
                        managerPercent: r.managerPercent || 30,
                    }))
                } : undefined,
            },
            include: { rules: true },
        });
    }

    async updateBonusPolicy(productId: string, policyId: string, data: any) {
        // Delete old rules if new rules are provided
        if (data.rules) {
            await (this.prisma as any).productBonusRule.deleteMany({
                where: { policyId }
            });
        }

        return (this.prisma as any).productBonusPolicy.update({
            where: { id: policyId },
            data: {
                name: data.name !== undefined ? data.name : undefined,
                startDate: data.startDate ? new Date(data.startDate) : undefined,
                endDate: data.endDate !== undefined ? (data.endDate ? new Date(data.endDate) : null) : undefined,
                rules: data.rules ? {
                    create: data.rules.map((r: any) => ({
                        minSellPrice: r.minSellPrice,
                        bonusAmount: r.bonusAmount,
                        salePercent: r.salePercent || 70,
                        managerPercent: r.managerPercent || 30,
                    }))
                } : undefined,
            },
            include: { rules: true },
        });
    }

    async deleteBonusPolicy(policyId: string) {
        return (this.prisma as any).productBonusPolicy.delete({
            where: { id: policyId },
        });
    }
}
