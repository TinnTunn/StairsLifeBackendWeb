export type PaymentStatus =
  | 'pending'
  | 'held'
  | 'released'
  | 'refunded'
  | 'split_settled'
  | 'expired'
  | 'failed';

export interface PaymentEntity {
  id: string;
  contract_id: string;
  amount: number;
  platform_fee: number;
  net_amount: number;
  status: PaymentStatus;
  payer_id: string;
  payee_id: string;
  proof_url?: string;
  // Xendit fields
  xendit_external_id?: string;
  xendit_invoice_id?: string;
  xendit_invoice_url?: string;
  payment_method?: string;
  payment_channel?: string;
  expires_at?: string;
  paid_at?: string;
  held_at?: string;
  released_at?: string;
  created_at: string;
}
