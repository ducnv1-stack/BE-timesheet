import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.product.findMany({
            include: { bonusRules: true },
            orderBy: { createdAt: 'desc' },
        });
    }

    async findOne(id: string) {
        const product = await this.prisma.product.findUnique({
            where: { id },
            include: { bonusRules: true },
        });
        if (!product) throw new NotFoundException('Sản phẩm không tồn tại');
        return product;
    }

    async create(createProductDto: CreateProductDto) {
        const { bonusRules, ...productData } = createProductDto;

        return this.prisma.product.create({
            data: {
                ...productData,
                bonusRules: bonusRules ? {
                    create: bonusRules.map(rule => ({
                        minSellPrice: rule.minSellPrice,
                        bonusAmount: rule.bonusAmount,
                        salePercent: rule.salePercent || 0,
                        managerPercent: rule.managerPercent || 0,
                    }))
                } : undefined,
            },
            include: { bonusRules: true },
        });
    }

    async update(id: string, updateProductDto: UpdateProductDto) {
        const { bonusRules, ...productData } = updateProductDto;

        if (bonusRules) {
            await this.prisma.productBonusRule.deleteMany({
                where: { productId: id }
            });
        }

        return this.prisma.product.update({
            where: { id },
            data: {
                ...productData,
                bonusRules: bonusRules ? {
                    create: bonusRules.map(rule => ({
                        minSellPrice: rule.minSellPrice,
                        bonusAmount: rule.bonusAmount,
                        salePercent: rule.salePercent || 0,
                        managerPercent: rule.managerPercent || 0,
                    }))
                } : undefined,
            },
            include: { bonusRules: true },
        });
    }

    async remove(id: string) {
        // Cascade delete is handled by Prisma schema for bonusRules
        return this.prisma.product.delete({
            where: { id }
        });
    }
}
