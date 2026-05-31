export type ProjectStatus =
  | 'open'
  | 'inProgress'
  | 'completed'
  | 'disputed'
  | 'cancelled';
export type ProjectTier = 'pemula' | 'menengah' | 'mahir';

export interface ProjectEntity {
  id: string;
  title: string;
  description: string;
  budget_min: number;
  budget_max: number;
  deadline: string;
  category: string;
  tier: ProjectTier;
  skills?: string[];
  deliverables?: string;
  status: ProjectStatus;
  business_id: string;
  applicant_count: number;
  created_at: string;
  updated_at: string;
}
