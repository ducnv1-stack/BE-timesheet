import { IsString, IsUUID, IsOptional, IsDateString, IsBoolean } from 'class-validator';

export class CreateEmployeeDto {
    @IsString()
    fullName: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsUUID()
    branchId: string;

    @IsString()
    position: string;

    @IsOptional()
    @IsString()
    department?: string;

    @IsOptional()
    @IsUUID()
    positionId?: string;

    @IsOptional()
    @IsUUID()
    departmentId?: string;

    @IsOptional()
    @IsDateString()
    birthday?: string;

    @IsOptional()
    @IsString()
    gender?: string;

    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @IsString()
    workingType?: string;

    @IsOptional()
    @IsDateString()
    joinDate?: string;

    @IsOptional()
    @IsString()
    contractType?: string;

    @IsOptional()
    @IsDateString()
    contractSigningDate?: string;

    @IsOptional()
    @IsString()
    idCardNumber?: string;

    @IsOptional()
    @IsString()
    permanentAddress?: string;

    @IsOptional()
    @IsString()
    email?: string;

    @IsOptional()
    @IsString()
    socialInsuranceNumber?: string;

    @IsOptional()
    @IsBoolean()
    isInternalDriver?: boolean;

    @IsOptional()
    customBaseSalary?: number;

    @IsOptional()
    customDiligentSalary?: number;

    @IsOptional()
    customAllowance?: number;

    @IsOptional()
    customStandardWorkingDays?: number;

    @IsOptional()
    @IsUUID()
    attendancePolicyId?: string;
}
