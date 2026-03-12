import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, UnauthorizedException } from '@nestjs/common';
import { BranchesService } from './branches.service';
import { AuthService } from '../auth/auth.service';

@Controller('branches')
export class BranchesController {
    constructor(
        private readonly branchesService: BranchesService,
        private readonly authService: AuthService,
    ) { }

    @Get()
    findAll(@Query('type') type?: 'KHO_TONG' | 'CHI_NHANH') {
        return this.branchesService.findAll(type);
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.branchesService.findOne(id);
    }

    @Post()
    async create(@Body() body: any, @Request() req: any) {
        const { confirmPassword, password, userId, ...data } = body;
        const pwd = confirmPassword || password;
        if (pwd) {
            await this.authService.verifyPassword({ 
                userId: userId || req.user?.id || '00000000-0000-0000-0000-000000000000', 
                password: pwd 
            });
        }
        return this.branchesService.create(data);
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
        const { confirmPassword, password, userId, ...data } = body;
        const pwd = confirmPassword || password;
        
        if (pwd || data.name || data.code || data.branchType) {
            if (pwd) {
                await this.authService.verifyPassword({ 
                    userId: userId || req.user?.id || '00000000-0000-0000-0000-000000000000', 
                    password: pwd 
                });
            }
        }

        // Lọc bỏ những trường không thuộc Branch model để tránh lỗi Prisma
        const safeData: any = {};
        const allowedFields = ['name', 'code', 'address', 'branchType', 'latitude', 'longitude', 'checkinRadius'];
        allowedFields.forEach(field => {
            if (data[field] !== undefined) safeData[field] = data[field];
        });
        
        return this.branchesService.update(id, safeData);
    }

    @Delete(':id')
    async remove(@Param('id') id: string, @Body() body: any, @Request() req: any) {
        const { confirmPassword, password, userId } = body;
        const pwd = confirmPassword || password;
        if (!pwd) {
            throw new UnauthorizedException('Xác nhận mật khẩu là bắt buộc để xóa chi nhánh');
        }
        await this.authService.verifyPassword({ 
            userId: userId || req.user?.id || '00000000-0000-0000-0000-000000000000', 
            password: pwd 
        });
        return this.branchesService.remove(id);
    }
}
