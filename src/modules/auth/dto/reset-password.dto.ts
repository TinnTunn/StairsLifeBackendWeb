import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(20, { message: 'Token tidak valid' })
  @MaxLength(200, { message: 'Token tidak valid' })
  token: string;

  @IsString()
  @MinLength(8, { message: 'Password minimal 8 karakter' })
  @MaxLength(128, { message: 'Password maksimal 128 karakter' })
  new_password: string;
}

export class ResendVerificationDto {
  @IsString()
  @IsNotEmpty()
  email: string;
}
