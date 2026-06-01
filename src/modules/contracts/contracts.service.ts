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
import { NotificationsService } from '../notifications/notifications.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UploadDeliverableDto } from './dto/upload-deliverable.dto';

@Injectable()
export class ContractsService {
  constructor(
    private contractsRepository: ContractsRepository,
    private applicationsRepository: ApplicationsRepository,
    private projectsRepository: ProjectsRepository,
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  async createContract(dto: CreateContractDto, businessId: string) {
    const application = await this.applicationsRepository.findById(
      dto.application_id,
    );
    if (!application) throw new NotFoundException('Lamaran tidak ditemukan');

    const project = await this.projectsRepository.findById(
      application.project_id,
    );
    if (!project) {
      throw new NotFoundException(
        'Project untuk lamaran ini tidak ditemukan (mungkin sudah dihapus)',
      );
    }
    if (project.business_id !== businessId)
      throw new ForbiddenException('Kamu tidak punya akses');
    if (application.status !== 'approved')
      throw new BadRequestException('Lamaran harus di-approve dulu');

    // Idempotent: kalau kontrak untuk application_id ini SUDAH ADA, kembalikan
    // yang ada — JANGAN error. Ini mencegah double-contract (klik 2x) sekaligus
    // membuat alur bisa dilanjutkan: mis. kontrak sudah dibuat tapi pembayaran
    // Xendit belum selesai → bisnis bisa "Bayar ulang" tanpa buntu.
    const existingContract = await this.prisma.contracts.findFirst({
      where: { application_id: dto.application_id },
    });
    if (existingContract) {
      return {
        data: existingContract,
        message: 'Kontrak sudah ada, lanjut ke pembayaran',
      };
    }

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

    // Notif ke mahasiswa: kontrak aktif, bisa mulai kerja
    void this.notificationsService.create({
      user_id: application.student_id,
      type: 'contract',
      title: '📋 Kontrak Aktif!',
      body: `Kontrak untuk "${project.title}" sudah aktif. Budget Rp ${Number(dto.agreed_budget).toLocaleString('id-ID')}. Mulai kerjakan dan upload deliverable-mu!`,
      ref_id: contract.id,
      action_url: `/contracts/${contract.id}`,
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

    // Normalise URLs: bisa dari single field atau array.
    // - Kalau dto.deliverable_urls ada (array), pakai itu.
    // - Kalau hanya dto.deliverable_url (string), wrap ke array.
    // - Storage: simpan sebagai JSON string ["url1","url2"] di kolom TEXT.
    //   Tidak perlu migration — kolom deliverable_url sudah TEXT.
    //   Frontend tahu ini JSON kalau string-nya dimulai dengan '['
    const rawUrls: string[] = dto.deliverable_urls?.length
      ? dto.deliverable_urls
      : dto.deliverable_url
        ? [dto.deliverable_url]
        : [];

    if (rawUrls.length === 0) {
      throw new BadRequestException('Minimal 1 file harus diupload');
    }

    // Simpan sebagai JSON array kalau > 1 file, plain string kalau 1 file
    // (backward compat dengan data lama yang simpan single URL).
    const storedUrl = rawUrls.length === 1
      ? rawUrls[0]
      : JSON.stringify(rawUrls);

    // Simpan ke history deliverables
    await this.prisma.contract_deliverables.create({
      data: {
        contract_id: id,
        deliverable_url: storedUrl,
        deliverable_notes: dto.deliverable_notes,
        status: 'pending',
        submitted_at: new Date(),
      },
    });

    const updated = await this.contractsRepository.update(id, {
      deliverable_url: storedUrl,
      deliverable_notes: dto.deliverable_notes,
      progress_pct: dto.progress_pct ?? 100,
      status: 'pending_review',
    });

    // Notif ke bisnis: deliverable masuk, perlu di-review
    const project = await this.projectsRepository.findById(contract.project_id);
    void this.notificationsService.create({
      user_id: contract.business_id,
      type: 'contract',
      title: '📦 Deliverable Diterima',
      body: `Mahasiswa sudah submit ${rawUrls.length > 1 ? `${rawUrls.length} file` : 'deliverable'} untuk "${project?.title || 'project'}". Silakan review dan approve.`,
      ref_id: contract.id,
      action_url: `/contracts/${contract.id}`,
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
    const tierBefore = updatedStudent.tier ?? 'pemula';
    const tierAfter = await this._autoUpgradeTier(
      contract.student_id,
      updatedStudent.total_projects ?? 0,
      Number(updatedStudent.rating_avg ?? 0),
      tierBefore,
    );

    // Auto-release escrow payment kalau ada.
    // Atomic: status payment 'held' → 'released' + wallet mahasiswa +
    // wallet_transaction log, semua di 1 $transaction.
    // Idempotent: kalau payment sudah released, transaction kosong tapi
    // tidak error.
    let escrowReleased = false;
    const releasedAt = new Date();
    let releasedNetAmount = 0;
    try {
      await this.prisma.$transaction(async (tx) => {
        // Cari semua payment 'held' untuk kontrak ini (biasanya 1)
        const heldPayments = await tx.payments.findMany({
          where: { contract_id: id, status: 'held' as any },
        });
        if (heldPayments.length === 0) return;

        // Update status semuanya
        await tx.payments.updateMany({
          where: { contract_id: id, status: 'held' as any },
          data: {
            status: 'released' as any,
            released_at: releasedAt,
          },
        });

        // Tambah ke wallet mahasiswa untuk setiap payment
        // (umumnya cuma 1, tapi safety: loop semua)
        for (const p of heldPayments) {
          // Upsert wallet
          const wallet = await tx.wallets.upsert({
            where: { user_id: contract.student_id },
            update: {},
            create: { user_id: contract.student_id },
          });

          await tx.wallets.update({
            where: { id: wallet.id },
            data: {
              amount: { increment: p.net_amount },
              total_earned: { increment: p.net_amount },
              updated_at: new Date(),
            },
          });

          await tx.wallet_transactions.create({
            data: {
              wallet_id: wallet.id,
              user_id: contract.student_id,
              type: 'earn_release',
              amount: BigInt(p.net_amount),
              ref_type: 'payment',
              ref_id: p.id,
              description: `Pembayaran kontrak ${contract.id.slice(0, 8)}`,
            },
          });

          releasedNetAmount += p.net_amount;
        }

        escrowReleased = true;
      });
    } catch (e) {
      console.warn('[approveDeliverable] auto-release escrow failed:', e);
    }

    const project = await this.projectsRepository.findById(contract.project_id);

    // Notif ke mahasiswa: project selesai + dana cair
    void this.notificationsService.create({
      user_id: contract.student_id,
      type: 'contract',
      title: '✅ Project Selesai!',
      body: escrowReleased
        ? `Project "${project?.title || 'kamu'}" disetujui. Rp ${releasedNetAmount.toLocaleString('id-ID')} sudah masuk saldo kamu — tarik ke rekening lewat menu Dompet. 💰`
        : `Project "${project?.title || 'kamu'}" disetujui dan selesai.`,
      ref_id: contract.id,
      action_url: `/contracts/${contract.id}`,
    });

    // Notif tier upgrade kalau ada
    if (tierAfter !== tierBefore) {
      void this.notificationsService.create({
        user_id: contract.student_id,
        type: 'system',
        title: '🎖️ Tier Naik!',
        body: `Selamat! Tier kamu naik dari ${tierBefore} ke ${tierAfter}. Akses project lebih besar terbuka.`,
        ref_id: contract.student_id,
        action_url: `/profile`,
      });
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
   *
   * Return: tier baru (sama dengan currentTier kalau tidak berubah).
   * Diubah dari void → string supaya caller bisa tahu apakah ada upgrade.
   */
  private async _autoUpgradeTier(
    studentId: string,
    totalProjects: number,
    avgRating: number,
    currentTier: string,
  ): Promise<string> {
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
    return newTier;
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

    // Notif ke mahasiswa: deliverable ditolak, perlu revisi
    const project = await this.projectsRepository.findById(contract.project_id);
    void this.notificationsService.create({
      user_id: contract.student_id,
      type: 'contract',
      title: '🔄 Revisi Diminta',
      body: `Deliverable untuk "${project?.title || 'project'}" perlu direvisi. Alasan: ${reason}`,
      ref_id: contract.id,
      action_url: `/contracts/${contract.id}`,
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
