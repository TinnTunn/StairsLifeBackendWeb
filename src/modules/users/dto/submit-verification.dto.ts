import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class SubmitVerificationDto {
  @IsString()
  @IsNotEmpty()
  ktm_image_url: string;

  // Selfie memegang KTM — wajib untuk verifikasi penuh.
  // Optional secara DTO karena user lama mungkin belum punya,
  // tapi frontend sekarang mensyaratkan kedua foto.
  @IsOptional()
  @IsString()
  selfie_url?: string;

  @IsString()
  @IsNotEmpty()
  university: string;

  @IsOptional()
  @IsString()
  student_id_number?: string;
}
