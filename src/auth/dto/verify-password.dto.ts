import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyPasswordDto {
    @IsNotEmpty()
    @IsString()
    userId: string;

    @IsNotEmpty()
    @IsString()
    password: string;
}
