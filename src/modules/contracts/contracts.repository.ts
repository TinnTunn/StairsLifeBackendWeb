import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class ContractsRepository {
  constructor(private prisma: PrismaService) {}

  async create(payload: any) {
    return this.prisma.contracts.create({
      data: {
        ...payload,
        deadline: new Date(payload.deadline),
        status: 'active' as any,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.contracts.findUnique({
      where: { id },
      include: {
        projects: {
          select: { id: true, title: true, category: true, tier: true },
        },
        users_contracts_student_idTousers: {
          select: {
            id: true,
            full_name: true,
            email: true,
            rating_avg: true,
            avatar_url: true,
          },
        },
        users_contracts_business_idTousers: {
          select: { id: true, full_name: true, email: true, avatar_url: true },
        },
      },
    });
  }

  async findByStudentId(studentId: string) {
    return this.prisma.contracts.findMany({
      where: { student_id: studentId },
      select: {
        // Scalar fields — semua yang dibutuhkan loadContractDetail
        // (FE pakai ini untuk render progress bar, deliverable history,
        // status timestamps, dll. Sebelumnya field-field ini hilang dari
        // response sehingga contract.progress_pct = undefined → tampil 0%
        // padahal di DB sudah 100%.)
        id: true,
        application_id: true,
        project_id: true,
        student_id: true,
        business_id: true,
        agreed_budget: true,
        deadline: true,
        status: true,
        progress_pct: true,
        deliverable_url: true,
        deliverable_notes: true,
        started_at: true,
        completed_at: true,
        created_at: true,
        // Relasi
        projects: {
          select: { id: true, title: true, category: true, tier: true },
        },
        users_contracts_business_idTousers: {
          select: { id: true, full_name: true, avatar_url: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findByBusinessId(businessId: string) {
    return this.prisma.contracts.findMany({
      where: { business_id: businessId },
      select: {
        // Scalar fields — semua yang dibutuhkan FE (lihat catatan di
        // findByStudentId untuk alasan kenapa semua field harus di-select).
        id: true,
        application_id: true,
        project_id: true,
        student_id: true,
        business_id: true,
        agreed_budget: true,
        deadline: true,
        status: true,
        progress_pct: true,
        deliverable_url: true,
        deliverable_notes: true,
        started_at: true,
        completed_at: true,
        created_at: true,
        // Relasi
        projects: {
          select: { id: true, title: true, category: true, tier: true },
        },
        users_contracts_student_idTousers: {
          select: {
            id: true,
            full_name: true,
            rating_avg: true,
            avatar_url: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async update(id: string, payload: any) {
    return this.prisma.contracts.update({
      where: { id },
      data: payload,
    });
  }
}
