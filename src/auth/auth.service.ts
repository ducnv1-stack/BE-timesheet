import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoginUserDto } from './dto/login-user.dto';

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
}
