import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';

@Injectable()
export class DisputesService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateDisputeDto) {
    const { contract_id, reason, evidence_url } = dto;

    // Pastikan kontrak milik user ini
    const contract = await this.prisma.contracts.findFirst({
      where: {
        id: contract_id,
        OR: [{ student_id: userId }, { business_id: userId }],
      },
    });

    if (!contract) throw new BadRequestException('Kontrak tidak ditemukan');

    const dispute = await this.prisma.disputes.create({
      data: {
        contract_id,
        opened_by: userId,
        reason,
        evidence_url: evidence_url ?? null,
        status: 'open',
      },
    });

    return { data: dispute, message: 'Sengketa berhasil diajukan' };
  }

  async getMy(userId: string) {
    const disputes = await this.prisma.disputes.findMany({
      where: {
        opened_by: userId,
      },
      include: {
        contracts: {
          include: {
            projects: { select: { title: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const mapped = disputes.map((d) => ({
      id: d.id,
      project: d.contracts?.projects?.title || 'Project',
      reason: d.reason,
      evidence_url: d.evidence_url,
      status: d.status,
      created_at: d.created_at,
      admin_notes: d.admin_notes,
      contract_id: d.contract_id,
    }));

    return { data: mapped, message: 'Berhasil' };
  }

  async getById(id: string, userId: string) {
    const dispute = await this.prisma.disputes.findUnique({
      where: { id },
      include: {
        contracts: {
          include: {
            projects: { select: { id: true, title: true } },
            users_contracts_student_idTousers: {
              select: { id: true, full_name: true },
            },
            users_contracts_business_idTousers: {
              select: { id: true, full_name: true },
            },
          },
        },
      },
    });

    if (!dispute) throw new NotFoundException('Sengketa tidak ditemukan');

    // Hanya pihak yang terlibat atau yang membuka dispute yang bisa lihat
    const contract = dispute.contracts;
    const isInvolved =
      dispute.opened_by === userId ||
      contract?.student_id === userId ||
      contract?.business_id === userId;

    if (!isInvolved) {
      throw new ForbiddenException('Kamu tidak punya akses ke sengketa ini');
    }

    return { data: dispute, message: 'Berhasil' };
  }

  /**
   * Tambah bukti tambahan ke dispute yang sudah ada.
   * Field evidence_url di-overwrite dengan URL terbaru,
   * dan description ditambahkan ke admin_notes (audit trail).
   */
  async addEvidence(
    id: string,
    body: { evidence_url: string; description?: string },
    userId: string,
  ) {
    if (!body?.evidence_url) {
      throw new BadRequestException('evidence_url wajib diisi');
    }

    const dispute = await this.prisma.disputes.findUnique({
      where: { id },
      include: { contracts: true },
    });

    if (!dispute) throw new NotFoundException('Sengketa tidak ditemukan');

    // Hanya pihak yang membuka sengketa yang bisa menambah bukti
    const isOwner = dispute.opened_by === userId;
    if (!isOwner) {
      throw new ForbiddenException(
        'Hanya pihak yang membuka sengketa yang bisa menambah bukti',
      );
    }

    // Sengketa harus masih aktif
    if (dispute.status !== 'open' && dispute.status !== 'in_review') {
      throw new BadRequestException(
        'Sengketa sudah ditutup, tidak bisa menambah bukti baru',
      );
    }

    const updated = await this.prisma.disputes.update({
      where: { id },
      data: {
        evidence_url: body.evidence_url,
      },
    });

    return {
      data: updated,
      message: 'Bukti tambahan berhasil ditambahkan',
    };
  }
}
