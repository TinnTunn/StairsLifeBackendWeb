import { IsUUID, IsNumber, Min } from 'class-validator';

export class CreateWithdrawalDto {
  @IsUUID()
  bank_account_id: string;

  /**
   * Nominal gross yang ditarik dari saldo. Backend akan kurangi admin_fee
   * untuk dapatkan amount_net (yang sampai ke rekening).
   */
  @IsNumber()
  @Min(50_000) // WITHDRAWAL_MIN_AMOUNT default
  amount: number;
}
