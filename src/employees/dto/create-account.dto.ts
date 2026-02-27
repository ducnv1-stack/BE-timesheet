import { IsString, IsUUID, MinLength } from 'class-validator';

export class CreateAccountDto {
    @IsString()
    @MinLength(4)
    username: string;

    @IsString()
    @MinLength(6)
    password: string;

    @IsUUID()
    roleId: string;
}
