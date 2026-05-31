import {
  IsString,
  IsNumber,
  IsEnum,
  IsDateString,
  IsOptional,
  IsArray,
  Min,
} from 'class-validator';
import { ProjectTier } from './create-project.dto';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budget_min?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budget_max?: number;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(ProjectTier)
  tier?: ProjectTier;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  @IsString()
  deliverables?: string;
}
