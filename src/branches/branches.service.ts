import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BranchesService {
    constructor(private prisma: PrismaService) { }

    async findAll(type?: 'KHO_TONG' | 'CHI_NHANH', isActive?: boolean) {
        return this.prisma.branch.findMany({
            where: {
                ...(type ? { branchType: type } : {}),
                ...(isActive !== undefined ? { isActive } : {}),
            },
            orderBy: { name: 'asc' },
        });
    }

    async findOne(id: string) {
        return this.prisma.branch.findUnique({
            where: { id },
        });
    }

    async create(data: { code: string, name: string, address?: string, branchType: 'KHO_TONG' | 'CHI_NHANH' }) {
        return this.prisma.branch.create({
            data,
        });
    }

    async update(id: string, data: { 
        name?: string, 
        address?: string, 
        branchType?: 'KHO_TONG' | 'CHI_NHANH',
        latitude?: number, 
        longitude?: number, 
        checkinRadius?: number,
        isActive?: boolean
    }) {
        return this.prisma.branch.update({
            where: { id },
            data,
        });
    }

    async remove(id: string) {
        try {
            return await this.prisma.branch.delete({
                where: { id },
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
                throw new BadRequestException('Không thể xoá chi nhánh này vì đang có dữ liệu nhân viên, đơn hàng hoặc tồn kho liên quan.');
            }
            throw error;
        }
    }
}
