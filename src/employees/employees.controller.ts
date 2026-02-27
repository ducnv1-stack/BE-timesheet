import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Patch,
    Body,
    Param,
    Query,
    Req,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ToggleAccountDto } from './dto/toggle-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Controller('employees')
export class EmployeesController {
    constructor(private readonly employeesService: EmployeesService) { }

    @Get()
    findAll(
        @Query('branchId') branchId?: string,
        @Query('position') position?: string,
        @Query('status') status?: string,
        @Query('hasAccount') hasAccount?: 'true' | 'false',
        @Query('userId') userId?: string,
        @Query('roleCode') roleCode?: string,
    ) {
        return this.employeesService.findAll({
            branchId,
            position,
            status,
            hasAccount,
            userId,
            roleCode,
        });
    }

    @Get('performance/report')
    getPerformanceReport(
        @Query('month') month: string,
        @Query('year') year: string,
    ) {
        return this.employeesService.getPerformanceReport(parseInt(month), parseInt(year));
    }

    @Get(':id/performance')
    getPerformanceStats(
        @Param('id') id: string,
        @Query('month') month: string,
        @Query('year') year: string,
    ) {
        return this.employeesService.getPerformanceStats(id, parseInt(month), parseInt(year));
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.employeesService.findOne(id);
    }

    @Post()
    create(@Body() createEmployeeDto: CreateEmployeeDto) {
        return this.employeesService.create(createEmployeeDto);
    }

    @Patch(':id')
    update(
        @Param('id') id: string,
        @Body() updateEmployeeDto: UpdateEmployeeDto,
        @Req() req: any,
    ) {
        const userId = req.user?.id || 'system'; // Will be properly set when auth guard is implemented
        return this.employeesService.update(id, updateEmployeeDto, userId);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.employeesService.remove(id);
    }

    // ========== ACCOUNT MANAGEMENT ENDPOINTS ==========

    @Post(':id/create-account')
    createAccount(
        @Param('id') id: string,
        @Body() createAccountDto: CreateAccountDto,
    ) {
        return this.employeesService.createAccount(id, createAccountDto);
    }

    @Patch(':id/reset-password')
    resetPassword(
        @Param('id') id: string,
        @Body() resetPasswordDto: ResetPasswordDto,
    ) {
        return this.employeesService.resetPassword(id, resetPasswordDto);
    }

    @Patch(':id/toggle-account')
    toggleAccount(
        @Param('id') id: string,
        @Body() toggleAccountDto: ToggleAccountDto,
    ) {
        return this.employeesService.toggleAccount(id, toggleAccountDto);
    }

    @Patch(':id/account')
    updateAccount(
        @Param('id') id: string,
        @Body() updateAccountDto: UpdateAccountDto,
    ) {
        return this.employeesService.updateAccount(id, updateAccountDto);
    }
}
