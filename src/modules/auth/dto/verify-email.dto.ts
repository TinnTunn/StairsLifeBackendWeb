import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class VerifyEmailDto {
  // base64url token, ~43 chars. Validasi panjang biar reject input absurd.
  @IsString()
  @IsNotEmpty()
  @MinLength(20, { message: 'Token tidak valid' })
  @MaxLength(200, { message: 'Token tidak valid' })
  token: string;
}
