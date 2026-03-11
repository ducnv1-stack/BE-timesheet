import { IsNumber, IsOptional } from 'class-validator';

export class UpdateRoleDto {
    @IsOptional()
    @IsNumber()
    baseSalary?: number;

    @IsOptional()
    @IsNumber()
    diligentSalary?: number;

    @IsOptional()
    @IsNumber()
    allowance?: number;

    @IsOptional()
    @IsNumber()
    standardWorkingDays?: number;
}
