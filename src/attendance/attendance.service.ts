import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CheckInDto, CheckOutDto } from './dto/attendance.dto';

@Injectable()
export class AttendanceService {
    constructor(private prisma: PrismaService) { }

    // Tính khoảng cách giữa 2 điểm GPS (mét) bằng công thức Haversine
    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371e3; // Bán kính Trái đất trung bình tính bằng mét
        const phi1 = (lat1 * Math.PI) / 180;
        const phi2 = (lat2 * Math.PI) / 180;
        const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
        const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

        const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return Math.round(R * c);
    }

    // Lấy trạng thái chấm công của nhân viên hôm nay
    async getTodayStatus(employeeId: string) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const attendance = await this.prisma.attendance.findUnique({
            where: {
                employeeId_date: {
                    employeeId,
                    date: today,
                },
            },
            include: {
                shift: true,
            },
        });

        if (!attendance) return { status: 'NOT_CHECKED_IN' };
        return attendance;
    }

    // Xử lý Check-in
    async checkIn(employeeId: string, dto: CheckInDto) {
        const now = new Date();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Lấy thông tin nhân viên và chi nhánh
        const employee = await this.prisma.employee.findUnique({
            where: { id: employeeId },
            include: { branch: true },
        });

        if (!employee) throw new NotFoundException('Không tìm thấy nhân viên');
        if (!employee.branch.latitude || !employee.branch.longitude) {
            throw new BadRequestException('Chi nhánh chưa được cấu hình tọa độ GPS');
        }

        // Tính khoảng cách
        const distance = this.calculateDistance(
            dto.latitude, dto.longitude,
            employee.branch.latitude, employee.branch.longitude
        );

        const isWithinRange = distance <= employee.branch.checkinRadius;

        // Tìm hoặc tạo bản ghi chấm công hôm nay
        let attendance = await this.prisma.attendance.findUnique({
            where: { employeeId_date: { employeeId, date: today } },
        });

        if (attendance && attendance.checkInTime) {
            throw new BadRequestException('Bạn đã chấm công vào hôm nay rồi');
        }

        // Kiểm tra số lần thử (Ghi nhận nhưng không giới hạn nữa theo yêu cầu)
        const attemptCount = attendance ? attendance.checkInAttempts + 1 : 1;

        if (!isWithinRange) {
            // Ghi nhận lần thử thất bại vào DB
            if (!attendance) {
                await this.prisma.attendance.create({
                    data: {
                        employeeId,
                        branchId: employee.branchId,
                        date: today,
                        checkInAttempts: attemptCount,
                    }
                });
            } else {
                await this.prisma.attendance.update({
                    where: { id: attendance.id },
                    data: { checkInAttempts: attemptCount }
                });
            }
            throw new BadRequestException(`Ngoài phạm vi cho phép (${distance}m). Vui lòng di chuyển lại gần chi nhánh và thử lại.`);
        }

        // Nếu trong phạm vi, thực hiện check-in thành công
        // Lấy ca làm việc mặc định (giả sử ca đầu tiên của chi nhánh)
        const shift = await this.prisma.workShift.findFirst({
            where: { branchId: employee.branchId, isActive: true },
        });

        let checkInStatus = 'ON_TIME';
        let lateMinutes = 0;

        if (shift) {
            const [startH, startM] = shift.startTime.split(':').map(Number);
            const shiftStartTime = new Date(today);
            shiftStartTime.setHours(startH, startM, 0, 0);

            const diffMinutes = Math.floor((now.getTime() - shiftStartTime.getTime()) / 60000);

            if (diffMinutes > shift.lateSeriousThreshold) {
                checkInStatus = 'LATE_SERIOUS';
                lateMinutes = diffMinutes;
            } else if (diffMinutes > shift.lateThreshold) {
                checkInStatus = 'LATE';
                lateMinutes = diffMinutes;
            }
        }

        const dailyStatus = checkInStatus === 'ON_TIME' ? 'FULL_DAY' : 'LATE_DAY'; // Logic đơn giản, có thể mở rộng

        if (!attendance) {
            return this.prisma.attendance.create({
                data: {
                    employeeId,
                    branchId: employee.branchId,
                    date: today,
                    shiftId: shift?.id,
                    checkInTime: now,
                    checkInLatitude: dto.latitude,
                    checkInLongitude: dto.longitude,
                    checkInDistance: distance,
                    checkInStatus,
                    checkInMethod: 'GPS',
                    checkInAttempts: attemptCount,
                    lateMinutes,
                    dailyStatus,
                    note: dto.note,
                }
            });
        } else {
            return this.prisma.attendance.update({
                where: { id: attendance.id },
                data: {
                    shiftId: shift?.id,
                    checkInTime: now,
                    checkInLatitude: dto.latitude,
                    checkInLongitude: dto.longitude,
                    checkInDistance: distance,
                    checkInStatus,
                    checkInMethod: 'GPS',
                    checkInAttempts: attemptCount,
                    lateMinutes,
                    dailyStatus,
                    note: dto.note,
                }
            });
        }
    }

    // Xử lý Check-out
    async checkOut(employeeId: string, dto: CheckOutDto) {
        const now = new Date();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const attendance = await this.prisma.attendance.findUnique({
            where: { employeeId_date: { employeeId, date: today } },
            include: { shift: true, employee: { include: { branch: true } } },
        });

        if (!attendance || !attendance.checkInTime) {
            throw new BadRequestException('Bạn chưa check-in hôm nay');
        }

        if (attendance.checkOutTime) {
            throw new BadRequestException('Bạn đã check-out hôm nay rồi');
        }

        // Kiểm tra tọa độ chi nhánh
        if (attendance.employee.branch.latitude === null || attendance.employee.branch.longitude === null) {
            throw new BadRequestException('Chi nhánh chưa được cấu hình tọa độ GPS');
        }

        // Tính khoảng cách
        const distance = this.calculateDistance(
            dto.latitude, dto.longitude,
            attendance.employee.branch.latitude as number, attendance.employee.branch.longitude as number
        );

        // Kiểm tra phạm vi
        const isWithinRange = distance <= attendance.employee.branch.checkinRadius;

        if (!isWithinRange) {
            throw new BadRequestException(`Ngoài phạm vi cho phép (${distance}m) để Check-out. Vui lòng di chuyển lại gần chi nhánh.`);
        }

        // Tính toán trạng thái checkout
        let checkOutStatus = 'ON_TIME';
        let earlyLeaveMinutes = 0;
        let overtimeMinutes = 0;

        if (attendance.shift) {
            const [endH, endM] = attendance.shift.endTime.split(':').map(Number);
            const shiftEndTime = new Date(today);
            shiftEndTime.setHours(endH, endM, 0, 0);

            const diffMinutes = Math.floor((now.getTime() - shiftEndTime.getTime()) / 60000);

            if (diffMinutes < -attendance.shift.earlyLeaveThreshold) {
                checkOutStatus = 'EARLY_LEAVE';
                earlyLeaveMinutes = Math.abs(diffMinutes);
            } else if (diffMinutes >= 30) { // Tối thiểu 30p mới tính tăng ca
                checkOutStatus = 'OVERTIME';
                overtimeMinutes = diffMinutes;
            }
        }

        const totalWorkMinutes = Math.floor((now.getTime() - attendance.checkInTime.getTime()) / 60000);

        return this.prisma.attendance.update({
            where: { id: attendance.id },
            data: {
                checkOutTime: now,
                checkOutLatitude: dto.latitude,
                checkOutLongitude: dto.longitude,
                checkOutDistance: distance,
                checkOutStatus,
                checkOutMethod: 'GPS',
                totalWorkMinutes,
                overtimeMinutes,
                earlyLeaveMinutes,
                note: attendance.note ? `${attendance.note} | ${dto.note}` : dto.note,
            }
        });
    }

    // Lấy bảng công tháng
    async getMonthlyTimesheet(employeeId: string, month: number, year: number) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);

        return this.prisma.attendance.findMany({
            where: {
                employeeId,
                date: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            orderBy: { date: 'asc' },
            include: { shift: true },
        });
    }

    // Lấy bảng tổng hợp công của nhiều nhân viên trong tháng
    async getMonthlySummary(month: number, year: number, branchId?: string, search?: string, position?: string) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);

        // 1. Lấy danh sách nhân viên thỏa mãn điều kiện (không nghỉ việc)
        const employees = await this.prisma.employee.findMany({
            where: {
                status: { not: 'Nghỉ việc' },
                ...(branchId ? { branchId } : {}),
                ...(position ? { position } : {}),
                ...(search ? {
                    OR: [
                        { fullName: { contains: search } },
                        { phone: { contains: search } }
                    ]
                } : {})
            },
            select: {
                id: true,
                fullName: true,
                phone: true,
                position: true,
                avatarUrl: true,
                branch: { select: { name: true } }
            },
            orderBy: { fullName: 'asc' }
        });

        const employeeIds = employees.map(e => e.id);

        // 2. Lấy dữ liệu chấm công của các nhân viên này trong tháng
        const attendanceRecords = await this.prisma.attendance.findMany({
            where: {
                employeeId: { in: employeeIds },
                date: {
                    gte: startDate,
                    lte: endDate,
                },
            }
        });

        // 3. Tính toán tổng kết cho từng nhân viên
        const summary = employees.map(emp => {
            const empAttendance = attendanceRecords.filter(a => a.employeeId === emp.id);

            const totalWorkDays = empAttendance.filter(a => a.checkInTime).length;
            const lateDays = empAttendance.filter(a => a.checkInStatus === 'LATE' || a.checkInStatus === 'LATE_SERIOUS').length;
            const earlyLeaveDays = empAttendance.filter(a => a.checkOutStatus === 'EARLY_LEAVE').length;
            const totalOvertimeMinutes = empAttendance.reduce((acc, a) => acc + (a.overtimeMinutes || 0), 0);

            return {
                employeeId: emp.id,
                fullName: emp.fullName,
                phone: emp.phone,
                avatarUrl: emp.avatarUrl,
                branchName: emp.branch.name,
                position: emp.position,
                totalWorkDays,
                lateDays,
                earlyLeaveDays,
                totalOvertimeHours: (totalOvertimeMinutes / 60).toFixed(1)
            };
        });

        return summary;
    }
}
