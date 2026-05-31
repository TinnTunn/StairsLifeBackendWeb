import {
  IsUUID,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * DTO untuk legacy manual flow (upload bukti transfer).
 * Masih dipertahankan supaya admin bisa override / fallback emergency,
 * tapi flow utama bisnis sekarang pakai CreateInvoiceDto.
 */
export class CreatePaymentDto {
  @IsUUID()
  contract_id: string;

  @IsNumber()
  @Min(0)
  amount: number;

  // URL bukti transfer manual (legacy).
  @IsOptional()
  @IsString()
  proof_url?: string;
}
