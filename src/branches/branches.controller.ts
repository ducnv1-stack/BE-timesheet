import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, UnauthorizedException, ForbiddenException } from '@nestjs/common';
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
        
        const effectiveUserId = userId || req.user?.id || '00000000-0000-0000-0000-000000000000';
        
        if (pwd) {
            await this.authService.verifyPassword({ 
                userId: effectiveUserId, 
                password: pwd 
            });
        }

        // Check role
        const profile = await this.authService.getProfile(effectiveUserId);
        if (!['ADMIN', 'DIRECTOR'].includes(profile.role?.code)) {
            throw new ForbiddenException('Bạn không có quyền thêm mới chi nhánh');
        }

        return this.branchesService.create(data);
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
        const { confirmPassword, password, userId, ...data } = body;
        const pwd = confirmPassword || password;
        
        const effectiveUserId = userId || req.user?.id || '00000000-0000-0000-0000-000000000000';

        if (pwd || data.name || data.code || data.branchType) {
            if (pwd) {
                await this.authService.verifyPassword({ 
                    userId: effectiveUserId, 
                    password: pwd 
                });
            }
        }

        // Check role - Only ADMIN/DIRECTOR can change name/code/type. MANAGER can change GPS info.
        const profile = await this.authService.getProfile(effectiveUserId);
        const isAdminOrDirector = ['ADMIN', 'DIRECTOR'].includes(profile.role?.code);
        
        if (!isAdminOrDirector && (data.name || data.code || data.branchType)) {
             throw new ForbiddenException('Bạn không có quyền chỉnh sửa thông tin cơ bản của chi nhánh (Tên, Mã, Loại)');
        }

        if (!isAdminOrDirector && profile.role?.code !== 'MANAGER') {
            throw new ForbiddenException('Bạn không có quyền cập nhật chi nhánh');
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

        const effectiveUserId = userId || req.user?.id || '00000000-0000-0000-0000-000000000000';

        await this.authService.verifyPassword({ 
            userId: effectiveUserId, 
            password: pwd 
        });

        // Check role
        const profile = await this.authService.getProfile(effectiveUserId);
        if (!['ADMIN', 'DIRECTOR'].includes(profile.role?.code)) {
            throw new ForbiddenException('Bạn không có quyền xóa chi nhánh');
        }

        return this.branchesService.remove(id);
    }
}
