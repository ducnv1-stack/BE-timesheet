import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PositionsService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.position.findMany({
            include: {
                attendancePolicy: {
                    select: { id: true, name: true }
                },
                _count: {
                    select: { employees: true }
                }
            },
            orderBy: { name: 'asc' }
        });
    }

    async findOne(id: string) {
        const pos = await this.prisma.position.findUnique({
            where: { id },
            include: {
                attendancePolicy: true,
                employees: {
                    select: {
                        id: true,
                        fullName: true,
                        department: true,
                        status: true
                    }
                }
            }
        });
        if (!pos) throw new NotFoundException('Không tìm thấy chức vụ');
        return pos;
    }

    async create(data: { 
        name: string, 
        attendancePolicyId?: string, 
        note?: string,
        baseSalary?: number,
        diligentSalary?: number,
        allowance?: number,
        standardWorkingDays?: number
    }) {
        const exists = await this.prisma.position.findUnique({ where: { name: data.name } });
        if (exists) throw new BadRequestException('Tên chức vụ đã tồn tại');

        return this.prisma.position.create({ data });
    }

    async update(id: string, data: { 
        name?: string, 
        attendancePolicyId?: string, 
        note?: string,
        baseSalary?: number,
        diligentSalary?: number,
        allowance?: number,
        standardWorkingDays?: number
    }) {
        const pos = await this.prisma.position.findUnique({ where: { id } });
        if (!pos) throw new NotFoundException('Không tìm thấy chức vụ');

        if (data.name && data.name !== pos.name) {
            const exists = await this.prisma.position.findUnique({ where: { name: data.name } });
            if (exists) throw new BadRequestException('Tên chức vụ đã tồn tại');
        }

        return this.prisma.position.update({
            where: { id },
            data
        });
    }

    async remove(id: string) {
        const count = await this.prisma.employee.count({ where: { positionId: id } });
        if (count > 0) {
            throw new BadRequestException(`Không thể xóa chức vụ đang được gán cho ${count} nhân viên.`);
        }

        await this.prisma.position.delete({ where: { id } });
        return { message: 'Đã xóa chức vụ' };
    }
}
