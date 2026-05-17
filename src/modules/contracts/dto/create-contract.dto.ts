import { IsUUID, IsNumber, IsDateString, Min } from 'class-validator';

export class CreateContractDto {
  @IsUUID()
  application_id: string;

  @IsNumber()
  @Min(0)
  agreed_budget: number;

  @IsDateString()
  deadline: string;
}
