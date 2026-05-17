import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class SubmitVerificationDto {
  @IsString()
  @IsNotEmpty()
  ktm_image_url: string;

  @IsString()
  @IsNotEmpty()
  university: string;

  @IsOptional()
  @IsString()
  student_id_number?: string;
}
