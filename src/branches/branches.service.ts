import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BranchesService {
    constructor(private prisma: PrismaService) { }

    findAll() {
        return this.prisma.branch.findMany({
            orderBy: { name: 'asc' },
        });
    }

    update(id: string, data: { latitude?: number, longitude?: number, checkinRadius?: number }) {
        return this.prisma.branch.update({
            where: { id },
            data,
        });
    }
}
