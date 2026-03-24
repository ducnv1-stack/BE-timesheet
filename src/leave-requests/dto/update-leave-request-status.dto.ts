import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum LeaveRequestStatus {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export class UpdateLeaveRequestStatusDto {
  @IsEnum(LeaveRequestStatus)
  status: LeaveRequestStatus;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  approvedById?: string;
}
