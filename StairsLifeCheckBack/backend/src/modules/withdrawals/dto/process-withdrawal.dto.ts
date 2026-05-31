import { IsString, IsOptional, IsIn, MaxLength } from 'class-validator';

export class ProcessWithdrawalDto {
  @IsString()
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /**
   * Kalau true, admin pakai Xendit Disbursement API untuk transfer otomatis.
   * Kalau false (default), admin tandai completed manual (transfer via
   * mobile banking sendiri).
   */
  @IsOptional()
  use_xendit?: boolean;
}
