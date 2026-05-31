import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectDeliverableDto {
  // Frontend mengirim field `reason` (bukan `rejection_reason`) — DTO
  // disesuaikan supaya match. Service menerima body apa adanya dan
  // mengakses property `reason` untuk membaca nilai.
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Alasan penolakan maksimal 1000 karakter' })
  reason?: string;
}
