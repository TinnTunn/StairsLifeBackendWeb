export type ContractStatus =
  | 'active'
  | 'pending_review'
  | 'completed'
  | 'disputed';

export interface ContractEntity {
  id: string;
  project_id: string;
  student_id: string;
  business_id: string;
  application_id: string;
  agreed_budget: number;
  deadline: string;
  status: ContractStatus;
  progress_pct: number;
  deliverable_url?: string;
  deliverable_notes?: string;
  started_at: string;
  completed_at?: string;
  created_at: string;
}
