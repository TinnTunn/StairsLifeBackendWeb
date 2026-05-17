import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class UploadDeliverableDto {
  @IsString()
  @IsNotEmpty()
  deliverable_url: string;

  @IsOptional()
  @IsString()
  deliverable_notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  progress_pct?: number;
}
