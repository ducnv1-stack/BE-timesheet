import { Controller, Get, Post, Patch, Delete, Body, Query, Param } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { CheckInDto, CheckOutDto } from './dto/attendance.dto';

@Controller('attendance')
export class AttendanceController {
    constructor(private readonly attendanceService: AttendanceService) { }

    @Get('today')
    async getToday(@Query('employeeId') employeeId: string) {
        return this.attendanceService.getTodayStatus(employeeId);
    }

    @Post('check-in')
    async checkIn(@Body() dto: CheckInDto, @Query('employeeId') employeeId: string) {
        return this.attendanceService.checkIn(employeeId, dto);
    }

    @Post('check-out')
    async checkOut(@Body() dto: CheckOutDto, @Query('employeeId') employeeId: string) {
        return this.attendanceService.checkOut(employeeId, dto);
    }

    @Get('timesheet')
    async getTimesheet(
        @Query('employeeId') employeeId: string,
        @Query('month') month: string,
        @Query('year') year: string
    ) {
        return this.attendanceService.getMonthlyTimesheet(
            employeeId,
            parseInt(month),
            parseInt(year)
        );
    }

    @Get('summary')
    async getSummary(
        @Query('month') month: string,
        @Query('year') year: string,
        @Query('branchId') branchId?: string,
        @Query('search') search?: string,
        @Query('position') position?: string
    ) {
        return this.attendanceService.getMonthlySummary(
            parseInt(month),
            parseInt(year),
            branchId,
            search,
            position
        );
    }

    // ========== WORK SHIFT CRUD ==========

    @Get('shifts')
    async getShifts(@Query('branchId') branchId?: string) {
        return this.attendanceService.getShifts(branchId);
    }

    @Post('shifts')
    async createShift(@Body() data: any) {
        return this.attendanceService.createShift(data);
    }

    @Patch('shifts/:id')
    async updateShift(@Param('id') id: string, @Body() data: any) {
        return this.attendanceService.updateShift(id, data);
    }

    @Delete('shifts/:id')
    async deleteShift(@Param('id') id: string) {
        return this.attendanceService.deleteShift(id);
    }

    @Patch('adjust')
    async adjustAttendance(@Body() data: {
        employeeId: string;
        date: string;
        checkInTime?: string;
        checkOutTime?: string;
        note?: string;
        changedById: string;
    }) {
        return this.attendanceService.adjustAttendance(data);
    }

    @Get('audit-logs')
    async getAuditLogs(
        @Query('attendanceId') attendanceId?: string,
        @Query('branchId') branchId?: string,
        @Query('month') month?: string,
        @Query('year') year?: string,
        @Query('search') search?: string,
    ) {
        if (attendanceId) {
            return this.attendanceService.getAuditLogs(attendanceId);
        }
        return this.attendanceService.getAllAuditLogs(
            month ? parseInt(month) : undefined,
            year ? parseInt(year) : undefined,
            branchId,
            search
        );
    }

    @Get('daily')
    async getDaily(
        @Query('date') date?: string,
        @Query('branchId') branchId?: string,
        @Query('search') search?: string,
        @Query('position') position?: string
    ) {
        const targetDate = date ? new Date(date) : new Date();
        return this.attendanceService.getDailyAttendance(
            targetDate,
            branchId,
            search,
            position
        );
    }
}
