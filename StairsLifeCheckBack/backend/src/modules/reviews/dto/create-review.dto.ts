import {
  IsUUID,
  IsInt,
  IsString,
  IsOptional,
  IsArray,
  Min,
  Max,
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
  comment?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
