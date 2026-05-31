import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SuspendUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Alasan maksimal 500 karakter' })
  reason?: string;
}
