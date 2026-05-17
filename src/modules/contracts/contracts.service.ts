import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ContractsRepository } from './contracts.repository';
import { ApplicationsRepository } from '../applications/applications.repository';
import { ProjectsRepository } from '../projects/projects.repository';
import { PrismaService } from '../../config/prisma.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UploadDeliverableDto } from './dto/upload-deliverable.dto';

@Injectable()
export class ContractsService {
  constructor(
    private contractsRepository: ContractsRepository,
    private applicationsRepository: ApplicationsRepository,
    private projectsRepository: ProjectsRepository,
    private prisma: PrismaService,
  ) {}

  async createContract(dto: CreateContractDto, businessId: string) {
    const application = await this.applicationsRepository.findById(
      dto.application_id,
    );
    if (!application) throw new NotFoundException('Lamaran tidak ditemukan');

    const project = await this.projectsRepository.findById(
      application.project_id,
    );
    if (project.business_id !== businessId)
      throw new ForbiddenException('Kamu tidak punya akses');
    if (application.status !== 'approved')
      throw new BadRequestException('Lamaran harus di-approve dulu');

    const contract = await this.contractsRepository.create({
      project_id: application.project_id,
      student_id: application.student_id,
      business_id: businessId,
      application_id: dto.application_id,
      agreed_budget: dto.agreed_budget,
      deadline: dto.deadline,
      status: 'active',
      progress_pct: 0,
      started_at: new Date(),
    });

    await this.projectsRepository.update(application.project_id, {
      status: 'inProgress',
    });
    return { data: contract, message: 'Kontrak berhasil dibuat' };
  }

  async getMyContracts(userId: string, role: string) {
    const contracts =
      role === 'mahasiswa'
        ? await this.contractsRepository.findByStudentId(userId)
        : await this.contractsRepository.findByBusinessId(userId);
    return { data: contracts, message: 'Berhasil' };
  }

  async getContractById(id: string, userId: string) {
    const contract = await this.contractsRepository.findById(id);
    if (!contract) throw new NotFoundException('Kontrak tidak ditemukan');
    if (contract.student_id !== userId && contract.business_id !== userId) {
      throw new ForbiddenException('Kamu tidak punya akses ke kontrak ini');
    }
    return { data: contract, message: 'Berhasil' };
  }

  async uploadDeliverable(
    id: string,
    dto: UploadDeliverableDto,
    studentId: string,
  ) {
    const contract = await this.contractsRepository.findById(id);
    if (!contract) throw new NotFoundException('Kontrak tidak ditemukan');
    if (contract.student_id !== studentId)
      throw new ForbiddenException(
        'Hanya mahasiswa yang mengerjakan yang bisa upload',
      );
    if (contract.status !== 'active')
      throw new BadRequestException('Kontrak tidak dalam status aktif');

    // Simpan ke history deliverables
    await this.prisma.contract_deliverables.create({
      data: {
        contract_id: id,
        deliverable_url: dto.deliverable_url,
        deliverable_notes: dto.deliverable_notes,
        status: 'pending',
        submitted_at: new Date(),
      },
    });

    const updated = await this.contractsRepository.update(id, {
      deliverable_url: dto.deliverable_url,
      deliverable_notes: dto.deliverable_notes,
      progress_pct: dto.progress_pct ?? 100,
      status: 'pending_review',
    });

    return { data: updated, message: 'Deliverable berhasil diupload' };
  }

