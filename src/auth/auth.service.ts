import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoginUserDto } from './dto/login-user.dto';
import { VerifyPasswordDto } from './dto/verify-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
    constructor(private prisma: PrismaService) { }

    async login(loginUserDto: LoginUserDto) {
        const { username } = loginUserDto;
        const user = await this.prisma.user.findUnique({
            where: { username },
            include: {
                role: true,
                employee: {
                    include: {
                        branch: true
                    }
                }
            }
        });

        if (!user) {
            throw new UnauthorizedException('Đăng nhập thất bại. Kiểm tra lại tài khoản');
        }

        if (!user.isActive) {
            throw new UnauthorizedException('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
        }

        const { passwordHash, ...result } = user;
        return {
            user: result,
            accessToken: 'mock-jwt-token-xyz',
        };
    }

    async validateUserStatus(id: string) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            select: { isActive: true }
        });

        if (!user) {
            throw new UnauthorizedException('Tài khoản không tồn tại');
        }

        return { isActive: user.isActive };
    }

    async verifyPassword(verifyPasswordDto: VerifyPasswordDto) {
        const { userId, password } = verifyPasswordDto;
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new BadRequestException('Người dùng không tồn tại');
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            throw new UnauthorizedException('Mật khẩu không chính xác');
        }

        return { success: true };
    }

    async getProfile(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: {
                role: true,
                employee: {
                    include: {
                        branch: true,
                    },
                },
            },
        });

        if (!user) {
            throw new NotFoundException('Tài khoản không tồn tại');
        }

        const { passwordHash, ...result } = user;
        return result;
    }

    async updateProfile(userId: string, dto: UpdateProfileDto) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new NotFoundException('Tài khoản không tồn tại');
        }

        const updateData: any = {};

        // Update username
        if (dto.username && dto.username !== user.username) {
            const existing = await this.prisma.user.findUnique({
                where: { username: dto.username },
            });
            if (existing && existing.id !== userId) {
                throw new BadRequestException('Tên đăng nhập này đã được sử dụng bởi tài khoản khác');
            }
            updateData.username = dto.username;
        }

        // Update password
        if (dto.newPassword) {
            if (!dto.currentPassword) {
                throw new BadRequestException('Bạn phải nhập mật khẩu hiện tại để đổi mật khẩu mới');
            }
            const isMatch = await bcrypt.compare(dto.currentPassword, user.passwordHash);
            if (!isMatch) {
                throw new UnauthorizedException('Mật khẩu hiện tại không chính xác');
            }
            updateData.passwordHash = await bcrypt.hash(dto.newPassword, 10);
        }

        if (Object.keys(updateData).length === 0) {
            return { message: 'Không có thay đổi nào' };
        }

        await this.prisma.user.update({
            where: { id: userId },
            data: updateData,
        });

        return { message: 'Cập nhật thông tin thành công' };
    }
}
