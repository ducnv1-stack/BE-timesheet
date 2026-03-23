import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req, UseGuards } from '@nestjs/common';
import { LeaveRequestsService } from './leave-requests.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { UpdateLeaveRequestStatusDto } from './dto/update-leave-request-status.dto';

@Controller('leave-requests')
export class LeaveRequestsController {
  constructor(private readonly service: LeaveRequestsService) {}

  @Post()
  create(@Body() createDto: CreateLeaveRequestDto, @Req() req: any) {
    // Note: req.user.employeeId should be populated by your AuthGuard
    // For now, we expect employeeId to be passed or extracted from user context
    const employeeId = req.user?.employee?.id || req.body.employeeId; 
    return this.service.create(employeeId, createDto);
  }

  @Get()
  findAll(
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('employeeId') employeeId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.findAll({ branchId, status, employeeId, startDate, endDate });
  }

  @Get('weekly')
  getWeekly(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.getWeeklySummary(startDate, endDate, branchId);
  }

  @Get('my')
  findMyRequests(@Req() req: any) {
    const employeeId = req.user?.employee?.id;
    return this.service.findMyRequests(employeeId);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() updateDto: UpdateLeaveRequestStatusDto,
    @Req() req: any
  ) {
    const approvedById = req.user?.id || updateDto.approvedById;
    if (!approvedById) {
       // If no user context and no ID in body, we might need a default valid UUID or throw error
       // But for now, we expect frontend to send it.
    }
    return this.service.updateStatus(id, updateDto.status, approvedById);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Body() body: { isAdmin?: boolean, specificDate?: string }, @Req() req: any) {
    const employeeId = req.user?.employee?.id;
    const isAdmin = body.isAdmin || false;
    return this.service.delete(id, employeeId, isAdmin, body.specificDate);
  }
}
