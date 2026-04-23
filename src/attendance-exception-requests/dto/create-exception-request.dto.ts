import { IsString, IsNotEmpty, IsOptional, IsEnum, IsDateString, IsUUID, IsArray } from 'class-validator';

export enum ExceptionType {
  GO_LATE = 'GO_LATE',
  LEAVE_EARLY = 'LEAVE_EARLY',
  GPS_ERROR = 'GPS_ERROR',
  FORGOT_CHECKIN = 'FORGOT_CHECKIN',
  FORGOT_CHECKOUT = 'FORGOT_CHECKOUT',
}

export class CreateExceptionRequestDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId: string;

  @IsUUID()
  @IsOptional()
  attendanceId?: string;

  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsEnum(ExceptionType)
  @IsNotEmpty()
  type: ExceptionType;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsOptional()
  actualTime?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[];
}
