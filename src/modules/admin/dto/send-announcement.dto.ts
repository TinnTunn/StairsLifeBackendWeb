import { IsString, IsNotEmpty, IsEnum } from 'class-validator';

export enum AnnouncementTarget {
  ALL = 'all',
  STUDENT = 'student',
  BUSINESS = 'bisnis',
}

export class SendAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsEnum(AnnouncementTarget)
  target: AnnouncementTarget;
}
