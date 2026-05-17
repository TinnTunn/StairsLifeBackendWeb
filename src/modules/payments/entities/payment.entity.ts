export type PaymentStatus = 'pending' | 'held' | 'released' | 'refunded';

export interface PaymentEntity {
  id: string;
  contract_id: string;
  amount: number;
  platform_fee: number;
  net_amount: number;
  status: PaymentStatus;
  payer_id: string;
  payee_id: string;
  held_at?: string;
  released_at?: string;
  created_at: string;
}
