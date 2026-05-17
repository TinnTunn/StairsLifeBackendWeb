import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum DisputeAction {
  UNDER_REVIEW = 'underReview',
  RESOLVED = 'resolved',
}

export class ResolveDisputeDto {
  @IsEnum(DisputeAction)
  status: DisputeAction;

  @IsOptional()
  @IsString()
  admin_notes?: string;
}
