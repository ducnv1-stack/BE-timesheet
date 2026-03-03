import { IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateGiftDto {
    @IsString()
    name: string;

    @IsNumber()
    @IsOptional()
    price?: number;
}
