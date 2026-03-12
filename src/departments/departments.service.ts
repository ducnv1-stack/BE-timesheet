import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DepartmentsService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.department.findMany({
            include: {
                _count: {
                    select: { employees: true }
                }
            },
            orderBy: { name: 'asc' }
        });
    }

    async findOne(id: string) {
        const dept = await this.prisma.department.findUnique({
            where: { id },
            include: {
                employees: {
                    select: {
                        id: true,
                        fullName: true,
                        position: true,
                        status: true
                    }
                }
            }
        });
        if (!dept) throw new NotFoundException('Không tìm thấy phòng ban');
        return dept;
    }

    async create(data: { name: string, note?: string }) {
        const exists = await this.prisma.department.findUnique({ where: { name: data.name } });
        if (exists) throw new BadRequestException('Tên phòng ban đã tồn tại');

        return this.prisma.department.create({ data });
    }

    async update(id: string, data: { name?: string, note?: string }) {
        const dept = await this.prisma.department.findUnique({ where: { id } });
        if (!dept) throw new NotFoundException('Không tìm thấy phòng ban');

        if (data.name && data.name !== dept.name) {
            const exists = await this.prisma.department.findUnique({ where: { name: data.name } });
            if (exists) throw new BadRequestException('Tên phòng ban đã tồn tại');
        }

        return this.prisma.department.update({
            where: { id },
            data
        });
    }

    async remove(id: string) {
        const count = await this.prisma.employee.count({ where: { departmentId: id } });
        if (count > 0) {
            throw new BadRequestException(`Không thể xóa phòng ban đang có ${count} nhân viên. Hãy chuyển nhân viên sang phòng ban khác trước.`);
        }

        await this.prisma.department.delete({ where: { id } });
        return { message: 'Đã xóa phòng ban' };
    }
}
