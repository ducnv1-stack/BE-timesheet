import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExceptionRequestDto, ExceptionType } from './dto/create-exception-request.dto';
import { UpdateExceptionRequestStatusDto, RequestStatus } from './dto/update-exception-request-status.dto';

@Injectable()
export class AttendanceExceptionRequestsService {
  constructor(private prisma: PrismaService) {}

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
    const attendance = request.attendance;
    if (!attendance) return;

    const updateData: {
      lateMinutes?: number;
      earlyLeaveMinutes?: number;
      checkInStatus?: string;
      checkOutStatus?: string;
      note?: string;
    } = {};

    const auditData: {
      old: Record<string, any>;
      new: Record<string, any>;
    } = {
      old: {},
      new: {},
    };

    switch (request.type) {
      case ExceptionType.GO_LATE:
        updateData.lateMinutes = 0;
        updateData.checkInStatus = 'ON_TIME';
        auditData.old.lateMinutes = (attendance as any).lateMinutes;
        auditData.new.lateMinutes = 0;
        break;
      case ExceptionType.LEAVE_EARLY:
        updateData.earlyLeaveMinutes = 0;
        updateData.checkOutStatus = 'ON_TIME';
        auditData.old.earlyLeaveMinutes = (attendance as any).earlyLeaveMinutes;
        auditData.new.earlyLeaveMinutes = 0;
        break;
      case ExceptionType.GPS_ERROR:
        // Mark GPS as manually verified/ignored
        updateData.note = (attendance.note ? attendance.note + '\n' : '') + '[Đơn giải trình GPS được duyệt]';
        break;
      case ExceptionType.FORGOT_CHECKIN:
      case ExceptionType.FORGOT_CHECKOUT:
        // These might need manual time entry by HR anyway, but we can mark them as processed
        updateData.note = (attendance.note ? attendance.note + '\n' : '') + `[Đơn giải trình ${request.type} được duyệt]`;
        break;
    }

    if (Object.keys(updateData).length > 0) {
      await tx.attendance.update({
        where: { id: attendance.id },
        data: {
          ...updateData,
          isManualOverride: true,
          approvedById: approvedById,
        },
      });

      // Record Audit Log
      await tx.attendanceAuditLog.create({
        data: {
          attendanceId: attendance.id,
          changedBy: approvedById,
          action: `EXCEPTION_APPROVED_${request.type}`,
          oldData: auditData.old,
          newData: auditData.new,
          reason: `Phê duyệt đơn giải trình: ${request.reason}`,
        },
      });
    }
  }
}
