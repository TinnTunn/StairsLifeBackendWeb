import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  platform_fee?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  verification_sla_days?: number;
}
