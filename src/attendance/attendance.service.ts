import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CheckInDto, CheckOutDto } from './dto/attendance.dto';
import { AttendanceCalculatorService, AttendanceConfig } from './attendance-calculator.service';

@Injectable()
export class AttendanceService {
    constructor(
        private prisma: PrismaService,
        private calculator: AttendanceCalculatorService,
    ) { }

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

    // Helper: Kiểm tra xem nhân viên có đơn nghỉ phép (Đột xuất hoặc Cố định) được duyệt cho ngày này không
    private async getApprovedLeave(employeeId: string, date: Date) {
        // Lấy thứ trong tuần (0: CN, 1: T2, ...)
        const dayOfWeek = date.getUTCDay();

        // Tìm đơn nghỉ Đột xuất bao phủ ngày này
        const oneOffLeave = await this.prisma.leaveRequest.findFirst({
            where: {
                employeeId,
                status: 'APPROVED',
                isRecurring: false,
                startDate: { lte: date },
                endDate: { gte: date },
            }
        });

        if (oneOffLeave) return oneOffLeave;

        // Tìm đơn nghỉ Cố định có hiệu lực (ngày bắt đầu <= ngày hiện tại) và có thứ lặp lại khớp
        const recurringLeave = await this.prisma.leaveRequest.findFirst({
            where: {
                employeeId,
                status: 'APPROVED',
                isRecurring: true,
                startDate: { lte: date },
                recurringDays: { has: dayOfWeek }
            }
        });

        return recurringLeave;
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
        const configData = (policy as any)?.configData as AttendanceConfig | null;
        
        // 1. Kiểm tra Ngày nghỉ: Chỉ chặn nếu không có cấu hình OT và không dùng Engine mới
        if (policyDay?.isOff && !configData?.overtime_rules?.is_allowed) {
            throw new BadRequestException('Hôm nay là ngày nghỉ theo quy định của bạn');
        }

        // 2. Tự động đóng các ca quên checkout của ngày hôm trước (Auto-Reset)
        await this.prisma.attendance.updateMany({
            where: {
                employeeId,
                date: { lt: today },
                checkOutTime: null
            },
            data: {
                checkOutStatus: 'MISSING_OUT',
                dailyStatus: 'INVALID'
            }
        });

        // 3. Kiểm tra GPS (nối kết hợp chính sách tổng quát và cài đặt từng ngày)
        const requiresGPS = policyDay 
            ? (policyDay as any).requireGPS 
            : ((policy as any)?.requireGPS ?? true);
        
        // Xác định tọa độ và bán kính mục tiêu
        // Nếu chính sách KHÔNG có tọa độ -> Dùng của chi nhánh (bao gồm cả bán kính)
        // Nếu chính sách CÓ tọa độ -> Dùng của chính sách (bao gồm cả bán kính)
        const targetLat = policy?.latitude || employee.branch.latitude;
        const targetLon = policy?.longitude || employee.branch.longitude;
        const targetRadius = (policy?.latitude && policy?.longitude) 
            ? (policy?.radius ?? 200) 
            : employee.branch.checkinRadius;

        let distance = 0;
        let isWithinRange = true;

        if (requiresGPS) {
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

        // 🚀 NEW ENGINE: Nếu policy có configData -> dùng Engine mới


        if (configData) {
            // Dùng Engine mới để tính check-in status
            attendancePolicyDayId = policyDay?.id;
            const engineResult = this.calculator.evaluateCheckIn(configData, now);
            checkInStatus = engineResult.checkInStatus;
            lateMinutes = engineResult.lateMinutes;
        } else if (policyDay) {
            // LEGACY: Giữ nguyên logic cũ khi chưa có configData
            attendancePolicyDayId = policyDay.id;

            if (policyDay.isFlexible) {
                checkInStatus = 'ON_TIME';
                lateMinutes = 0;
            } else {
                const [startH, startM] = policyDay.startTime.split(':').map(Number);
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
        // Lấy thông tin chính sách để kiểm tra requireGPS tổng quát
        const policyInfo = await this.getPolicyForDayExplicit(employeeId, vnDayOfWeek);
        const policy = policyInfo?.policy;

        const policyDay = attendance.policyDay || (policyInfo?.day as any);
        const requiresGPS = policyDay 
            ? policyDay.requireGPS 
            : ((policy as any)?.requireGPS ?? true);

        // Xác định tọa độ và bán kính mục tiêu (giống logic check-in)
        const targetLat = policy?.latitude || attendance.employee.branch.latitude;
        const targetLon = policy?.longitude || attendance.employee.branch.longitude;
        const targetRadius = (policy?.latitude && policy?.longitude) 
            ? (policy?.radius ?? 200) 
            : attendance.employee.branch.checkinRadius;

        let distance = 0;
        let isWithinRange = true;

        if (requiresGPS) {
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
        let totalWorkMinutes = 0;
        let dailyStatus = attendance.dailyStatus || 'FULL_DAY';
        let workCount: number | undefined = undefined;

        // 🚀 NEW ENGINE: Nếu policy có configData -> dùng Engine mới
        const configData = (policy as any)?.configData as AttendanceConfig | null;

        if (configData && attendance.checkInTime) {
            // Dùng Engine mới để tính checkout + OT + tổng giờ làm + số công
            const engineResult = this.calculator.evaluateAttendance(
                configData,
                attendance.checkInTime,
                now,
            );
            checkOutStatus = engineResult.checkOutStatus;
            earlyLeaveMinutes = engineResult.earlyLeaveMinutes;
            overtimeMinutes = engineResult.overtimeMinutes;
            totalWorkMinutes = engineResult.totalWorkMinutes;
            dailyStatus = engineResult.dailyStatus;
            workCount = engineResult.workCount;
        } else if (attendance.policyDay && attendance.checkInTime) {
            // ... (legacy logic) ...
            totalWorkMinutes = Math.floor((now.getTime() - attendance.checkInTime.getTime()) / 60000);
            dailyStatus = ((attendance.checkInStatus?.startsWith('LATE')) || checkOutStatus === 'EARLY_LEAVE') ? 'LATE_DAY' : 'FULL_DAY';
            workCount = 1.0;
        } else if (attendance.shift && attendance.checkInTime) {
            // ... (legacy logic) ...
            totalWorkMinutes = Math.floor((now.getTime() - attendance.checkInTime.getTime()) / 60000);
            dailyStatus = ((attendance.checkInStatus?.startsWith('LATE')) || checkOutStatus === 'EARLY_LEAVE') ? 'LATE_DAY' : 'FULL_DAY';
            workCount = 1.0;
        }

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
                dailyStatus,
                workCount,
                note: attendance.note ? `${attendance.note} | ${dto.note}` : dto.note,
            }
        });
    }

    // Lấy bảng công tháng
    async getMonthlyTimesheet(employeeId: string, month: number, year: number) {
        const startDate = new Date(Date.UTC(year, month - 1, 1));
        const endDate = new Date(Date.UTC(year, month, 0));

        const attendances = await this.prisma.attendance.findMany({
            where: {
                employeeId,
                date: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            orderBy: { date: 'asc' },
            include: { 
                shift: true,
                exceptionRequests: {
                    where: { status: 'PENDING' },
                    select: { id: true, type: true, status: true }
                }
            },
        });

        // Xác định ngày cuối cùng cần hiển thị (nếu là tháng hiện tại thì chỉ hiện đến hôm nay)
        const now = new Date();
        const nowUTC = new Date(now.getTime() + 7 * 3600000); // Giả sử giờ VN
        const isCurrentMonth = now.getUTCFullYear() === year && (now.getUTCMonth() + 1) === month;
        const isFutureMonth = (year > now.getUTCFullYear()) || (year === now.getUTCFullYear() && month > (now.getUTCMonth() + 1));
        
        const lastDayOfMonth = endDate.getUTCDate();
        let lastDayToShow = lastDayOfMonth;
        
        if (isCurrentMonth) {
            lastDayToShow = now.getDate(); // Lấy ngày hiện tại
        } else if (isFutureMonth) {
            lastDayToShow = 0; // Không hiện ngày nào cho tháng tương lai
        }

        const fullTimesheet = [];
        
        for (let day = 1; day <= lastDayToShow; day++) {
            const currentDate = new Date(Date.UTC(year, month - 1, day));
            // Tìm bản ghi chấm công cho ngày này
            const existingRecord = attendances.find(a => {
                const d = new Date(a.date);
                return d.getUTCDate() === day;
            });

            // Kiểm tra xem có đơn nghỉ phép được duyệt không
            const approvedLeave = await this.getApprovedLeave(employeeId, currentDate);

            if (existingRecord) {
                // Nếu đã có record điểm danh nhưng là vắng mặt, hoặc thiếu giờ (mà có đơn nghỉ)
                // Cập nhật thông tin nghỉ phép vào record (đặc biệt cho đơn nghỉ cố định)
                if ((!existingRecord.checkInTime || existingRecord.dailyStatus === 'ABSENT_UNAPPROVED') && approvedLeave) {
                    existingRecord.dailyStatus = 'ABSENT_APPROVED';
                    existingRecord.workCount = (approvedLeave.leaveSession === 'ALL_DAY' ? 0 : 0.5) as any;
                    existingRecord.note = existingRecord.note ? `${existingRecord.note} | Xin nghỉ (${approvedLeave.leaveType})` : `Xin nghỉ (${approvedLeave.leaveType})`;
                }
                fullTimesheet.push(existingRecord);
            } else {
                // Kiểm tra xem có đơn nghỉ phép được duyệt không
                const approvedLeave = await this.getApprovedLeave(employeeId, currentDate);
                
                // Tạo bản ghi giả nếu chưa có chấm công
                fullTimesheet.push({
                    id: `temp-${day}`,
                    date: currentDate,
                    employeeId,
                    checkInTime: null,
                    checkOutTime: null,
                    totalWorkMinutes: 0,
                    lateMinutes: 0,
                    earlyLeaveMinutes: 0,
                    overtimeMinutes: 0,
                    dailyStatus: approvedLeave ? 'ABSENT_APPROVED' : 'ABSENT_UNAPPROVED',
                    workCount: approvedLeave ? (approvedLeave.leaveSession === 'ALL_DAY' ? 0 : 0.5) : 0,
                    checkInStatus: null,
                    checkOutStatus: null,
                    note: approvedLeave ? `Xin nghỉ (${approvedLeave.leaveType})` : null,
                    exceptionRequests: []
                });
            }
        }

        return fullTimesheet;
    }

    // Lấy bảng tổng hợp công
    async getMonthlySummary(month: number, year: number, branchId?: string, search?: string, position?: string) {
        const startDate = new Date(Date.UTC(year, month - 1, 1));
        const endDate = new Date(Date.UTC(year, month, 0));

        const employees = await (this.prisma.employee.findMany as any)({
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
                pos: { 
                    select: { 
                        name: true,
                        baseSalary: true,
                        diligentSalary: true,
                        lunchAllowance: true,
                        lunchAllowanceType: true,
                        travelAllowance: true,
                        technicalAllowance: true,
                        allowance: true,
                        standardWorkingDays: true
                    } 
                },
                avatarUrl: true,
                branch: { select: { name: true } },
                customBaseSalary: true,
                customDiligentSalary: true,
                customLunchAllowance: true,
                customLunchAllowanceType: true,
                customTravelAllowance: true,
                customTechnicalAllowance: true,
                customAllowance: true,
                customStandardWorkingDays: true,
                position: true
            } as any,
            orderBy: { fullName: 'asc' }
        });

        const employeeIds = employees.map((e: any) => e.id);

        const attendanceRecords = await this.prisma.attendance.findMany({
            where: {
                employeeId: { in: employeeIds },
                date: {
                    gte: startDate,
                    lte: endDate,
                },
            }
        });

        const summary = employees.map((emp: any) => {
            const empAttendance = attendanceRecords.filter((a: any) => a.employeeId === emp.id);

            const totalWorkCount = empAttendance.reduce((acc: number, a: any) => acc + (Number(a.workCount) || 0), 0);
            const fullDays = empAttendance.filter((a: any) => Number(a.workCount) >= 1.0).length;
            const halfDaysCount = empAttendance.filter((a: any) => Number(a.workCount) > 0 && Number(a.workCount) < 1.0).length;
            const halfDaysTotal = empAttendance.filter((a: any) => Number(a.workCount) > 0 && Number(a.workCount) < 1.0).reduce((acc: number, a: any) => acc + (Number(a.workCount) || 0), 0);
            const lateDays = empAttendance.filter((a: any) => a.checkInStatus === 'LATE' || a.checkInStatus === 'LATE_SERIOUS').length;
            const earlyLeaveDays = empAttendance.filter((a: any) => a.checkOutStatus === 'EARLY_LEAVE').length;
            const absentDaysCount = empAttendance.filter((a: any) => {
                const isAbsent = (a as any).dailyStatus?.startsWith('ABSENT');
                const isSunday = new Date(a.date).getUTCDay() === 0;
                return isAbsent && !isSunday;
            }).length;
            const totalOvertimeMinutes = empAttendance.reduce((acc: number, a: any) => acc + (a.overtimeMinutes || 0), 0);

            const e = emp as any;
            const lunchType = e.customLunchAllowanceType ?? e.pos?.lunchAllowanceType ?? 'DAILY';
            const lunchRate = Number(e.customLunchAllowance ?? e.pos?.lunchAllowance ?? 0);
            const travelAllowance = Number(e.customTravelAllowance ?? e.pos?.travelAllowance ?? 0);
            const technicalAllowance = Number(e.customTechnicalAllowance ?? e.pos?.technicalAllowance ?? 0);
            const otherAllowance = Number(e.customAllowance ?? e.pos?.allowance ?? 0);

            const lunchAllowance = (lunchType === 'DAILY') ? lunchRate * fullDays : lunchRate;

            return {
                employeeId: e.id,
                fullName: e.fullName,
                phone: e.phone,
                avatarUrl: e.avatarUrl,
                branchName: e.branch?.name || '---',
                position: e.position || e.pos?.name || '---',
                totalWorkCount,
                fullDays,
                halfDaysCount,
                halfDaysTotal,
                lateDays,
                earlyLeaveDays,
                absentDaysCount,
                totalOvertimeHours: (totalOvertimeMinutes / 60).toFixed(1),
                // New fields for overview tab
                lunchAllowance,
                travelAllowance,
                technicalAllowance,
                otherAllowance,
                totalAllowance: lunchAllowance + travelAllowance + technicalAllowance + otherAllowance
            };
        });

        return summary;
    }

    // Lấy bảng công ngày (cho tab Công hôm nay)
    async getDailyAttendance(date: Date, branchId?: string, search?: string, position?: string) {
        // Chuẩn hóa về 00:00:00 UTC của ngày đó
        const targetDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

        const employees = await this.prisma.employee.findMany({
            where: {
                status: { not: 'Nghỉ việc' },
                ...(branchId ? { branchId } : {}),
                ...(position ? { position } : {}),
                ...(search ? {
                    OR: [
                        { fullName: { contains: search, mode: 'insensitive' } },
                        { phone: { contains: search, mode: 'insensitive' } }
                    ]
                } : {})
            },
            include: {
                branch: { select: { name: true } },
                pos: { select: { name: true } }
            },
            orderBy: { fullName: 'asc' }
        });

        const attendanceRecords = await this.prisma.attendance.findMany({
            where: {
                date: targetDate,
                employeeId: { in: employees.map(e => e.id) }
            },
            include: {
                shift: true,
                exceptionRequests: {
                    where: { status: 'PENDING' },
                    select: { id: true, type: true, status: true }
                }
            }
        });

        const results = [];
        for (const emp of employees) {
            const record = attendanceRecords.find(a => a.employeeId === emp.id);
            // Kiểm tra nghỉ phép cho placeholder hoặc record vắng mặt
            const approvedLeave = await this.getApprovedLeave(emp.id, targetDate);

            if (record) {
                if ((!record.checkInTime || record.dailyStatus === 'ABSENT_UNAPPROVED') && approvedLeave) {
                    record.dailyStatus = 'ABSENT_APPROVED';
                    record.workCount = (approvedLeave.leaveSession === 'ALL_DAY' ? 0 : 0.5) as any;
                    record.note = record.note ? `${record.note} | Xin nghỉ (${approvedLeave.leaveType})` : `Xin nghỉ (${approvedLeave.leaveType})`;
                }
                results.push({ ...record, employee: emp });
                continue;
            }

            // Nếu chưa có, trả về placeholder
            results.push({
                id: `today-${emp.id}`,
                date: targetDate,
                employeeId: emp.id,
                employee: emp,
                checkInTime: null,
                checkOutTime: null,
                totalWorkMinutes: 0,
                lateMinutes: 0,
                earlyLeaveMinutes: 0,
                overtimeMinutes: 0,
                dailyStatus: approvedLeave ? 'ABSENT_APPROVED' : 'ABSENT_UNAPPROVED',
                workCount: approvedLeave ? (approvedLeave.leaveSession === 'ALL_DAY' ? 0 : 0.5) : 0,
                checkInStatus: null,
                checkOutStatus: null,
                note: approvedLeave ? `Xin nghỉ (${approvedLeave.leaveType})` : null,
                exceptionRequests: []
            });
        }
        return results;
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
        changedById: string; // ID của người thực hiện chỉnh sửa
    }) {
        console.log('[AdjustAttendance] Input data:', JSON.stringify(data, null, 2));
        try {
            // 1. Xác định targetDate (00:00:00 UTC của ngày local VN)
            const dateObj = new Date(data.date);
            if (isNaN(dateObj.getTime())) {
                throw new BadRequestException('Ngày hiệu chỉnh không hợp lệ');
            }
            const dateVN = new Date(dateObj.getTime() + 7 * 3600000);
            const targetDate = new Date(Date.UTC(dateVN.getUTCFullYear(), dateVN.getUTCMonth(), dateVN.getUTCDate()));
            const vnDayOfWeek = dateVN.getUTCDay();

            console.log(`[AdjustAttendance] TargetDate: ${targetDate.toISOString()}, DayOfWeek: ${vnDayOfWeek}`);

            const employee = await this.prisma.employee.findUnique({
                where: { id: data.employeeId },
                include: { branch: true }
            });

            if (!employee) throw new NotFoundException('Không tìm thấy nhân viên');

            // Fetch Policy
            const policyInfo = await this.getPolicyForDayExplicit(data.employeeId, vnDayOfWeek);
            const policy = policyInfo?.policy;
            const policyDay = policyInfo?.day;
            const configData = (policy as any)?.configData as AttendanceConfig | null;

            let attendance = await this.prisma.attendance.findUnique({
                where: { employeeId_date: { employeeId: data.employeeId, date: targetDate } },
                include: { shift: true }
            });

            // Parse Inputs
            const checkInDate = data.checkInTime ? new Date(data.checkInTime + ':00+07:00') : null;
            const checkOutDate = data.checkOutTime ? new Date(data.checkOutTime + ':00+07:00') : null;

            if (checkInDate && isNaN(checkInDate.getTime())) {
                throw new BadRequestException('Giờ vào không hợp lệ');
            }
            if (checkOutDate && isNaN(checkOutDate.getTime())) {
                throw new BadRequestException('Giờ ra không hợp lệ');
            }

            console.log(`[AdjustAttendance] Parsed checkIn: ${checkInDate?.toISOString()}, checkOut: ${checkOutDate?.toISOString()}`);

            let lateMinutes = 0;
            let earlyLeaveMinutes = 0;
            let overtimeMinutes = 0;
            let checkInStatus = 'ON_TIME';
            let checkOutStatus = 'ON_TIME';
            let totalWorkMinutes = 0;
            let dailyStatus = 'FULL_DAY';
            let workCount: number | undefined = undefined;

            // 🚀 CALCULATION ENGINE
            if (configData) {
                console.log('[AdjustAttendance] Using configData Engine');
                if (checkInDate && checkOutDate) {
                    const engineResult = this.calculator.evaluateAttendance(configData, checkInDate, checkOutDate);
                    checkInStatus = engineResult.checkInStatus;
                    checkOutStatus = engineResult.checkOutStatus;
                    lateMinutes = engineResult.lateMinutes;
                    earlyLeaveMinutes = engineResult.earlyLeaveMinutes;
                    overtimeMinutes = engineResult.overtimeMinutes;
                    totalWorkMinutes = engineResult.totalWorkMinutes;
                    dailyStatus = engineResult.dailyStatus;
                    workCount = engineResult.workCount;
                } else if (checkInDate) {
                    const engineResult = this.calculator.evaluateCheckIn(configData, checkInDate);
                    checkInStatus = engineResult.checkInStatus;
                    lateMinutes = engineResult.lateMinutes;
                    checkOutStatus = 'MISSING_OUT';
                    dailyStatus = 'INCOMPLETE';
                    workCount = 0;
                } else if (checkOutDate) {
                    checkInStatus = 'MISSING_IN';
                    checkOutStatus = 'ON_TIME';
                    dailyStatus = 'INCOMPLETE';
                    workCount = 0;
                } else {
                    checkInStatus = 'ABSENT_UNAPPROVED';
                    checkOutStatus = 'ABSENT_UNAPPROVED';
                    dailyStatus = 'ABSENT_UNAPPROVED';
                    workCount = 0;
                }
            } else {
                console.log('[AdjustAttendance] Falling back to Legacy/WorkShift');
                let shift = attendance?.shift;
                if (!shift) {
                    shift = await this.prisma.workShift.findFirst({
                        where: { branchId: employee.branchId, isActive: true },
                    });
                }

                if (shift) {
                    const [startH, startM] = shift.startTime.split(':').map(Number);
                    const shiftStartTime = new Date(targetDate.getTime() + (startH - 7) * 3600000 + startM * 60000);
                    const [endH, endM] = shift.endTime.split(':').map(Number);
                    const shiftEndTime = new Date(targetDate.getTime() + (endH - 7) * 3600000 + endM * 60000);

                    if (checkInDate) {
                        const diffIn = Math.floor((checkInDate.getTime() - shiftStartTime.getTime()) / 60000);
                        if (diffIn > shift.lateSeriousThreshold) {
                            checkInStatus = 'LATE_SERIOUS';
                            lateMinutes = diffIn;
                        } else if (diffIn > shift.lateThreshold) {
                            checkInStatus = 'LATE';
                            lateMinutes = diffIn;
                        }
                    } else {
                        checkInStatus = 'MISSING_IN';
                    }

                    if (checkOutDate) {
                        const diffOut = Math.floor((checkOutDate.getTime() - shiftEndTime.getTime()) / 60000);
                        if (diffOut < -shift.earlyLeaveThreshold) {
                            checkOutStatus = 'EARLY_LEAVE';
                            earlyLeaveMinutes = Math.abs(diffOut);
                        } else if (diffOut >= 30) {
                            checkOutStatus = 'OVERTIME';
                            overtimeMinutes = diffOut;
                        }
                    } else {
                        checkOutStatus = 'MISSING_OUT';
                    }
                }

                if (checkInDate && checkOutDate) {
                    totalWorkMinutes = Math.floor((checkOutDate.getTime() - checkInDate.getTime()) / 60000);
                    const isTooLate = lateMinutes > 30;
                    const isTooEarly = earlyLeaveMinutes > 30;
                    dailyStatus = (isTooLate || isTooEarly) ? 'INCOMPLETE' : 'FULL_DAY';
                    workCount = (isTooLate || isTooEarly) ? 0.5 : 1.0;
                } else if (!checkInDate && !checkOutDate) {
                    dailyStatus = 'ABSENT_UNAPPROVED';
                    workCount = 0;
                } else {
                    dailyStatus = 'INCOMPLETE';
                    workCount = 0;
                }
            }

            console.log(`[AdjustAttendance] Calculated: ${dailyStatus}, workCount: ${workCount}, late: ${lateMinutes}, early: ${earlyLeaveMinutes}, OT: ${overtimeMinutes}`);

            const auditData = {
                old: attendance ? {
                    checkInTime: attendance.checkInTime,
                    checkInStatus: attendance.checkInStatus,
                    checkOutTime: attendance.checkOutTime,
                    checkOutStatus: attendance.checkOutStatus,
                    lateMinutes: attendance.lateMinutes,
                    earlyLeaveMinutes: attendance.earlyLeaveMinutes,
                    dailyStatus: attendance.dailyStatus,
                    note: attendance.note
                } : null,
                new: {
                    checkInTime: checkInDate,
                    checkInStatus,
                    checkOutTime: checkOutDate,
                    checkOutStatus,
                    lateMinutes,
                    earlyLeaveMinutes,
                    dailyStatus,
                    note: data.note
                }
            };

            const result = await this.prisma.$transaction(async (tx) => {
                let updatedAttendance;
                const commonData = {
                    checkInTime: checkInDate,
                    checkInStatus,
                    checkInMethod: 'MANUAL',
                    lateMinutes: isNaN(lateMinutes) ? 0 : lateMinutes,
                    checkOutTime: checkOutDate,
                    checkOutStatus,
                    checkOutMethod: 'MANUAL',
                    earlyLeaveMinutes: isNaN(earlyLeaveMinutes) ? 0 : earlyLeaveMinutes,
                    overtimeMinutes: isNaN(overtimeMinutes) ? 0 : overtimeMinutes,
                    totalWorkMinutes: isNaN(totalWorkMinutes) ? 0 : totalWorkMinutes,
                    dailyStatus,
                    workCount: (workCount === undefined || isNaN(workCount)) ? 1.0 : workCount,
                    isManualOverride: true,
                    approvedById: data.changedById,
                    attendancePolicyDayId: policyDay?.id,
                };

                console.log('[AdjustAttendance] Updating/Creating record with commonData:', JSON.stringify(commonData, null, 2));

                if (!attendance) {
                    updatedAttendance = await tx.attendance.create({
                        data: {
                            employeeId: data.employeeId,
                            branchId: employee.branchId,
                            date: targetDate,
                            ...commonData,
                            note: `[Đã hiệu chỉnh] ${data.note || ''}`,
                        }
                    });
                } else {
                    updatedAttendance = await tx.attendance.update({
                        where: { id: attendance.id },
                        data: {
                            ...commonData,
                            note: `${attendance.note || ''} | [Đã hiệu chỉnh] ${data.note || ''}`,
                        }
                    });
                }

                console.log('[AdjustAttendance] Record updated, id:', updatedAttendance.id);

                // Ghi log chỉnh sửa
                const auditLogModel = (tx as any).attendanceAuditLog;
                if (!auditLogModel) {
                     console.error('[AdjustAttendance] CRITICAL ERROR: tx.attendanceAuditLog NOT FOUND');
                     throw new Error('Hệ thống chưa đồng bộ Prisma client, vui lòng liên hệ kỹ thuật.');
                }

                await auditLogModel.create({
                    data: {
                        attendanceId: updatedAttendance.id,
                        changedBy: data.changedById,
                        action: 'MANUAL_ADJUST',
                        oldData: auditData.old as any,
                        newData: auditData.new as any,
                        reason: data.note || 'Hiệu chỉnh chấm công thủ công',
                    }
                });

                console.log('[AdjustAttendance] Audit log created successfully');
                return updatedAttendance;
            });

            return result;
        } catch (error) {
            console.error('[AdjustAttendance] Error:', error);
            // Re-throw if it's already a Nest exception, otherwise wrap as BadRequest
            if (error instanceof BadRequestException || error instanceof NotFoundException) {
                throw error;
            }
            throw new BadRequestException('Lỗi hệ thống khi hiệu chỉnh công: ' + error.message);
        }
    }


