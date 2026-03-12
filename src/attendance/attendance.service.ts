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

    // Helper: Lấy quy tắc chấm công áp dụng cho nhân viên theo index ngày (0-6)
    private async getPolicyForDayExplicit(employeeId: string, vnDayOfWeek: number) {
        const employee = await this.prisma.employee.findUnique({
            where: { id: employeeId },
            include: {
                attendancePolicy: {
                    include: {
                        days: true
                    }
                },
                pos: {
                    include: {
                        attendancePolicy: {
                            include: {
                                days: true
                            }
                        }
                    }
                }
            }
        });

        if (!employee) return null;

        // 1. Ưu tiên lấy chính sách được gán trực tiếp cho nhân viên (Ngoại lệ)
        if (employee.attendancePolicy) {
            const policyDay = employee.attendancePolicy.days.find(d => d.dayOfWeek === vnDayOfWeek);
            return {
                policy: employee.attendancePolicy,
                day: policyDay || null
            };
        }

        // 2. Nếu không có chính sách riêng, lấy theo Chức vụ (Mặc định)
        if (employee.pos?.attendancePolicy) {
            const policyDay = employee.pos.attendancePolicy.days.find(d => d.dayOfWeek === vnDayOfWeek);
            return {
                policy: employee.pos.attendancePolicy,
                day: policyDay || null
            };
        }

        return null;
    }

    // Lấy trạng thái chấm công của nhân viên hôm nay
    async getTodayStatus(employeeId: string) {
        // Lấy ngày hôm nay theo giờ VN
        const nowVN = new Date(new Date().getTime() + 7 * 3600000);
        const today = new Date(Date.UTC(nowVN.getUTCFullYear(), nowVN.getUTCMonth(), nowVN.getUTCDate()));

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
        const nowVN = new Date(now.getTime() + 7 * 3600000);
        const today = new Date(Date.UTC(nowVN.getUTCFullYear(), nowVN.getUTCMonth(), nowVN.getUTCDate()));

        // Lấy thông tin nhân viên và chi nhánh
        const employee = await this.prisma.employee.findUnique({
            where: { id: employeeId },
            include: { branch: true },
        });

        if (!employee) throw new NotFoundException('Không tìm thấy nhân viên');

        // 🆕 Lấy quy tắc từ Chính sách (nếu có)
        // Lấy ngày trong tuần theo giờ VN (UTC+7)
        const vnTimestamp = now.getTime() + 7 * 3600000;
        const vnDate = new Date(vnTimestamp);
        const vnDayOfWeek = vnDate.getUTCDay(); // 0: CN -> 6: T7

        const policyInfo = await this.getPolicyForDayExplicit(employeeId, vnDayOfWeek);
        const policyDay = policyInfo?.day;
        const policy = policyInfo?.policy;
        
        // 1. Kiểm tra Ngày nghỉ
        if (policyDay?.isOff) {
            throw new BadRequestException('Hôm nay là ngày nghỉ theo quy định của bạn');
        }

        // 2. Kiểm tra GPS (nếu chính sách yêu cầu hoặc mặc định là có)
        const requiresGPS = policyDay ? policyDay.requireGPS : true;
        let distance = 0;
        let isWithinRange = true;

        if (requiresGPS) {
            // Ưu tiên GPS của chính sách, sau đó mới đến chi nhánh
            const targetLat = policy?.latitude ?? employee.branch.latitude;
            const targetLon = policy?.longitude ?? employee.branch.longitude;
            const targetRadius = policy?.radius ?? employee.branch.checkinRadius;

            if (!targetLat || !targetLon) {
                throw new BadRequestException('Vị trí chấm công (Chi nhánh/Chính sách) chưa được cấu hình tọa độ GPS');
            }
            
            distance = this.calculateDistance(
                dto.latitude, dto.longitude,
                targetLat, targetLon
            );
            isWithinRange = distance <= targetRadius;
        }

        // Tìm hoặc tạo bản ghi chấm công hôm nay
        let attendance = await this.prisma.attendance.findUnique({
            where: { employeeId_date: { employeeId, date: today } },
        });

        if (attendance && attendance.checkInTime) {
            throw new BadRequestException('Bạn đã chấm công vào hôm nay rồi');
        }

        const attemptCount = attendance ? attendance.checkInAttempts + 1 : 1;

        if (requiresGPS && !isWithinRange) {
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

        // 3. Tính toán trạng thái Vào muộn (Late)
        let checkInStatus = 'ON_TIME';
        let lateMinutes = 0;
        let shiftId: string | undefined = undefined;
        let attendancePolicyDayId: string | undefined = undefined;

        if (policyDay) {
            attendancePolicyDayId = policyDay.id;

            if (policyDay.isFlexible) {
                // 🚀 Chế độ LINH HOẠT: Mặc định đúng giờ, không tính muộn
                checkInStatus = 'ON_TIME';
                lateMinutes = 0;
            } else {
                const [startH, startM] = policyDay.startTime.split(':').map(Number);
                
                // Giờ bắt đầu tính theo VN (UTC+7)
                const policyStartTimeUTC = new Date(today.getTime() + (startH - 7) * 3600000 + startM * 60000);
                const diffMinutes = Math.floor((now.getTime() - policyStartTimeUTC.getTime()) / 60000);
                
                if (diffMinutes > 30) {
                    checkInStatus = 'LATE_SERIOUS';
                    lateMinutes = diffMinutes;
                } else if (diffMinutes > 15) {
                    checkInStatus = 'LATE';
                    lateMinutes = diffMinutes;
                }
            }
        } else {
            // Fallback sang WorkShift cũ
            const shift = await this.prisma.workShift.findFirst({
                where: { branchId: employee.branchId, isActive: true },
            });
            if (shift) {
                shiftId = shift.id;
                const [startH, startM] = shift.startTime.split(':').map(Number);
                const shiftStartTimeUTC = new Date(today.getTime() + (startH - 7) * 3600000 + startM * 60000);
                const diffMinutes = Math.floor((now.getTime() - shiftStartTimeUTC.getTime()) / 60000);

                if (diffMinutes > shift.lateSeriousThreshold) {
                    checkInStatus = 'LATE_SERIOUS';
                    lateMinutes = diffMinutes;
                } else if (diffMinutes > shift.lateThreshold) {
                    checkInStatus = 'LATE';
                    lateMinutes = diffMinutes;
                }
            }
        }

        const dailyStatus = checkInStatus === 'ON_TIME' ? 'FULL_DAY' : 'LATE_DAY';

        const data = {
            employeeId,
            branchId: employee.branchId,
            date: today,
            shiftId,
            attendancePolicyDayId,
            checkInTime: now,
            checkInLatitude: dto.latitude,
            checkInLongitude: dto.longitude,
            checkInDistance: distance,
            checkInStatus,
            checkInMethod: requiresGPS ? 'GPS' : 'MANUAL',
            checkInAttempts: attemptCount,
            lateMinutes,
            dailyStatus,
            note: dto.note,
        };

        if (!attendance) {
            return this.prisma.attendance.create({ data });
        } else {
            return this.prisma.attendance.update({
                where: { id: attendance.id },
                data
            });
        }
    }

    // Xử lý Check-out
    async checkOut(employeeId: string, dto: CheckOutDto) {
        const now = new Date();
        const vnTimestamp = now.getTime() + 7 * 3600000;
        const vnDate = new Date(vnTimestamp);
        const vnDayOfWeek = vnDate.getUTCDay();
        
        const today = new Date(Date.UTC(vnDate.getUTCFullYear(), vnDate.getUTCMonth(), vnDate.getUTCDate()));

        const attendance = await this.prisma.attendance.findUnique({
            where: { employeeId_date: { employeeId, date: today } },
            include: { 
                shift: true, 
                policyDay: true,
                employee: { include: { branch: true } } 
            },
        });

        if (!attendance || !attendance.checkInTime) {
            throw new BadRequestException('Bạn chưa check-in hôm nay');
        }

        if (attendance.checkOutTime) {
            throw new BadRequestException('Bạn đã check-out hôm nay rồi');
        }

        // 1. Kiểm tra GPS (nếu quy tắc yêu cầu)
        const requiresGPS = attendance.policyDay ? attendance.policyDay.requireGPS : true;
        let distance = 0;

        if (requiresGPS) {
            // Lấy lại policy để có thông tin GPS override
            const policyInfo = await this.getPolicyForDayExplicit(employeeId, vnDayOfWeek);
            const policy = policyInfo?.policy;

            const targetLat = policy?.latitude ?? attendance.employee.branch.latitude;
            const targetLon = policy?.longitude ?? attendance.employee.branch.longitude;
            const targetRadius = policy?.radius ?? attendance.employee.branch.checkinRadius;

            if (!targetLat || !targetLon) {
                throw new BadRequestException('Vị trí chấm công (Chi nhánh/Chính sách) chưa được cấu hình tọa độ GPS');
            }

            distance = this.calculateDistance(
                dto.latitude, dto.longitude,
                targetLat, targetLon
            );
            if (distance > targetRadius) {
                throw new BadRequestException(`Ngoài phạm vi cho phép (${distance}m) để Check-out. Vui lòng di chuyển lại gần chi nhánh/điểm chấm công.`);
            }
        }

        // 2. Tính toán trạng thái checkout & OT
        let checkOutStatus = 'ON_TIME';
        let earlyLeaveMinutes = 0;
        let overtimeMinutes = 0;

        if (attendance.policyDay) {
            if (attendance.policyDay.isFlexible) {
                // 🚀 Chế độ LINH HOẠT: Mặc định đúng giờ, không tính sớm/OT
                checkOutStatus = 'ON_TIME';
                earlyLeaveMinutes = 0;
                overtimeMinutes = 0;
            } else {
                const [endH, endM] = attendance.policyDay.endTime.split(':').map(Number);
                const policyEndTimeUTC = new Date(today.getTime() + (endH - 7) * 3600000 + endM * 60000);
                const diffMinutes = Math.floor((now.getTime() - policyEndTimeUTC.getTime()) / 60000);

                if (diffMinutes < -15) { // Ngưỡng mặc định 15p
                    checkOutStatus = 'EARLY_LEAVE';
                    earlyLeaveMinutes = Math.abs(diffMinutes);
                } else if (diffMinutes >= 30 && attendance.policyDay.allowOT) {
                    checkOutStatus = 'OVERTIME';
                    overtimeMinutes = diffMinutes;
                }
            }
        } else if (attendance.shift) {
            const [endH, endM] = attendance.shift.endTime.split(':').map(Number);
            const shiftEndTimeUTC = new Date(today.getTime() + (endH - 7) * 3600000 + endM * 60000);
            const diffMinutes = Math.floor((now.getTime() - shiftEndTimeUTC.getTime()) / 60000);

            if (diffMinutes < -attendance.shift.earlyLeaveThreshold) {
                checkOutStatus = 'EARLY_LEAVE';
                earlyLeaveMinutes = Math.abs(diffMinutes);
            } else if (diffMinutes >= 30) {
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
                checkOutMethod: requiresGPS ? 'GPS' : 'MANUAL',
                totalWorkMinutes,
                overtimeMinutes,
                earlyLeaveMinutes,
                note: attendance.note ? `${attendance.note} | ${dto.note}` : dto.note,
            }
        });
    }

    // Lấy bảng công tháng
    async getMonthlyTimesheet(employeeId: string, month: number, year: number) {
        const startDate = new Date(Date.UTC(year, month - 1, 1));
        const endDate = new Date(Date.UTC(year, month, 0));

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

    // Lấy bảng tổng hợp công
    async getMonthlySummary(month: number, year: number, branchId?: string, search?: string, position?: string) {
        const startDate = new Date(Date.UTC(year, month - 1, 1));
        const endDate = new Date(Date.UTC(year, month, 0));

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
                pos: { select: { name: true } },
                avatarUrl: true,
                branch: { select: { name: true } }
            },
            orderBy: { fullName: 'asc' }
        });

        const employeeIds = employees.map(e => e.id);

        const attendanceRecords = await this.prisma.attendance.findMany({
            where: {
                employeeId: { in: employeeIds },
                date: {
                    gte: startDate,
                    lte: endDate,
                },
            }
        });

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
                position: emp.pos?.name || 'Chưa gán',
                totalWorkDays,
                lateDays,
                earlyLeaveDays,
                totalOvertimeHours: (totalOvertimeMinutes / 60).toFixed(1)
            };
        });

        return summary;
    }

    // ========== WORK SHIFT CRUD ==========

    async getShifts(branchId?: string) {
        return this.prisma.workShift.findMany({
            where: branchId ? { branchId } : {},
            include: { branch: { select: { id: true, name: true } } },
            orderBy: [{ branch: { name: 'asc' } }, { name: 'asc' }]
        });
    }

    async createShift(data: {
        branchId: string;
        name: string;
        startTime: string;
        endTime: string;
        breakMinutes?: number;
        lateThreshold?: number;
        lateSeriousThreshold?: number;
        earlyLeaveThreshold?: number;
    }) {
        return this.prisma.workShift.create({
            data: {
                branchId: data.branchId,
                name: data.name,
                startTime: data.startTime,
                endTime: data.endTime,
                breakMinutes: data.breakMinutes ?? 0,
                lateThreshold: data.lateThreshold ?? 15,
                lateSeriousThreshold: data.lateSeriousThreshold ?? 30,
                earlyLeaveThreshold: data.earlyLeaveThreshold ?? 15,
            },
            include: { branch: { select: { id: true, name: true } } }
        });
    }

    async updateShift(id: string, data: any) {
        const shift = await this.prisma.workShift.findUnique({ where: { id } });
        if (!shift) throw new NotFoundException('Không tìm thấy ca làm việc');

        return this.prisma.workShift.update({
            where: { id },
            data: {
                ...(data.name !== undefined && { name: data.name }),
                ...(data.startTime !== undefined && { startTime: data.startTime }),
                ...(data.endTime !== undefined && { endTime: data.endTime }),
                ...(data.breakMinutes !== undefined && { breakMinutes: data.breakMinutes }),
                ...(data.lateThreshold !== undefined && { lateThreshold: data.lateThreshold }),
                ...(data.lateSeriousThreshold !== undefined && { lateSeriousThreshold: data.lateSeriousThreshold }),
                ...(data.earlyLeaveThreshold !== undefined && { earlyLeaveThreshold: data.earlyLeaveThreshold }),
                ...(data.isActive !== undefined && { isActive: data.isActive }),
            },
            include: { branch: { select: { id: true, name: true } } }
        });
    }

    async deleteShift(id: string) {
        const shift = await this.prisma.workShift.findUnique({ where: { id } });
        if (!shift) throw new NotFoundException('Không tìm thấy ca làm việc');

        const count = await this.prisma.attendance.count({ where: { shiftId: id } });
        if (count > 0) {
            throw new BadRequestException(`Ca làm việc này đang được sử dụng bởi ${count} bản ghi chấm công. Hãy vô hiệu hóa thay vì xóa.`);
        }

        await this.prisma.workShift.delete({ where: { id } });
        return { message: 'Đã xóa ca làm việc' };
    }

    // Hiệu chỉnh công thủ công
    async adjustAttendance(data: {
        employeeId: string;
        date: string; // ISO string
        checkInTime?: string; // ISO string hoặc null
        checkOutTime?: string; // ISO string hoặc null
        note?: string;
    }) {
        // 1. Xác định targetDate (00:00:00 UTC của ngày local VN)
        const dateVN = new Date(new Date(data.date).getTime() + 7 * 3600000);
        const targetDate = new Date(Date.UTC(dateVN.getUTCFullYear(), dateVN.getUTCMonth(), dateVN.getUTCDate()));

        const employee = await this.prisma.employee.findUnique({
            where: { id: data.employeeId },
            include: { branch: true }
        });

        if (!employee) throw new NotFoundException('Không tìm thấy nhân viên');

        let attendance = await this.prisma.attendance.findUnique({
            where: { employeeId_date: { employeeId: data.employeeId, date: targetDate } },
            include: { shift: true }
        });

        let shift = attendance?.shift;
        if (!shift) {
            shift = await this.prisma.workShift.findFirst({
                where: { branchId: employee.branchId, isActive: true },
            });
        }

        let lateMinutes = 0;
        let earlyLeaveMinutes = 0;
        let overtimeMinutes = 0;
        let checkInStatus = 'ON_TIME';
        let checkOutStatus = 'ON_TIME';
        let totalWorkMinutes = 0;

        // 2. Chuyển đổi giờ vào/ra từ Local VN sang UTC để tính toán
        // Sử dụng concat '+07:00' để ép parse theo múi giờ VN, bất kể múi giờ server
        const checkInDate = data.checkInTime ? new Date(data.checkInTime + ':00+07:00') : null;
        const checkOutDate = data.checkOutTime ? new Date(data.checkOutTime + ':00+07:00') : null;

        if (shift) {
            const [startH, startM] = shift.startTime.split(':').map(Number);
            const shiftStartTime = new Date(targetDate.getTime() + (startH - 7) * 3600000 + startM * 60000);

            if (checkInDate) {
                const diffIn = Math.floor((checkInDate.getTime() - shiftStartTime.getTime()) / 60000);
                if (diffIn > shift.lateSeriousThreshold) {
                    checkInStatus = 'LATE_SERIOUS';
                    lateMinutes = diffIn;
                } else if (diffIn > shift.lateThreshold) {
                    checkInStatus = 'LATE';
                    lateMinutes = diffIn;
                }
            }

            if (checkOutDate) {
                const [endH, endM] = shift.endTime.split(':').map(Number);
                const shiftEndTime = new Date(targetDate.getTime() + (endH - 7) * 3600000 + endM * 60000);

                const diffOut = Math.floor((checkOutDate.getTime() - shiftEndTime.getTime()) / 60000);
                if (diffOut < -shift.earlyLeaveThreshold) {
                    checkOutStatus = 'EARLY_LEAVE';
                    earlyLeaveMinutes = Math.abs(diffOut);
                } else if (diffOut >= 30) {
                    checkOutStatus = 'OVERTIME';
                    overtimeMinutes = diffOut;
                }
            }
        }

        if (checkInDate && checkOutDate) {
            totalWorkMinutes = Math.floor((checkOutDate.getTime() - checkInDate.getTime()) / 60000);
        }

        const dailyStatus = (checkInStatus.startsWith('LATE') || checkOutStatus === 'EARLY_LEAVE') ? 'INCOMPLETE' : 'FULL_DAY';

        if (!attendance) {
            return this.prisma.attendance.create({
                data: {
                    employeeId: data.employeeId,
                    branchId: employee.branchId,
                    date: targetDate,
                    shiftId: shift?.id,
                    checkInTime: checkInDate,
                    checkInStatus,
                    checkInMethod: 'MANUAL',
                    lateMinutes,
                    checkOutTime: checkOutDate,
                    checkOutStatus,
                    checkOutMethod: 'MANUAL',
                    earlyLeaveMinutes,
                    overtimeMinutes,
                    totalWorkMinutes,
                    dailyStatus,
                    note: `[Đã hiệu chỉnh] ${data.note || ''}`,
                }
            });
        } else {
            return this.prisma.attendance.update({
                where: { id: attendance.id },
                data: {
                    checkInTime: checkInDate,
                    checkInStatus,
                    checkInMethod: 'MANUAL',
                    lateMinutes,
                    checkOutTime: checkOutDate,
                    checkOutStatus,
                    checkOutMethod: 'MANUAL',
                    earlyLeaveMinutes,
                    overtimeMinutes,
                    totalWorkMinutes,
                    dailyStatus,
                    note: `${attendance.note || ''} | [Đã hiệu chỉnh] ${data.note || ''}`,
                }
            });
        }
    }
}
