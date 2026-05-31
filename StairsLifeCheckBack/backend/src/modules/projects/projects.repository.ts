import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { FilterProjectDto } from './dto/filter-project.dto';

@Injectable()
export class ProjectsRepository {
  constructor(private prisma: PrismaService) {}

  async findAll(filter: FilterProjectDto) {
    return this.prisma.projects.findMany({
      where: {
        status: 'open',
        ...(filter.tier && { tier: filter.tier as any }),
        ...(filter.category && {
          category: { contains: filter.category, mode: 'insensitive' },
        }),
        ...(filter.search && {
          OR: [
            { title: { contains: filter.search, mode: 'insensitive' } },
            { description: { contains: filter.search, mode: 'insensitive' } },
          ],
        }),
      },
      include: {
        users: {
          select: { id: true, full_name: true, is_verified: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findById(id: string) {
    return this.prisma.projects.findUnique({
      where: { id },
      include: {
        users: {
          select: { id: true, full_name: true, is_verified: true },
        },
      },
    });
  }

  async findByBusinessId(businessId: string) {
    return this.prisma.projects.findMany({
      where: { business_id: businessId },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Cari project identik dari business yang sama yang dibuat
   * dalam window waktu tertentu. Dipakai oleh idempotency guard
   * di createProject untuk menangkap double-submit accidental.
   * Kalau tidak ada match, return null — caller boleh proceed create.
   */
  async findRecentDuplicate(args: {
    businessId: string;
    title: string;
    budgetMin: number;
    budgetMax: number;
    deadline: Date;
    category: string;
    since: Date;
  }) {
    return this.prisma.projects.findFirst({
      where: {
        business_id: args.businessId,
        title: args.title,
        budget_min: args.budgetMin,
        budget_max: args.budgetMax,
        deadline: args.deadline,
        category: args.category,
        created_at: { gte: args.since },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async create(payload: any) {
    return this.prisma.projects.create({
      data: payload,
    });
  }

  async update(id: string, payload: any) {
    if (payload.deadline && typeof payload.deadline === 'string') {
      payload.deadline = new Date(payload.deadline);
    }
    return this.prisma.projects.update({
      where: { id },
      data: payload,
    });
  }

  async delete(id: string) {
    return this.prisma.projects.delete({
      where: { id },
    });
  }
}
