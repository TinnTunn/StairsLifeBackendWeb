import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum VerificationAction {
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export class ReviewVerificationDto {
  @IsEnum(VerificationAction)
  status: VerificationAction;

  @IsOptional()
  @IsString()
  rejection_reason?: string;
}
