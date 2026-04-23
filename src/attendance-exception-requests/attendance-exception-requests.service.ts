import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExceptionRequestDto, ExceptionType } from './dto/create-exception-request.dto';
import { UpdateExceptionRequestStatusDto, RequestStatus } from './dto/update-exception-request-status.dto';

import { AttendanceCalculatorService, AttendanceConfig } from '../attendance/attendance-calculator.service';

@Injectable()
export class AttendanceExceptionRequestsService {
  constructor(
    private prisma: PrismaService,
    private calculator: AttendanceCalculatorService
  ) {}

  async create(createDto: CreateExceptionRequestDto) {
    const { date, attendanceId, employeeId, ...rest } = createDto;
    
    // Check if there is already a pending request of the same type for this date
    const existing = await this.prisma.attendanceExceptionRequest.findFirst({
      where: {
        employeeId,
        date: new Date(date),
        type: createDto.type,
        status: RequestStatus.PENDING,
      },
    });

    if (existing) {
      throw new BadRequestException('Bạn đã có một đơn giải trình cùng loại đang chờ duyệt cho ngày này.');
    }

    return this.prisma.attendanceExceptionRequest.create({
      data: {
        ...rest,
        date: new Date(date),
        employeeId,
        attendanceId,
        actualTime: createDto.actualTime,
        status: RequestStatus.PENDING,
      },
    });
  }

  async findAll(query: { employeeId?: string; status?: string; startDate?: string; endDate?: string; branchId?: string }) {
    const { employeeId, status, startDate, endDate, branchId } = query;
    const where: {
      employeeId?: string;
      status?: string;
      date?: { gte: Date; lte: Date };
      employee?: { branchId: string };
    } = {};

    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;
    if (startDate && endDate) {
      where.date = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }
    if (branchId) {
      where.employee = {
        branchId: branchId,
      };
    }

    return this.prisma.attendanceExceptionRequest.findMany({
      where,
      include: {
        employee: {
          select: {
            fullName: true,
            branch: { select: { name: true } },
            position: true,
          },
        },
        approver: {
          select: {
            username: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const request = await this.prisma.attendanceExceptionRequest.findUnique({
      where: { id },
      include: {
        employee: true,
        attendance: true,
        approver: true,
      },
    });

    if (!request) throw new NotFoundException('Không tìm thấy đơn giải trình.');
    return request;
  }

  async updateStatus(id: string, updateDto: UpdateExceptionRequestStatusDto) {
    console.log('=== updateStatus called ===');
    console.log('Request ID:', id);
    console.log('updateDto:', JSON.stringify(updateDto));
    
    const request = await this.prisma.attendanceExceptionRequest.findUnique({
      where: { id },
      include: { attendance: true },
    });

    if (!request) throw new NotFoundException('Không tìm thấy đơn giải trình.');
    if (request.status !== RequestStatus.PENDING) {
      throw new BadRequestException('Đơn này đã được xử lý rồi.');
    }

    // Validate approvedById exists as a User
    if (updateDto.approvedById) {
      const approver = await this.prisma.user.findUnique({
        where: { id: updateDto.approvedById },
      });
      if (!approver) {
        console.error('approvedById not found in users table:', updateDto.approvedById);
        throw new BadRequestException(`Không tìm thấy người duyệt với ID: ${updateDto.approvedById}. Vui lòng đăng nhập lại.`);
      }
      console.log('Approver found:', approver.username);
    }

    return await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.attendanceExceptionRequest.update({
        where: { id },
        data: {
          status: updateDto.status,
          note: updateDto.note,
          approvedById: updateDto.approvedById,
          approvedAt: new Date(),
        },
      });

      // If approved, update attendance record
      if (updateDto.status === RequestStatus.APPROVED && request.attendanceId) {
        await this.applyExceptionToAttendance(tx, request, updateDto.approvedById);
      }

      return updatedRequest;
    });
  }

  private async applyExceptionToAttendance(
    tx: any,
    request: any,
    approvedById: string
  ) {
    const attendance = await tx.attendance.findUnique({
        where: { id: request.attendanceId },
        include: { employee: true }
    });
    if (!attendance) return;

    const updateData: Record<string, any> = {
        isManualOverride: true,
        approvedById: approvedById,
    };

    // 1. Cập nhật giờ dựa trên đơn giải trình
    if (request.type === ExceptionType.FORGOT_CHECKIN && request.actualTime) {
        const [h, m] = request.actualTime.split(':').map(Number);
        const newIn = new Date(attendance.date);
        newIn.setUTCHours(h - 7, m, 0, 0); // Giả định VN+7
        updateData.checkInTime = newIn;
    } else if (request.type === ExceptionType.FORGOT_CHECKOUT && request.actualTime) {
        const [h, m] = request.actualTime.split(':').map(Number);
        const newOut = new Date(attendance.date);
        newOut.setUTCHours(h - 7, m, 0, 0);
        updateData.checkOutTime = newOut;
    }

    // 2. Lấy cấu hình để tính toán lại
    const policy = await tx.attendancePolicy.findFirst({
        where: {
            OR: [
                { employees: { some: { id: attendance.employeeId } } },
                { positions: { some: { id: attendance.employee.positionId } } }
            ]
        },
        include: { days: true }
    });

    if (policy) {
        const configData: AttendanceConfig = policy.configData as any;
        const checkInTime = updateData.checkInTime || attendance.checkInTime;
        const checkOutTime = updateData.checkOutTime || attendance.checkOutTime;

        if (checkInTime && checkOutTime) {
            const engineResult = this.calculator.evaluateAttendance(configData, checkInTime, checkOutTime);
            
            // Nếu là đơn giải trình đi muộn/về sớm, ép trạng thái về ON_TIME
            if (request.type === ExceptionType.GO_LATE) {
                engineResult.lateMinutes = 0;
                engineResult.checkInStatus = 'ON_TIME';
            } else if (request.type === ExceptionType.LEAVE_EARLY) {
                engineResult.earlyLeaveMinutes = 0;
                engineResult.checkOutStatus = 'ON_TIME';
            }

            Object.assign(updateData, engineResult);
        }
    }

    await tx.attendance.update({
      where: { id: attendance.id },
      data: updateData,
    });

    // Record Audit Log
    await tx.attendanceAuditLog.create({
      data: {
        attendanceId: attendance.id,
        changedBy: approvedById,
        action: `EXCEPTION_APPROVED_${request.type}`,
        oldData: {
            checkInTime: attendance.checkInTime,
            checkOutTime: attendance.checkOutTime,
            workCount: attendance.workCount
        },
        newData: {
            checkInTime: updateData.checkInTime,
            checkOutTime: updateData.checkOutTime,
            workCount: updateData.workCount
        },
        reason: `Phê duyệt đơn giải trình: ${request.reason}`,
      },
    });
  }
}
