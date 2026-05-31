import { IsEnum, IsNotEmpty } from 'class-validator';

export enum ApplicationStatus {
  PENDING = 'pending',
  SHORTLISTED = 'shortlisted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export class UpdateApplicationStatusDto {
  @IsEnum(ApplicationStatus)
  @IsNotEmpty()
  status: ApplicationStatus;
}
