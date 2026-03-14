import { IsString, IsNotEmpty, IsEnum, IsOptional, IsUUID } from 'class-validator';

export enum RequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export class UpdateExceptionRequestStatusDto {
  @IsEnum(RequestStatus)
  @IsNotEmpty()
  status: RequestStatus;

  @IsString()
  @IsOptional()
  note?: string;

  @IsUUID()
  @IsNotEmpty()
  approvedById: string;
}
