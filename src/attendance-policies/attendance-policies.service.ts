import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AttendancePoliciesService {
    constructor(private prisma: PrismaService) { }

    async findAll() {
        return this.prisma.attendancePolicy.findMany({
            include: {
                days: {
                    orderBy: { dayOfWeek: 'asc' }
                },
                _count: {
                    select: { 
                        positions: true,
                        employees: true
                    }
                }
            },
            orderBy: { name: 'asc' }
        });
    }

    async findOne(id: string) {
        const policy = await this.prisma.attendancePolicy.findUnique({
            where: { id },
            include: {
                days: {
                    orderBy: { dayOfWeek: 'asc' }
                },
                positions: {
                    select: { id: true, name: true }
                }
            }
        });
        if (!policy) throw new NotFoundException('Không tìm thấy chính sách');
        return policy;
    }

    async create(data: { name: string, note?: string, latitude?: number, longitude?: number, radius?: number, days: any[] }) {
        const exists = await this.prisma.attendancePolicy.findUnique({ where: { name: data.name } });
        if (exists) throw new BadRequestException('Tên chính sách đã tồn tại');

        // Tạo chính sách kèm theo các ngày
        return this.prisma.attendancePolicy.create({
            data: {
                name: data.name,
                note: data.note,
                latitude: data.latitude,
                longitude: data.longitude,
                radius: data.radius,
                days: {
                    create: data.days.map(day => ({
                        dayOfWeek: day.dayOfWeek,
                        startTime: day.startTime,
                        endTime: day.endTime,
                        isOff: day.isOff ?? false,
                        allowOT: day.allowOT ?? false,
                        otMultiplier: day.otMultiplier ?? 1.5,
                        requireGPS: day.requireGPS ?? true,
                        workCount: day.workCount ?? 1.0,
                        isFlexible: day.isFlexible ?? false
                    }))
                }
            },
            include: { days: true }
        });
    }

    async update(id: string, data: { name?: string, note?: string, latitude?: number, longitude?: number, radius?: number, days?: any[] }) {
        const policy = await this.prisma.attendancePolicy.findUnique({ 
            where: { id },
            include: { days: true }
        });
        if (!policy) throw new NotFoundException('Không tìm thấy chính sách');

        if (data.name && data.name !== policy.name) {
            const exists = await this.prisma.attendancePolicy.findUnique({ where: { name: data.name } });
            if (exists) throw new BadRequestException('Tên chính sách đã tồn tại');
        }

        // Cập nhật thông tin chung
        await this.prisma.attendancePolicy.update({
            where: { id },
            data: {
                name: data.name,
                note: data.note,
                latitude: data.latitude,
                longitude: data.longitude,
                radius: data.radius
            }
        });

        // Cập nhật chi tiết các ngày nếu có cung cấp
        if (data.days && data.days.length > 0) {
            for (const day of data.days) {
                await this.prisma.attendancePolicyDay.upsert({
                    where: {
                        attendancePolicyId_dayOfWeek: {
                            attendancePolicyId: id,
                            dayOfWeek: day.dayOfWeek
                        }
                    },
                    update: {
                        startTime: day.startTime,
                        endTime: day.endTime,
                        isOff: day.isOff,
                        allowOT: day.allowOT,
                        otMultiplier: day.otMultiplier ?? 1.5,
                        requireGPS: day.requireGPS,
                        workCount: day.workCount ?? 1.0,
                        isFlexible: day.isFlexible
                    },
                    create: {
                        attendancePolicyId: id,
                        dayOfWeek: day.dayOfWeek,
                        startTime: day.startTime,
                        endTime: day.endTime,
                        isOff: day.isOff ?? false,
                        allowOT: day.allowOT ?? false,
                        otMultiplier: day.otMultiplier ?? 1.5,
                        requireGPS: day.requireGPS ?? true,
                        workCount: day.workCount ?? 1.0,
                        isFlexible: day.isFlexible ?? false
                    }
                });
            }
        }

        return this.findOne(id);
    }

    async remove(id: string) {
        const count = await this.prisma.position.count({ where: { attendancePolicyId: id } });
        if (count > 0) {
            throw new BadRequestException(`Không thể xóa chính sách đang được áp dụng cho ${count} chức vụ.`);
        }

        // cascade delete will handle days if configured, but let's be sure
        await this.prisma.attendancePolicy.delete({ where: { id } });
        return { message: 'Đã xóa chính sách thành công' };
    }
}
