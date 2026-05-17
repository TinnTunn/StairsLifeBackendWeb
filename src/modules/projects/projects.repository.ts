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
