import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class PaymentsRepository {
  constructor(private prisma: PrismaService) {}

  async create(payload: any) {
    return this.prisma.payments.create({
      data: {
        ...payload,
        status: 'held' as any,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.payments.findUnique({
      where: { id },
      include: {
        contracts: {
          select: {
            id: true,
            agreed_budget: true,
            status: true,
            projects: {
              select: { id: true, title: true },
            },
          },
        },
      },
    });
  }

  async findByContractId(contractId: string) {
    return this.prisma.payments.findFirst({
      where: { contract_id: contractId },
    });
  }

  async findByUserId(userId: string) {
    return this.prisma.payments.findMany({
      where: {
        OR: [{ payer_id: userId }, { payee_id: userId }],
      },
      include: {
        contracts: {
          select: {
            id: true,
            agreed_budget: true,
            projects: {
              select: { id: true, title: true },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async update(id: string, payload: any) {
    return this.prisma.payments.update({
      where: { id },
      data: payload,
    });
  }
}
