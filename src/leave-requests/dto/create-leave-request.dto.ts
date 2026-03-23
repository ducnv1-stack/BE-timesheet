import { IsString, IsDateString, IsOptional, IsBoolean, IsArray, IsEnum } from 'class-validator';

export enum LeaveSession {
  ALL_DAY = 'ALL_DAY',
  MORNING = 'MORNING',
  AFTERNOON = 'AFTERNOON',
}

export class CreateLeaveRequestDto {
  @IsString()
  @IsOptional()
  employeeId?: string;

  @IsString()
  leaveType: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsBoolean()
  @IsOptional()
  isRecurring?: boolean;

  @IsArray()
  @IsOptional()
  recurringDays?: number[];

  @IsEnum(LeaveSession)
  @IsOptional()
  leaveSession?: LeaveSession;

  @IsString()
  @IsOptional()
  reason?: string;
}
