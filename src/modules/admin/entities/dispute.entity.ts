export type DisputeStatus = 'open' | 'underReview' | 'resolved';

export interface DisputeEntity {
  id: string;
  contract_id: string;
  opened_by: string;
  reason: string;
  status: DisputeStatus;
  admin_notes?: string;
  resolved_by?: string;
  created_at: string;
  resolved_at?: string;
}
