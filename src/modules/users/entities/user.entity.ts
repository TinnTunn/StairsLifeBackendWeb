export type UserRole = 'mahasiswa' | 'bisnis' | 'admin';
export type UserTier = 'pemula' | 'menengah' | 'mahir';

export interface UserEntity {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  tier: UserTier;
  is_verified: boolean;
  avatar_url?: string;
  bio?: string;
  university?: string;
  major?: string;
  semester?: number;
  skills?: string[];
  portfolio_url?: string;
  rating_avg?: number;
  total_projects?: number;
  created_at: string;
  updated_at: string;
}
