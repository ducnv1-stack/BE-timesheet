import { IsString, IsUUID, MinLength } from 'class-validator';

export class CreateAccountDto {
    @IsString()
    @MinLength(4, { message: 'Tên đăng nhập phải có ít nhất 4 ký tự' })
    username: string;

    @IsString()
    @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
    password: string;

    @IsUUID()
    roleId: string;
}
