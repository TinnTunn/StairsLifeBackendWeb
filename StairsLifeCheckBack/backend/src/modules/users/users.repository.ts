import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

/**
 * Field yang aman untuk di-expose ke frontend.
 * password_hash sengaja TIDAK ada di sini.
 */
const PUBLIC_USER_SELECT = {
  id: true,
  full_name: true,
  email: true,
  role: true,
  tier: true,
  is_verified: true,
  is_suspended: true,
  suspension_reason: true,
  avatar_url: true,
  bio: true,
  university: true,
  major: true,
  semester: true,
  phone: true,
  company_name: true,
  business_type: true,
  location: true,
  skills: true,
  portfolio_url: true,
  rating_avg: true,
  total_projects: true,
  created_at: true,
  updated_at: true,
} as const;

@Injectable()
export class UsersRepository {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.users.findUnique({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });
  }

  async findByEmail(email: string) {
    return this.prisma.users.findUnique({
      where: { email },
      select: PUBLIC_USER_SELECT,
    });
  }

  async update(id: string, payload: any) {
    return this.prisma.users.update({
      where: { id },
      data: { ...payload, updated_at: new Date() },
      select: PUBLIC_USER_SELECT,
    });
  }

  async findAll() {
    return this.prisma.users.findMany({
      select: {
        id: true,
        full_name: true,
        email: true,
        role: true,
        tier: true,
        is_verified: true,
        is_suspended: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }
}
