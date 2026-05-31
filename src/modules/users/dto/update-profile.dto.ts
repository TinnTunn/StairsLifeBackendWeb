import {
  IsString,
  IsOptional,
  IsInt,
  IsArray,
  IsUrl,
  Min,
  Max,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  full_name?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  // Profil mahasiswa
  @IsOptional()
  @IsString()
  university?: string;

  @IsOptional()
  @IsString()
  major?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(14)
  semester?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  // Izinkan URL tanpa protokol (instagram.com/foo) — FE akan auto-prefix https://
  // sebelum kirim, tapi validator harus tetap menerima yang sudah valid.
  @IsUrl({ require_protocol: false, require_tld: true })
  portfolio_url?: string;

  // Profil bisnis
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  company_name?: string;

  @IsOptional()
  @IsString()
  business_type?: string;

  @IsOptional()
  @IsString()
  location?: string;

  // Avatar (bisa dipakai mahasiswa maupun bisnis)
  @IsOptional()
  @IsString()
  avatar_url?: string;
}
