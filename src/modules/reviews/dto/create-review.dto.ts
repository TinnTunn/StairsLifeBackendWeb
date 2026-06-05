import {
  IsUUID,
  IsInt,
  IsString,
  IsOptional,
  IsArray,
  Min,
  Max,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';

export class CreateReviewDto {
  @IsUUID()
  contract_id: string;

  @IsInt()
  @Min(1, { message: 'Rating minimal 1' })
  @Max(5, { message: 'Rating maksimal 5' })
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Komentar maksimal 2000 karakter' })
  comment?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15, { message: 'Maksimal 15 tag' })
  @IsString({ each: true })
  @MaxLength(40, { each: true, message: 'Tiap tag maksimal 40 karakter' })
  tags?: string[];
}
