import { IsUUID, IsNumber, Min } from 'class-validator';

export class CreatePaymentDto {
  @IsUUID()
  contract_id: string;

  @IsNumber()
  @Min(0)
  amount: number;
}
