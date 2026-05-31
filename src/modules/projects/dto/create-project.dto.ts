import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsDateString,
  IsOptional,
  IsArray,
  Min,
} from 'class-validator';

export enum ProjectTier {
  PEMULA = 'pemula',
  MENENGAH = 'menengah',
  MAHIR = 'mahir',
}

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @Min(0)
  budget_min: number;

  @IsNumber()
  @Min(0)
  budget_max: number;

  @IsDateString()
  deadline: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsEnum(ProjectTier)
  tier: ProjectTier;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  @IsString()
  deliverables?: string;
}