  async approveDeliverable(id: string, businessId: string) {
    const contract = await this.contractsRepository.findById(id);
    if (!contract) throw new NotFoundException('Kontrak tidak ditemukan');
    if (contract.business_id !== businessId)
      throw new ForbiddenException('Hanya klien yang bisa approve deliverable');
    if (contract.status !== 'pending_review')
      throw new BadRequestException(
        'Kontrak tidak dalam status pending review',
      );

    const updated = await this.contractsRepository.update(id, {
      status: 'completed',
      progress_pct: 100,
      completed_at: new Date(),
    });

    // Update history deliverable terakhir jadi approved
    await this.prisma.contract_deliverables.updateMany({
      where: { contract_id: id, status: 'pending' },
      data: {
        status: 'approved',
        reviewed_at: new Date(),
        reviewed_by: businessId,
      },
    });

    await this.projectsRepository.update(contract.project_id, {
      status: 'completed',
    });

    // Update student total_projects — ini SATU-SATUNYA tempat increment.
    // (Sebelumnya juga di-increment di ReviewsService.create — sudah dihapus.)
    const updatedStudent = await this.prisma.users.update({
      where: { id: contract.student_id },
      data: { total_projects: { increment: 1 } },
    });

    // Auto-upgrade tier berdasarkan total_projects + rating_avg.
    // rating_avg adalah Decimal di schema → convert ke Number untuk perbandingan.
    await this._autoUpgradeTier(
      contract.student_id,
      updatedStudent.total_projects ?? 0,
      Number(updatedStudent.rating_avg ?? 0),
      updatedStudent.tier ?? 'pemula',
    );

    // Auto-release escrow payment kalau ada.
    // Sebelumnya FE harus orchestrate dua call (approve + release).
    // Sekarang backend juga melakukannya sebagai safety net.
    // Idempotent: kalau payment sudah released, update tetap aman.
    try {
      await this.prisma.payments.updateMany({
        where: { contract_id: id, status: 'held' as any },
        data: {
          status: 'released' as any,
          released_at: new Date(),
        },
      });
    } catch (e) {
      // Tidak fatal — escrow release bisa di-retry manual.
      // Jangan throw supaya approve deliverable tetap sukses.
      // (Log warning sudah cukup; user akan dapat info di FE.)
      console.warn('[approveDeliverable] auto-release escrow failed:', e);
    }

    return {
      data: updated,
      message: 'Deliverable disetujui, kontrak selesai!',
    };
  }

  /**
   * Naikkan tier mahasiswa otomatis berdasarkan jumlah project + rating.
   * Threshold:
   *   - mahir:    total ≥ 50 dan rating ≥ 4.0
   *   - menengah: total ≥ 25 dan rating ≥ 3.5
   *   - pemula:   default
   */
  private async _autoUpgradeTier(
    studentId: string,
    totalProjects: number,
    avgRating: number,
    currentTier: string,
  ): Promise<void> {
    let newTier: 'pemula' | 'menengah' | 'mahir' = 'pemula';
    if (totalProjects >= 50 && avgRating >= 4.0) {
      newTier = 'mahir';
    } else if (totalProjects >= 25 && avgRating >= 3.5) {
      newTier = 'menengah';
    }

    if (newTier !== currentTier) {
      await this.prisma.users.update({
        where: { id: studentId },
        data: { tier: newTier as any },
      });
    }
  }

  async rejectDeliverable(id: string, body: any, businessId: string) {
    const contract = await this.contractsRepository.findById(id);
    if (!contract) throw new NotFoundException('Kontrak tidak ditemukan');
    if (contract.business_id !== businessId)
      throw new ForbiddenException('Hanya klien yang bisa reject deliverable');
    if (contract.status !== 'pending_review')
      throw new BadRequestException(
        'Kontrak tidak dalam status pending review',
      );

    const reason =
      body?.reason || 'Deliverable tidak sesuai, silakan upload ulang';

    // Update history deliverable terakhir jadi rejected
    await this.prisma.contract_deliverables.updateMany({
      where: { contract_id: id, status: 'pending' },
      data: {
        status: 'rejected',
        rejection_reason: reason,
        reviewed_at: new Date(),
        reviewed_by: businessId,
      },
    });

    const updated = await this.contractsRepository.update(id, {
      status: 'active',
      deliverable_url: null,
      deliverable_notes: reason,
      progress_pct: 50,
    });

    return {
      data: updated,
      message: 'Deliverable ditolak, mahasiswa perlu upload ulang',
    };
  }

  async getDeliverableHistory(contractId: string, userId: string) {
    const contract = await this.contractsRepository.findById(contractId);
    if (!contract) throw new NotFoundException('Kontrak tidak ditemukan');
    if (contract.student_id !== userId && contract.business_id !== userId) {
      throw new ForbiddenException('Tidak punya akses');
    }

    const history = await this.prisma.contract_deliverables.findMany({
      where: { contract_id: contractId },
      include: {
        users: { select: { id: true, full_name: true } },
      },
      orderBy: { submitted_at: 'desc' },
    });

    return { data: history, message: 'Berhasil' };
  }
}
