import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  MinLength,
} from 'class-validator';

/**
 * Role yang BOLEH dipilih lewat endpoint register publik.
 *
 * Sebelumnya enum ini juga berisi ADMIN — siapa pun bisa POST
 * /auth/register dengan `"role": "admin"` dan langsung punya akses
 * admin (privilege escalation kritis).
 *
 * Admin harus dibuat lewat jalur khusus (seed script / migration),
 * BUKAN lewat register publik.
 */
export enum PublicUserRole {
  STUDENT = 'mahasiswa',
  BUSINESS = 'bisnis',
}

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  full_name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password minimal 8 karakter' })
  password: string;

  @IsEnum(PublicUserRole, {
    message: 'Role harus: mahasiswa atau bisnis',
  })
  role: PublicUserRole;

  // Field opsional untuk profil mahasiswa
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

  // Field opsional untuk profil bisnis
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  company_name?: string;
}
