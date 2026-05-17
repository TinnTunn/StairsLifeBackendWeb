import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ProjectTier } from './create-project.dto';

export class FilterProjectDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ProjectTier)
  tier?: ProjectTier;

  @IsOptional()
  @IsString()
  category?: string;
}
