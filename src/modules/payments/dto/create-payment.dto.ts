import { IsUUID, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * DTO untuk legacy manual flow (upload bukti transfer).
 * Masih dipertahankan supaya admin bisa override / fallback emergency,
 * tapi flow utama bisnis sekarang pakai CreateInvoiceDto.
 */
export class CreatePaymentDto {
  @IsUUID()
  contract_id: string;

  @IsInt()
  @Min(10_000) // tolak 0/negatif — escrow manual harus nominal nyata
  amount: number;

  // URL bukti transfer manual (legacy).
  @IsOptional()
  @IsString()
  proof_url?: string;
}
