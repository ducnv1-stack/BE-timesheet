import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeaveRequestDto, LeaveSession } from './dto/create-leave-request.dto';

@Injectable()
export class LeaveRequestsService {
  constructor(private prisma: PrismaService) {}

  async create(employeeId: string, dto: CreateLeaveRequestDto) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate < startDate) {
      throw new BadRequestException('Ngày kết thúc không thể trước ngày bắt đầu');
    }

    const finalStatus = dto.status === 'APPROVED' ? 'APPROVED' : 'PENDING';

    const request = await this.prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveType: dto.leaveType,
        startDate,
        endDate,
        isRecurring: dto.isRecurring || false,
        recurringDays: dto.recurringDays || [],
        leaveSession: dto.leaveSession || LeaveSession.ALL_DAY,
        reason: dto.reason,
        status: finalStatus,
        approvedAt: finalStatus === 'APPROVED' ? new Date() : undefined,
      },
      include: { employee: true },
    });

    if (finalStatus === 'APPROVED') {
      await this.syncAttendanceAfterApproval(request);
    }

    return request;
  }

  async findAll(filters: {
    branchId?: string;
    status?: string;
    employeeId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { branchId, status, employeeId, startDate, endDate } = filters;

    return this.prisma.leaveRequest.findMany({
      where: {
        status,
        employeeId,
        startDate: startDate ? { gte: new Date(startDate) } : undefined,
        endDate: endDate ? { lte: new Date(endDate) } : undefined,
        employee: branchId ? { branchId } : undefined,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            branch: { select: { name: true } },
            pos: { select: { name: true } },
          },
        },
        approver: {
          select: {
            username: true,
            employee: { select: { fullName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findMyRequests(employeeId: string) {
    return this.prisma.leaveRequest.findMany({
      where: { employeeId },
      include: {
        approver: {
          select: {
            username: true,
            employee: { select: { fullName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getWeeklySummary(startDate: string, endDate: string, branchId?: string, employeeId?: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    return this.prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        ...(employeeId ? { employeeId } : {}),
        AND: [
          {
            OR: [
              {
                isRecurring: true,
                startDate: { lte: end },
              },
              {
                isRecurring: false,
                AND: [
                  { startDate: { lte: end } },
                  { endDate: { gte: start } },
                ],
              },
            ],
          },
          {
            employee: branchId ? { branchId } : undefined,
          },
        ],
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            branch: { select: { name: true } },
            pos: { select: { name: true } },
          },
        },
      },
    });
  }

  async updateStatus(id: string, status: 'APPROVED' | 'REJECTED' | 'CANCELLED', approvedById: string) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!request) {
      throw new NotFoundException('Không tìm thấy đơn nghỉ phép');
    }

    if (status === 'CANCELLED') {
      // Hoàn tác bảng công nếu đơn đã duyệt
      if (request.status === 'APPROVED' && !request.isRecurring) {
        await this.revertAttendanceAfterCancellation(request);
      }
    } else if (request.status !== 'PENDING') {
      throw new BadRequestException('Đơn này đã được xử lý trước đó');
    }

    const updatedRequest = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status,
        approvedById,
        approvedAt: new Date(),
      },
    });

    // Nếu phê duyệt, thực hiện đồng bộ hóa bảng công cho các ngày trong tương lai (hoặc hiện tại)
    if (status === 'APPROVED') {
      await this.syncAttendanceAfterApproval({ ...updatedRequest, employee: request.employee });
    }

    return updatedRequest;
  }

  async update(id: string, employeeId: string, isAdmin: boolean, dto: CreateLeaveRequestDto) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!request) {
      throw new NotFoundException('Không tìm thấy đơn nghỉ phép');
    }

    if (!isAdmin && request.employeeId !== employeeId) {
      throw new BadRequestException('Bạn không có quyền chỉnh sửa đơn này');
    }

    // Nếu đơn đã được duyệt, chúng ta cần hoàn tác bảng công trước khi cập nhật
    if (request.status === 'APPROVED' && !request.isRecurring) {
      await this.revertAttendanceAfterCancellation(request);
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate < startDate) {
      throw new BadRequestException('Ngày kết thúc không thể trước ngày bắt đầu');
    }

    // Nếu nhân viên sửa đơn đã DUYỆT hoặc TỪ CHỐI, chuyển nó về CHỜ DUYỆT (trừ khi là Admin sửa)
    let finalStatus = request.status;
    if (!isAdmin && (request.status === 'APPROVED' || request.status === 'REJECTED')) {
      finalStatus = 'PENDING';
    }
    // Nếu admin truyền status cụ thể
    if (isAdmin && dto.status) {
      finalStatus = dto.status as any;
    }

    const updatedRequest = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        leaveType: dto.leaveType,
        startDate,
        endDate,
        isRecurring: dto.isRecurring || false,
        recurringDays: dto.recurringDays || [],
        leaveSession: dto.leaveSession || LeaveSession.ALL_DAY,
        reason: dto.reason,
        status: finalStatus,
        approvedAt: finalStatus === 'APPROVED' ? new Date() : request.approvedAt,
      },
      include: { employee: true },
    });

    // Nếu trạng thái mới là APPROVED, thực hiện đồng bộ lại bảng công
    if (finalStatus === 'APPROVED') {
      await this.syncAttendanceAfterApproval(updatedRequest);
    }

    return updatedRequest;
  }

  private async syncAttendanceAfterApproval(request: any) {
    // Chỉ xử lý đồng bộ hóa cho đơn nghỉ Đột xuất (isRecurring = false)
    // Đối với đơn Cố định, chúng ta sẽ xử lý động trong AttendanceService khi lấy dữ liệu
    if (request.isRecurring) return;

    const start = new Date(request.startDate);
    const end = new Date(request.endDate);
    
    // Lặp qua từng ngày trong khoảng nghỉ
    const curr = new Date(start);
    while (curr <= end) {
      const targetDate = new Date(Date.UTC(curr.getFullYear(), curr.getMonth(), curr.getDate()));
      
      // Tính workCount dựa trên leaveSession
      let workCount = 0.0;
      if (request.leaveSession === LeaveSession.MORNING || request.leaveSession === LeaveSession.AFTERNOON) {
        workCount = 0.5;
      }

      // Tìm hoặc cập nhật bản ghi công
      await this.prisma.attendance.upsert({
        where: {
          employeeId_date: {
            employeeId: request.employeeId,
            date: targetDate,
          },
        },
        update: {
          dailyStatus: 'ABSENT_APPROVED',
          workCount: workCount,
          note: `Nghỉ phép (${request.leaveType}): ${request.reason || ''}`,
        },
        create: {
          employeeId: request.employeeId,
          branchId: request.employee.branchId,
          date: targetDate,
          dailyStatus: 'ABSENT_APPROVED',
          workCount: workCount,
          note: `Nghỉ phép (${request.leaveType}): ${request.reason || ''}`,
        },
      });

      curr.setDate(curr.getDate() + 1);
    }
  }

  async delete(id: string, employeeId?: string, isAdmin = false, specificDate?: string) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!request) throw new NotFoundException('Không tìm thấy đơn');
    
    if (!isAdmin) {
      if (request.employeeId !== employeeId) throw new BadRequestException('Bạn không có quyền xóa đơn này');
      if (request.status !== 'PENDING') throw new BadRequestException('Không thể xóa đơn đã được xử lý');
    }

    // Xử lý xóa 1 ngày cụ thể
    if (specificDate) {
      const targetDate = new Date(specificDate);
      const targetDateUtc = new Date(Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()));
      
      if (request.isRecurring) {
        // Xóa 1 thứ trong tuần của lịch cố định
        const dayOfWeek = targetDate.getDay();
        const newDays = request.recurringDays.filter(d => d !== dayOfWeek);
        
        if (newDays.length === 0) {
          // Hoàn tác bảng công nếu là đơn cố định (thực tế logic cố định hiện tại đang check động, 
          // nhưng nếu sau này sync cứng thì cần revert ở đây)
          return this.prisma.leaveRequest.update({ 
            where: { id },
            data: { status: 'CANCELLED' } 
          });
        } else {
          return this.prisma.leaveRequest.update({
            where: { id },
            data: { recurringDays: newDays }
          });
        }
      } else {
        // Xóa 1 ngày lẻ trong đơn đa ngày (Nghỉ đột xuất)
        const startDate = new Date(request.startDate);
        const endDate = new Date(request.endDate);
        const startDateUtc = new Date(Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()));
        const endDateUtc = new Date(Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()));

        // Hoàn tác bảng công cho ngày bị xóa
        if (request.status === 'APPROVED') {
          await this.revertSingleAttendance(request.employeeId, targetDateUtc);
        }

        if (targetDateUtc.getTime() === startDateUtc.getTime() && targetDateUtc.getTime() === endDateUtc.getTime()) {
          // Xóa ngày duy nhất của đơn -> Hủy đơn
          return this.prisma.leaveRequest.update({ 
            where: { id },
            data: { status: 'CANCELLED' }
          });
        } else if (targetDateUtc.getTime() === startDateUtc.getTime()) {
          // Xóa ngày bắt đầu -> dời startDate tiến 1 VÀ tạo 1 record CANCELLED cho ngày cũ
          const newStart = new Date(startDateUtc);
          newStart.setUTCDate(newStart.getUTCDate() + 1);
          
          const { id: _, employee: __, createdAt: ___, updatedAt: ____, ...rest } = request;
          await this.prisma.leaveRequest.create({
            data: {
              ...rest,
              startDate: startDateUtc,
              endDate: startDateUtc,
              status: 'CANCELLED'
            }
          });

          return this.prisma.leaveRequest.update({
            where: { id },
            data: { startDate: newStart }
          });
        } else if (targetDateUtc.getTime() === endDateUtc.getTime()) {
          // Xóa ngày kết thúc -> dời endDate lùi 1 VÀ tạo 1 record CANCELLED cho ngày cũ
          const newEnd = new Date(endDateUtc);
          newEnd.setUTCDate(newEnd.getUTCDate() - 1);

          const { id: _, employee: __, createdAt: ___, updatedAt: ____, ...rest } = request;
          await this.prisma.leaveRequest.create({
            data: {
              ...rest,
              startDate: endDateUtc,
              endDate: endDateUtc,
              status: 'CANCELLED'
            }
          });

          return this.prisma.leaveRequest.update({
            where: { id },
            data: { endDate: newEnd }
          });
        } else {
          // Xóa ngày ở giữa -> Tách làm 2 đơn APPROVED và 1 đơn CANCELLED ở giữa
          const firstEnd = new Date(targetDateUtc);
          firstEnd.setUTCDate(firstEnd.getUTCDate() - 1);
          
          const secondStart = new Date(targetDateUtc);
          secondStart.setUTCDate(secondStart.getUTCDate() + 1);

          const { id: _, employee: __, createdAt: ___, updatedAt: ____, ...rest } = request;
          
          // 1. Tạo đơn CANCELLED cho ngày ở giữa
          await this.prisma.leaveRequest.create({
            data: {
              ...rest,
              startDate: targetDateUtc,
              endDate: targetDateUtc,
              status: 'CANCELLED'
            }
          });

          // 2. Tạo đơn mới cho phần sau (APPROVED)
          await this.prisma.leaveRequest.create({
            data: {
              ...rest,
              startDate: secondStart,
              endDate: endDateUtc,
            }
          });

          // 3. Cập nhật đơn hiện tại thành phần đầu
          return this.prisma.leaveRequest.update({
            where: { id },
            data: { endDate: firstEnd }
          });
        }
      }
    }

    // Mặc định: Hủy toàn bộ đơn
    if (request.status === 'APPROVED' && !request.isRecurring) {
      await this.revertAttendanceAfterCancellation(request);
    }

    return this.prisma.leaveRequest.update({ 
      where: { id },
      data: { status: 'CANCELLED' }
    });
  }

  private async revertSingleAttendance(employeeId: string, targetDateUtc: Date) {
    const attendance = await this.prisma.attendance.findUnique({
      where: {
        employeeId_date: {
          employeeId: employeeId,
          date: targetDateUtc,
        }
      }
    });

    if (attendance && attendance.dailyStatus === 'ABSENT_APPROVED') {
      const hasCheckData = attendance.checkInTime || attendance.checkOutTime;
      await this.prisma.attendance.update({
        where: { id: attendance.id },
        data: {
          dailyStatus: hasCheckData ? 'PRESENT' : 'ABSENT',
          workCount: hasCheckData ? attendance.workCount : 0,
          note: null
        }
      });
    }
  }

  private async revertAttendanceAfterCancellation(request: any) {
    const start = new Date(request.startDate);
    const end = new Date(request.endDate);
    const curr = new Date(start);

    while (curr <= end) {
      const targetDate = new Date(Date.UTC(curr.getFullYear(), curr.getMonth(), curr.getDate()));
      const attendance = await this.prisma.attendance.findUnique({
        where: {
          employeeId_date: {
            employeeId: request.employeeId,
            date: targetDate,
          }
        }
      });

      if (attendance && attendance.dailyStatus === 'ABSENT_APPROVED') {
        const hasCheckData = attendance.checkInTime || attendance.checkOutTime;
        await this.prisma.attendance.update({
          where: { id: attendance.id },
          data: {
            dailyStatus: hasCheckData ? 'PRESENT' : 'ABSENT',
            workCount: hasCheckData ? attendance.workCount : 0,
            note: null
          }
        });
      }
      curr.setDate(curr.getDate() + 1);
    }
  }
}
