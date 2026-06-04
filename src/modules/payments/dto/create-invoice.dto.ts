import { IsUUID, IsInt, IsNumber, IsOptional, Min, Max } from 'class-validator';

/**
 * DTO untuk endpoint POST /payments/invoice — bisnis trigger pembayaran
 * via Xendit. Backend akan:
 *   1. Validate kontrak + bisnis = pemilik
 *   2. Hitung platform fee + net amount
 *   3. Create Xendit invoice
 *   4. Save payment record dengan status='pending' + xendit_invoice_url
 *   5. Return invoice_url ke FE → FE redirect / buka tab
 */
export class CreateInvoiceDto {
  @IsUUID()
  contract_id: string;

  /**
   * Total yang ditagih (gross, sebelum potongan fee).
   * Backend yang akan hitung platform_fee & net_amount dari settings.
   */
  @IsInt() // wajib bilangan bulat — kolom payments.amount = Int, fee/net dihitung dari sini
  @Min(10_000) // minimum Rp 10.000 (Xendit hard min Rp 1.500 untuk QRIS, kita pakai 10k untuk safety)
  @Max(100_000_000) // selaras dgn cap FE; jauh di bawah ceiling Int (~Rp 2,1 M)
  amount: number;

  /**
   * Optional: kustomisasi durasi invoice valid (detik).
   * Default 24 jam. Maks 30 hari di Xendit.
   */
  @IsOptional()
  @IsNumber()
  @Min(900) // minimal 15 menit
  invoice_duration?: number;
}
