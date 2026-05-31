export type ApplicationStatus =
  | 'pending'
  | 'shortlisted'
  | 'approved'
  | 'rejected';

export interface ApplicationEntity {
  id: string;
  project_id: string;
  student_id: string;
  cover_letter: string;
  estimated_completion: string;
  offered_budget?: number;
  status: ApplicationStatus;
  created_at: string;
}
