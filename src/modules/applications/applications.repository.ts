import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class ApplicationsRepository {
  constructor(private prisma: PrismaService) {}

  async create(payload: any) {
    return this.prisma.applications.create({
      data: {
        ...payload,
        estimated_completion: new Date(payload.estimated_completion),
        status: 'pending' as any,
      },
    });
  }

  async findByStudentId(studentId: string) {
    return this.prisma.applications.findMany({
      where: { student_id: studentId },
      include: {
        projects: {
          select: {
            id: true,
            title: true,
            budget_min: true,
            budget_max: true,
            category: true,
            tier: true,
            status: true,
            users: {
              select: { id: true, full_name: true },
            },
          },
        },
        // Include kontrak supaya frontend bisa show tombol "Lihat Kontrak"
        // dengan ID konkret (tanpa fallback ke endpoint terpisah).
        contracts: {
          select: { id: true, status: true },
          take: 1,
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findByProjectId(projectId: string) {
    return this.prisma.applications.findMany({
      where: { project_id: projectId },
      include: {
        users: {
          select: {
            id: true,
            full_name: true,
            avatar_url: true,
            tier: true,
            is_verified: true,
            rating_avg: true,
            total_projects: true,
            skills: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findById(id: string) {
    return this.prisma.applications.findUnique({
      where: { id },
    });
  }

  async findByProjectAndStudent(projectId: string, studentId: string) {
    return this.prisma.applications.findUnique({
      where: {
        project_id_student_id: {
          project_id: projectId,
          student_id: studentId,
        },
      },
      select: { id: true },
    });
  }

  async updateStatus(id: string, status: string) {
    return this.prisma.applications.update({
      where: { id },
      data: { status: status as any },
    });
  }

  async delete(id: string) {
    return this.prisma.applications.delete({ where: { id } });
  }
}
