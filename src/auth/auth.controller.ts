import { Body, Controller, Post, Get, Patch, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginUserDto } from './dto/login-user.dto';
import { VerifyPasswordDto } from './dto/verify-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('login')
    @HttpCode(HttpStatus.OK)
    async login(@Body() loginUserDto: LoginUserDto) {
        return this.authService.login(loginUserDto);
    }

    @Get('status/:id')
    async getStatus(@Param('id') id: string) {
        return this.authService.validateUserStatus(id);
    }

    @Post('verify-password')
    @HttpCode(HttpStatus.OK)
    async verifyPassword(@Body() verifyPasswordDto: VerifyPasswordDto) {
        return this.authService.verifyPassword(verifyPasswordDto);
    }

    @Get('profile/:userId')
    async getProfile(@Param('userId') userId: string) {
        return this.authService.getProfile(userId);
    }

    @Patch('profile/:userId')
    async updateProfile(
        @Param('userId') userId: string,
        @Body() updateProfileDto: UpdateProfileDto,
    ) {
        return this.authService.updateProfile(userId, updateProfileDto);
    }
}
