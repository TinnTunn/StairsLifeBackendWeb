import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsOptional,
  IsNumber,
  IsUUID,
  MinLength,
  Min,
} from 'class-validator';

export class CreateApplicationDto {
  @IsUUID()
  project_id: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(50, { message: 'Cover letter minimal 50 karakter' })
  cover_letter: string;

  @IsDateString()
  estimated_completion: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  offered_budget?: number;
}