    async getAuditLogs(attendanceId: string) {
        return (this.prisma as any).attendanceAuditLog.findMany({
            where: { attendanceId },
            include: {
                user: {
                    select: {
                        username: true,
                        employee: { select: { fullName: true } }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    async getAllAuditLogs(month?: number, year?: number, branchId?: string, search?: string) {
        let dateFilter = {};
        if (month && year) {
            const startDate = new Date(Date.UTC(year, month - 1, 1));
            const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
            dateFilter = {
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                }
            };
        }

        let employeeFilter = {};
        if (branchId || search) {
            employeeFilter = {
                attendance: {
                    employee: {
                        ...(branchId ? { branchId } : {}),
                        ...(search ? {
                            OR: [
                                { fullName: { contains: search, mode: 'insensitive' } },
                                { phone: { contains: search, mode: 'insensitive' } }
                            ]
                        } : {})
                    }
                }
            };
        }

        return (this.prisma as any).attendanceAuditLog.findMany({
            where: {
                ...dateFilter,
                ...employeeFilter
            },
            include: {
                user: {
                    select: {
                        username: true,
                        employee: { select: { fullName: true } }
                    }
                },
                attendance: {
                    include: {
                        employee: {
                            select: {
                                id: true,
                                fullName: true,
                                branch: { select: { name: true } }
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    // Xuất file Excel Bảng công
    async exportTimesheet(month: number, year: number, branchId?: string, search?: string, position?: string) {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        
        // --- ĐỊNH NGHĨA STYLE CHUNG ---
        const colors = {
            primary: 'FF1F4E78', // Xanh Navy đậm chuyên nghiệp
            secondary: 'FFE0E7FF',
            headerText: 'FFFFFFFF',
            border: 'FFD1D5DB',
            zebra: 'FFF9FAFB',
        };

        const headerStyle = {
            font: { bold: true, color: { argb: colors.headerText }, size: 11 },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.primary } },
            alignment: { vertical: 'middle', horizontal: 'center' },
            border: {
                top: { style: 'thin', color: { argb: colors.border } },
                left: { style: 'thin', color: { argb: colors.border } },
                bottom: { style: 'thin', color: { argb: colors.border } },
                right: { style: 'thin', color: { argb: colors.border } }
            }
        };

        const cellStyle = {
            border: {
                top: { style: 'thin', color: { argb: colors.border } },
                left: { style: 'thin', color: { argb: colors.border } },
                bottom: { style: 'thin', color: { argb: colors.border } },
                right: { style: 'thin', color: { argb: colors.border } }
            },
            alignment: { vertical: 'middle' }
        };

        // --- SHEET 2: CHI TIẾT (LÀM NGUỒN DỮ LIỆU) ---
        const detailSheet = workbook.addWorksheet('Chi_tiet');
        detailSheet.columns = [
            { header: 'STT', key: 'stt', width: 5 },
            { header: 'Nhân viên', key: 'fullName', width: 25 },
            { header: 'Ngày', key: 'date', width: 12 },
            { header: 'Thứ', key: 'dayOfWeek', width: 8 },
            { header: 'Giờ vào', key: 'checkInTime', width: 10 },
            { header: 'Giờ ra', key: 'checkOutTime', width: 10 },
            { header: 'Trạng thái vào', key: 'checkInStatus', width: 15 },
            { header: 'Trạng thái ra', key: 'checkOutStatus', width: 15 },
            { header: 'Trạng thái ngày', key: 'dailyStatus', width: 18 },
            { header: 'Muộn (phút)', key: 'lateMinutes', width: 12 },
            { header: 'Sớm (phút)', key: 'earlyLeaveMinutes', width: 12 },
            { header: 'TC (phút)', key: 'overtimeMinutes', width: 12 },
            { header: 'Phút làm', key: 'totalWorkMinutes', width: 12 },
            { header: 'Số công', key: 'workCount', width: 10 },
        ];

        // Header Style cho Sheet Chi tiết
        detailSheet.getRow(1).eachCell((cell: any) => {
            cell.style = headerStyle as any;
        });

        const summaryData = await (this.getMonthlySummary(month, year, branchId, search, position) as any);
        const employeeIds = summaryData.map((s: any) => s.employeeId);
        const startDate = new Date(Date.UTC(year, month - 1, 1));
        const endDate = new Date(Date.UTC(year, month, 0));

        const attendanceRecords = await this.prisma.attendance.findMany({
            where: {
                employeeId: { in: employeeIds },
                date: { gte: startDate, lte: endDate },
            },
            include: { employee: true }
        });

        const formatDate = (date: Date | null | undefined) => {
            if (!date) return '';
            const d = new Date(date);
            return `${d.getUTCDate().toString().padStart(2, '0')}/${(d.getUTCMonth() + 1).toString().padStart(2, '0')}/${d.getUTCFullYear()}`;
        };

        const getVNTime = (date: Date | null | undefined) => {
             if (!date) return null;
             return new Date(new Date(date).getTime() + 7 * 3600000);
        };

        const formatTime = (date: Date | null | undefined) => {
            const dVN = getVNTime(date);
            if (!dVN) return '';
            return `${dVN.getUTCHours().toString().padStart(2, '0')}:${dVN.getUTCMinutes().toString().padStart(2, '0')}`;
        };

        const getDayName = (date: Date) => {
            const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
            return days[date.getUTCDay()];
        };

        const translateStatus = (status: string | null) => {
            if (!status) return '';
            switch (status) {
                case 'ON_TIME': return 'Đúng giờ';
                case 'LATE': return 'Vào muộn';
                case 'LATE_SERIOUS': return 'Muộn nghiêm trọng';
                case 'MISSING_IN': return 'Quên Check-in';
                case 'MISSING_OUT': return 'Quên Check-out';
                case 'EARLY_LEAVE': return 'Về sớm';
                case 'OVERTIME': return 'Tăng ca';
                case 'FULL_DAY': return 'Cả ngày';
                case 'HALF_DAY_MORNING': return 'Ca sáng';
                case 'HALF_DAY_AFTERNOON': return 'Ca chiều';
                case 'LATE_DAY': return 'Ngày đi muộn';
                case 'ABSENT_APPROVED': return 'Vắng có phép';
                case 'ABSENT_UNAPPROVED': return 'Vắng không phép';
                case 'INVALID': return 'Không hợp lệ';
                case 'INCOMPLETE': return 'Công dở dang';
                default: return status;
            }
        };

        const now = new Date();
        const nowUTC = new Date(now.getTime() + 7 * 3600000); // Giờ VN
        const isCurrentMonth = nowUTC.getUTCFullYear() === year && (nowUTC.getUTCMonth() + 1) === month;
        const isFutureMonth = (year > nowUTC.getUTCFullYear()) || (year === nowUTC.getUTCFullYear() && month > (nowUTC.getUTCMonth() + 1));
        
        let lastDayToShow = endDate.getUTCDate();
        if (isCurrentMonth) lastDayToShow = nowUTC.getUTCDate();
        else if (isFutureMonth) lastDayToShow = 0;

        let detailRowIndex = 2; // Bắt đầu từ dòng 2 (sau header)
        summaryData.forEach((emp: any) => {
            for (let day = 1; day <= lastDayToShow; day++) {
                const currentDate = new Date(Date.UTC(year, month - 1, day));
                const record = attendanceRecords.find(a => 
                    a.employeeId === emp.employeeId && 
                    new Date(a.date).getUTCDate() === day
                );

                const isSunday = currentDate.getUTCDay() === 0;
                const isSaturday = currentDate.getUTCDay() === 6;

                // Xử lý nhãn trạng thái ngày
                let displayDailyStatus = '';
                if (record) {
                    displayDailyStatus = translateStatus(record.dailyStatus);
                    // Nếu là Thứ 7 và làm công nửa ngày (hoặc về lúc 12h), ưu tiên hiển thị "Ca sáng"
                    if (isSaturday && (Number(record.workCount || 0) <= 0.5 || (record.checkOutTime && new Date(record.checkOutTime).getUTCHours() <= 5))) { // 5h UTC = 12h VN
                        if (record.dailyStatus === 'FULL_DAY' || record.dailyStatus === 'HALF_DAY_MORNING') {
                            displayDailyStatus = 'Ca sáng';
                        }
                    }
                } else {
                    displayDailyStatus = isSunday ? 'Nghỉ tuần' : translateStatus('ABSENT_UNAPPROVED');
                }

                const row = detailSheet.addRow({
                    stt: detailRowIndex - 1,
                    fullName: emp.fullName,
                    date: formatDate(currentDate),
                    dayOfWeek: getDayName(currentDate),
                    checkInTime: record ? formatTime(record.checkInTime) : '',
                    checkOutTime: record ? formatTime(record.checkOutTime) : '',
                    checkInStatus: record ? translateStatus(record.checkInStatus) : '',
                    checkOutStatus: record ? translateStatus(record.checkOutStatus) : '',
                    dailyStatus: displayDailyStatus,
                    lateMinutes: record ? record.lateMinutes || 0 : 0,
                    earlyLeaveMinutes: record ? record.earlyLeaveMinutes || 0 : 0,
                    overtimeMinutes: record ? record.overtimeMinutes || 0 : 0,
                    totalWorkMinutes: record ? record.totalWorkMinutes || 0 : 0,
                    workCount: record ? (Number(record.workCount) || 0) : 0,
                });

                // Style cho dòng dữ liệu
                row.eachCell((cell: any) => {
                    cell.style = cellStyle as any;
                    if (detailRowIndex % 2 === 0) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.zebra } };
                    }
                });
                detailRowIndex++;
            }
        });

        // --- SHEET 1: TỔNG QUAN (SỬ DỤNG CÔNG THỨC) ---
        const summarySheet = workbook.addWorksheet('Tong_quan');
        
        // Tiêu đề báo cáo
        summarySheet.mergeCells('A1:L1');
        summarySheet.getCell('A1').value = `BẢNG TỔNG HỢP CÔNG - THÁNG ${month}/${year}`;
        summarySheet.getCell('A1').font = { bold: true, size: 14, color: { argb: colors.primary } };
        summarySheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
        summarySheet.getRow(1).height = 30;

        summarySheet.getRow(3).values = [
            'STT', 'Nhân viên', 'Chi nhánh', 'Chức vụ', 
            'Tổng công', 'HC (1.0)', 'Công 1/2', 'Nghỉ', 
            'Muộn', 'Sớm', 'TC (H)', 'PC Ăn trưa',
            'PC Xăng xe', 'PC Kỹ thuật', 'PC Khác'
        ];

        summarySheet.columns = [
            { key: 'stt', width: 5 },
            { key: 'fullName', width: 25 },
            { key: 'branchName', width: 20 },
            { key: 'position', width: 15 },
            { key: 'totalWorkCount', width: 12 },
            { key: 'fullDays', width: 10 },
            { key: 'halfDaysCount', width: 10 },
            { key: 'absentDaysCount', width: 10 },
            { key: 'lateDays', width: 10 },
            { key: 'earlyLeaveDays', width: 10 },
            { key: 'totalOvertimeHours', width: 10 },
            { key: 'lunchAllowance', width: 15 },
            { key: 'travelAllowance', width: 15 },
            { key: 'technicalAllowance', width: 15 },
            { key: 'otherAllowance', width: 15 },
        ];

        // Header Style cho Sheet Tổng quan (Dòng 3)
        summarySheet.getRow(3).eachCell((cell: any) => {
            cell.style = headerStyle as any;
        });

        summaryData.forEach((emp: any, index: number) => {
            const rowIndex = index + 4; // Dữ liệu bắt đầu từ dòng 4
            const empNameCell = `$B${rowIndex}`;

            const row = summarySheet.addRow({
                stt: index + 1,
                fullName: emp.fullName,
                branchName: emp.branchName,
                position: emp.position,
                totalWorkCount: { formula: `SUMIF(Chi_tiet!$B:$B, ${empNameCell}, Chi_tiet!$N:$N)`, value: emp.totalWorkCount },
                fullDays: { formula: `COUNTIFS(Chi_tiet!$B:$B, ${empNameCell}, Chi_tiet!$N:$N, ">=1")`, value: emp.fullDays },
                halfDaysCount: { formula: `SUMIFS(Chi_tiet!$N:$N, Chi_tiet!$B:$B, ${empNameCell}, Chi_tiet!$N:$N, ">0", Chi_tiet!$N:$N, "<1")`, value: emp.halfDaysTotal },
                absentDaysCount: { formula: `COUNTIFS(Chi_tiet!$B:$B, ${empNameCell}, Chi_tiet!$I:$I, "*Vắng*")`, value: emp.absentDaysCount },
                lateDays: { formula: `COUNTIFS(Chi_tiet!$B:$B, ${empNameCell}, Chi_tiet!$G:$G, "*muộn*")`, value: emp.lateDays },
                earlyLeaveDays: { formula: `COUNTIFS(Chi_tiet!$B:$B, ${empNameCell}, Chi_tiet!$H:$H, "*sớm*")`, value: emp.earlyLeaveDays },
                totalOvertimeHours: { formula: `SUMIF(Chi_tiet!$B:$B, ${empNameCell}, Chi_tiet!$L:$L) / 60`, value: emp.totalOvertimeHours },
                lunchAllowance: emp.lunchAllowance,
                travelAllowance: emp.travelAllowance,
                technicalAllowance: emp.technicalAllowance,
                otherAllowance: emp.otherAllowance,
            });

            // Định dạng tiền tệ cho các cột Phụ cấp
            ['lunchAllowance', 'travelAllowance', 'technicalAllowance', 'otherAllowance'].forEach(key => {
                row.getCell(key).numFmt = '#,##0';
            });

            // Style cho dòng dữ liệu
            row.eachCell((cell: any) => {
                cell.style = cellStyle as any;
                if (rowIndex % 2 === 0) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.zebra } };
                }
            });
        });

        // Di chuyển Sheet Tổng quan lên đầu
        workbook.worksheets.reverse();

        // Generate buffer
        const buffer = await workbook.xlsx.writeBuffer();
        return buffer;
    }


    async getPendingCounts(employeeId?: string, branchId?: string, roleCode?: string) {
        const canViewOthers = ['ADMIN', 'DIRECTOR', 'MANAGER', 'CHIEF_ACCOUNTANT', 'HR'].includes(roleCode || '');

        const leaveWhere: any = { status: 'PENDING' };
        const exceptionWhere: any = { status: 'PENDING' };

        if (!canViewOthers && employeeId) {
            leaveWhere.employeeId = employeeId;
            exceptionWhere.employeeId = employeeId;
        } else if (roleCode === 'MANAGER' && branchId) {
            leaveWhere.employee = { branchId };
            exceptionWhere.employee = { branchId };
        }

        const [leaveCount, exceptionCount] = await Promise.all([
            this.prisma.leaveRequest.count({ where: leaveWhere }),
            this.prisma.attendanceExceptionRequest.count({ where: exceptionWhere }),
        ]);

        return {
            leaveCount,
            exceptionCount,
            totalCount: leaveCount + exceptionCount,
        };
    }

    async seedHeavyRevenue() {
        console.log('--- Bắt đầu quy trình Seed 500 tỷ doanh số ---');

        // 1. Dọn dẹp dữ liệu cũ (Xóa đơn hàng)
        // Xóa theo thứ tự ràng buộc để không bị lỗi ForeignKey
        await this.prisma.$transaction([
            this.prisma.orderGift.deleteMany(),
            this.prisma.orderItem.deleteMany(),
            this.prisma.orderSplit.deleteMany(),
            this.prisma.payment.deleteMany(),
            this.prisma.delivery.deleteMany(),
            this.prisma.orderAuditLog.deleteMany(),
            this.prisma.order.deleteMany(),
        ]);

        // 2. Lấy dữ liệu cơ sở
        const branches = await this.prisma.branch.findMany();
        const products = await this.prisma.product.findMany();
        const employees = await this.prisma.employee.findMany({
            include: { user: { include: { role: true } } }
        });
        const adminUser = await this.prisma.user.findFirst({ where: { role: { code: 'ADMIN' } } });

        if (!branches.length || !products.length || !employees.length || !adminUser) {
            throw new Error('Thiếu dữ liệu cơ sở (Chi nhánh, Sản phẩm, Nhân viên hoặc Admin) để seed.');
        }

        // Lọc nhân viên sale/manager để chia doanh số
        const salesStaff = employees.filter(e => 
            e.user?.role?.code && ['ADMIN', 'DIRECTOR', 'MANAGER', 'SALE', 'TELESALE'].includes(e.user.role.code)
        );

        if (!salesStaff.length) throw new Error('Không tìm thấy nhân viên Sale/Manager để gán doanh số.');

        // 3. Cấu hình sinh dữ liệu
        const TARGET_REVENUE = 500000000000;
        const DAYS_TO_SEED = 90;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - DAYS_TO_SEED);

        const hoList = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
        const demList = ['Văn', 'Thị', 'Hải', 'Minh', 'Thanh', 'Đức', 'Hữu', 'Quốc', 'Anh', 'Ngọc', 'Công', 'Quang', 'Hồng', 'Kim'];
        const tenList = ['Hùng', 'Tuấn', 'Anh', 'Dũng', 'Phương', 'Thảo', 'Mai', 'Hương', 'Nam', 'Việt', 'Lan', 'Cường', 'Sơn', 'Tùng', 'Hoàng', 'Long', 'Trang'];
        const phonePrefixes = ['098', '097', '096', '032', '035', '038', '039', '086', '091', '094', '088', '081', '082', '090', '093', '070', '079', '077'];

        const crypto = require('crypto');
        const getRandomName = () => `${hoList[Math.floor(Math.random() * hoList.length)]} ${demList[Math.floor(Math.random() * demList.length)]} ${tenList[Math.floor(Math.random() * tenList.length)]}`;
        const getRandomPhone = () => {
            const prefix = phonePrefixes[Math.floor(Math.random() * phonePrefixes.length)];
            const suffix = Math.floor(Math.random() * 10000000).toString().padStart(7, '0');
            return `${prefix}${suffix}`;
        };

        let totalOrdersCreated = 0;
        let totalRevenueGenerated = 0;
        const targetPerBranch = TARGET_REVENUE / branches.length;

        // Chạy vòng lặp qua từng chi nhánh để đảm bảo phân bổ đều
        for (const branch of branches) {
            let branchRevenue = 0;
            const branchSalesStaff = salesStaff.filter(s => s.branchId === branch.id);
            const staffToUse = branchSalesStaff.length > 0 ? branchSalesStaff : salesStaff;

            console.log(`Đang seed cho chi nhánh: ${branch.name} (Mục tiêu: ${targetPerBranch.toLocaleString()} VNĐ)`);

            while (branchRevenue < targetPerBranch) {
                const orderBatch: any[] = [];
                const itemBatch: any[] = [];
                const splitBatch: any[] = [];
                const paymentBatch: any[] = [];
                const BATCH_SIZE = 200; // Batch nhỏ hơn để kiểm soát chính xác cho từng chi nhánh

                for (let i = 0; i < BATCH_SIZE && branchRevenue < targetPerBranch; i++) {
                    const product = products[Math.floor(Math.random() * products.length)];
                    const sale = staffToUse[Math.floor(Math.random() * staffToUse.length)];
                    
                    const randomDayOffset = Math.floor(Math.random() * DAYS_TO_SEED);
                    const orderDate = new Date(startDate.getTime());
                    orderDate.setDate(orderDate.getDate() + randomDayOffset);
                    
                    const isEvening = Math.random() > 0.7;
                    orderDate.setHours(isEvening ? (18 + Math.floor(Math.random() * 4)) : (8 + Math.floor(Math.random() * 10)));
                    orderDate.setMinutes(Math.floor(Math.random() * 60));

                    const orderId = crypto.randomUUID();
                    const totalAmount = Number(product.minPrice);

                    // Thuật toán trạng thái ngẫu nhiên:
                    // 70% đã giao (delivered), 15% đang xử lý (assigned), 10% chờ (pending), 5% hủy (canceled)
                    const rand = Math.random();
                    let status = 'delivered';
                    if (rand > 0.7 && rand <= 0.85) status = 'assigned';
                    else if (rand > 0.85 && rand <= 0.95) status = 'pending';
                    else if (rand > 0.95) status = 'canceled';

                    const isConfirmed = status === 'delivered';

                    orderBatch.push({
                        id: orderId,
                        branchId: branch.id,
                        customerName: getRandomName(),
                        customerPhone: getRandomPhone(),
                        customerAddress: 'Khu vực ' + branch.name,
                        orderDate: orderDate,
                        orderSource: ['hotline', 'fanpage', 'vãng lai', 'giới thiệu'][Math.floor(Math.random() * 4)],
                        status: status,
                        totalAmount: totalAmount,
                        createdBy: adminUser.id,
                        isPaymentConfirmed: isConfirmed,
                        confirmedById: isConfirmed ? adminUser.id : null,
                        confirmedAt: isConfirmed ? orderDate : null,
                        updatedAt: orderDate,
                        createdAt: orderDate,
                    });

                    itemBatch.push({
                        id: crypto.randomUUID(),
                        orderId: orderId,
                        productId: product.id,
                        quantity: 1,
                        unitPrice: totalAmount,
                        totalPrice: totalAmount,
                        minPriceAtSale: totalAmount,
                        isBelowMin: false,
                    });

                    splitBatch.push({
                        id: crypto.randomUUID(),
                        orderId: orderId,
                        employeeId: sale.id,
                        branchId: branch.id,
                        splitPercent: 100,
                        splitAmount: totalAmount,
                    });

                    // Chỉ tạo thanh toán cho các đơn đã giao hoặc đang xử lý
                    if (status === 'delivered' || status === 'assigned') {
                        paymentBatch.push({
                            id: crypto.randomUUID(),
                            orderId: orderId,
                            paymentMethod: Math.random() > 0.5 ? 'transfer' : 'cash',
                            amount: status === 'delivered' ? totalAmount : (totalAmount * 0.3), // Trả trước 30% nếu đang xử lý
                            paidAt: orderDate,
                        });
                    }

                    branchRevenue += totalAmount;
                    totalOrdersCreated++;
                    totalRevenueGenerated += totalAmount;
                }

                // Chèn theo Batch cho từng chi nhánh
                await this.prisma.order.createMany({ data: orderBatch });
                await this.prisma.orderItem.createMany({ data: itemBatch });
                await this.prisma.orderSplit.createMany({ data: splitBatch });
                await this.prisma.payment.createMany({ data: paymentBatch });
            }
            console.log(`Hoàn tất chi nhánh: ${branch.name}. Doanh số: ${branchRevenue.toLocaleString()} VNĐ`);
        }

        return {
            success: true,
            totalOrders: totalOrdersCreated,
            totalRevenue: totalRevenueGenerated,
            message: `Hoàn tất seed ${totalRevenueGenerated.toLocaleString()} VNĐ chia đều cho ${branches.length} chi nhánh.`
        };
    }
}
