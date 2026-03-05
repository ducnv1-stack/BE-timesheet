import { Controller, Get, Post, Body, Query, UseGuards, Request } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { CheckInDto, CheckOutDto } from './dto/attendance.dto';

@Controller('attendance')
export class AttendanceController {
    constructor(private readonly attendanceService: AttendanceService) { }

    @Get('today')
    async getToday(@Query('employeeId') employeeId: string) {
        // Lưu ý: Sau này sẽ dùng dữ liệu từ JWT/User Request thay vì Query param
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
}
