import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

/**
 * DTO untuk POST /auth/suspended-appeal — user yang akunnya disuspend
 * (tidak bisa login) mengirim banding/konsultasi ke admin.
 */
export class SuspendedAppealDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(5, { message: 'Pesan minimal 5 karakter' })
  @MaxLength(1000, { message: 'Pesan maksimal 1000 karakter' })
  message: string;
}
