import { IsString, IsOptional, IsUUID, MinLength } from 'class-validator';

export class UpdateAccountDto {
    @IsString()
    @IsOptional()
    @MinLength(3)
    username?: string;

    @IsUUID()
    @IsOptional()
    roleId?: string;
}
