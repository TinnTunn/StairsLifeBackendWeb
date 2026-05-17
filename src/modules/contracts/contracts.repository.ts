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
          select: { id: true, full_name: true, email: true, rating_avg: true },
        },
        users_contracts_business_idTousers: {
          select: { id: true, full_name: true, email: true },
        },
      },
    });
  }

  async findByStudentId(studentId: string) {
    return this.prisma.contracts.findMany({
      where: { student_id: studentId },
      include: {
        projects: {
          select: { id: true, title: true, category: true, tier: true },
        },
        users_contracts_business_idTousers: {
          select: { id: true, full_name: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findByBusinessId(businessId: string) {
    return this.prisma.contracts.findMany({
      where: { business_id: businessId },
      include: {
        projects: {
          select: { id: true, title: true, category: true, tier: true },
        },
        users_contracts_student_idTousers: {
          select: { id: true, full_name: true, rating_avg: true },
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
