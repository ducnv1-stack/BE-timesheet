import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BranchesService {
    constructor(private prisma: PrismaService) { }

    async findAll(type?: 'KHO_TONG' | 'CHI_NHANH') {
        return this.prisma.branch.findMany({
            where: type ? { branchType: type } : undefined,
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
        checkinRadius?: number 
    }) {
        return this.prisma.branch.update({
            where: { id },
            data,
        });
    }

    async remove(id: string) {
        return this.prisma.branch.delete({
            where: { id },
        });
    }
}
