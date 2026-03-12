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
    UseInterceptors,
    UploadedFile,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, parse, join } from 'path';
import sharp from 'sharp';
import * as fs from 'fs/promises';
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
        @Query('department') department?: string,
        @Query('positionId') positionId?: string,
        @Query('departmentId') departmentId?: string,
        @Query('hasAccount') hasAccount?: 'true' | 'false',
        @Query('userId') userId?: string,
        @Query('roleCode') roleCode?: string,
    ) {
        return this.employeesService.findAll({
            branchId,
            position,
            status,
            department,
            positionId,
            departmentId,
            hasAccount,
            userId,
            roleCode,
        });
    }

    @Get('export')
    findAllFull() {
        return this.employeesService.findAllFull();
    }

    @Get('positions')
    getPositions() {
        return this.employeesService.getPositions();
    }

    @Get('performance/report')
    getPerformanceReport(
        @Query('month') month: string,
        @Query('year') year: string,
        @Query('branchId') branchId?: string,
    ) {
        return this.employeesService.getPerformanceReport(parseInt(month), parseInt(year), branchId);
    }

    @Get(':id/performance')
    getPerformanceStats(
        @Param('id') id: string,
        @Query('month') month: string,
        @Query('year') year: string,
    ) {
        return this.employeesService.getPerformanceStats(id, parseInt(month), parseInt(year));
    }

    @Post(':id/avatar')
    @UseInterceptors(FileInterceptor('file', {
        storage: diskStorage({
            destination: './public/uploads/avatars',
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
                const ext = extname(file.originalname);
                cb(null, `${req.params.id}-${uniqueSuffix}${ext}`);
            }
        }),
        fileFilter: (req, file, cb) => {
            if (!file.originalname.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i)) {
                return cb(new BadRequestException('Only image files are allowed!'), false);
            }
            cb(null, true);
        },
        limits: {
            fileSize: 5 * 1024 * 1024, // 5MB
        }
    }))
    async uploadAvatar(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('No file uploaded or file type is invalid');
        }

        let avatarUrl = `/uploads/avatars/${file.filename}`;

        try {
            const filenameWithoutExt = parse(file.filename).name;
            const newFilename = `${filenameWithoutExt}.webp`;
            const newFilePath = join('./public/uploads/avatars', newFilename);

            await sharp(file.path)
                .resize({ width: 800, withoutEnlargement: true }) // Avatars don't need to be huge
                .webp({ quality: 80 })
                .toFile(newFilePath);

            if (file.path !== newFilePath) {
                await fs.unlink(file.path);
            }

            avatarUrl = `/uploads/avatars/${newFilename}`;
        } catch (error) {
            console.error(`Error processing avatar ${file.filename}:`, error);
            // Fallback to original file
        }

        return this.employeesService.updateAvatar(id, avatarUrl);
    }

    @Delete(':id/avatar')
    removeAvatar(@Param('id') id: string) {
        return this.employeesService.removeAvatar(id);
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
