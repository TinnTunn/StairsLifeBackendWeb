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

export enum UserRole {
  STUDENT = 'mahasiswa',
  BUSINESS = 'bisnis',
  ADMIN = 'admin',
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

  @IsEnum(UserRole, { message: 'Role harus: mahasiswa, bisnis, atau admin' })
  role: UserRole;

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
