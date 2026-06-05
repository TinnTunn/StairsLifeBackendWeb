import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ApplicationsRepository } from './applications.repository';
import { ProjectsRepository } from '../projects/projects.repository';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';
import { SupabaseService } from '../../config/supabase.config';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ApplicationsService {
  constructor(
    private applicationsRepository: ApplicationsRepository,
    private projectsRepository: ProjectsRepository,
    private supabaseService: SupabaseService,
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  async applyToProject(dto: CreateApplicationDto, studentId: string) {
    // Cek project ada
    const project = await this.projectsRepository.findById(dto.project_id);
    if (!project) {
      throw new NotFoundException('Project tidak ditemukan');
    }

    // Cek project masih open
    if (project.status !== 'open') {
      throw new BadRequestException('Project sudah tidak menerima lamaran');
    }

    // Cek sudah pernah melamar
    const existing = await this.applicationsRepository.findByProjectAndStudent(
      dto.project_id,
      studentId,
    );
    if (existing) {
      throw new ConflictException('Kamu sudah pernah melamar project ini');
    }

    // Buat lamaran + increment applicant_count secara atomik dalam transaksi.
    // Sebelumnya read-then-write via Supabase → race condition kalau dua
    // mahasiswa apply bersamaan, salah satu update bisa lost.
    //
    // Catatan: estimated_completion di-konversi dari string (ISO date) ke Date
    // karena schema Prisma menggunakan @db.Date — kalau dikirim sebagai string
    // akan ditolak Prisma.
    const payload = {
      project_id: dto.project_id,
      student_id: studentId,
      cover_letter: dto.cover_letter,
      estimated_completion: new Date(dto.estimated_completion),
      offered_budget: dto.offered_budget,
      status: 'pending' as any,
    };

    const [application] = await this.prisma.$transaction([
      this.prisma.applications.create({ data: payload }),
      this.prisma.projects.update({
        where: { id: dto.project_id },
        data: { applicant_count: { increment: 1 } },
      }),
    ]);

    // Notif ke bisnis: ada lamaran baru
    const student = await this.prisma.users.findUnique({
      where: { id: studentId },
      select: { full_name: true },
    });
    void this.notificationsService.create({
      user_id: project.business_id,
      type: 'application',
      title: '📩 Lamaran Baru Masuk',
      body: `${student?.full_name || 'Mahasiswa'} melamar ke project "${project.title}".`,
      ref_id: application.id,
      action_url: `/projects/${project.id}/applications`,
    });

    return { data: application, message: 'Lamaran berhasil dikirim' };
  }

  async getMyApplications(studentId: string) {
    const applications =
      await this.applicationsRepository.findByStudentId(studentId);
    return { data: applications, message: 'Berhasil' };
  }

  async getProjectApplications(projectId: string, businessId: string) {
    // Cek project milik bisnis ini
    const project = await this.projectsRepository.findById(projectId);
    if (!project) {
      throw new NotFoundException('Project tidak ditemukan');
    }
    if (project.business_id !== businessId) {
      throw new ForbiddenException('Kamu tidak punya akses ke project ini');
    }

    const applications =
      await this.applicationsRepository.findByProjectId(projectId);
    return { data: applications, message: 'Berhasil' };
  }

  async getApplicationById(id: string, userId: string) {
    const application = await this.applicationsRepository.findById(id);
    if (!application) {
      throw new NotFoundException('Lamaran tidak ditemukan');
    }

    // Hanya mahasiswa pelamar atau bisnis pemilik project yang bisa lihat
    const project = await this.projectsRepository.findById(
      application.project_id,
    );

    const isStudent = application.student_id === userId;
    const isBusiness = project?.business_id === userId;

    if (!isStudent && !isBusiness) {
      throw new ForbiddenException('Kamu tidak punya akses ke lamaran ini');
    }

    return { data: application, message: 'Berhasil' };
  }

  // Mahasiswa membatalkan lamarannya sendiri (hanya kalau belum diputus).
  async withdrawApplication(id: string, studentId: string) {
    const application = await this.applicationsRepository.findById(id);
    if (!application) {
      throw new NotFoundException('Lamaran tidak ditemukan');
    }
    if (application.student_id !== studentId) {
      throw new ForbiddenException('Kamu hanya bisa membatalkan lamaranmu sendiri');
    }
    if (application.status !== 'pending' && application.status !== 'shortlisted') {
      throw new BadRequestException(
        `Lamaran berstatus "${application.status}" tidak bisa dibatalkan.`,
      );
    }
    await this.applicationsRepository.delete(id);
    return { data: { id }, message: 'Lamaran dibatalkan' };
  }

  async updateApplicationStatus(
    id: string,
    dto: UpdateApplicationStatusDto,
    businessId: string,
  ) {
    // Cek lamaran ada
    const application = await this.applicationsRepository.findById(id);
    if (!application) {
      throw new NotFoundException('Lamaran tidak ditemukan');
    }

    // Cek project milik bisnis ini
    const project = await this.projectsRepository.findById(
      application.project_id,
    );
    // Guard null — project bisa hilang karena cascade delete atau race.
    if (!project) {
      throw new NotFoundException(
        'Project untuk lamaran ini tidak ditemukan (mungkin sudah dihapus)',
      );
    }
    if (project.business_id !== businessId) {
      throw new ForbiddenException('Kamu tidak punya akses ke lamaran ini');
    }

    // Cek status lama vs baru — jangan notif kalau sama (idempotent re-approve)
    const previousStatus = application.status;

    // Integritas "1 project = 1 mahasiswa": cegah approve lamaran LAIN saat
    // project sudah punya kontrak (kandidat terpilih). Re-approve lamaran yang
    // SAMA (kontrak sudah dibuat untuk lamaran ini) tetap diizinkan (idempotent).
    if (dto.status === 'approved' && previousStatus !== 'approved') {
      const existingContract = await this.prisma.contracts.findFirst({
        where: { project_id: application.project_id },
        select: { application_id: true },
      });
      if (existingContract && existingContract.application_id !== id) {
        throw new BadRequestException(
          'Project ini sudah punya kandidat terpilih. Tidak bisa menerima lamaran lain.',
        );
      }
    }

    const updated = await this.applicationsRepository.updateStatus(
      id,
      dto.status,
    );

    // ── AUTO-REJECT lamaran lain saat 1 lamaran di-approve ──
    // Aturan bisnis: satu project hanya boleh punya 1 mahasiswa yang dipilih.
    // Saat bisnis terima 1 lamaran, lamaran lain yang masih 'pending' atau
    // 'shortlisted' otomatis ditolak dengan alasan jelas. Ini menghindari:
    //   - Mahasiswa lain menunggu tanpa kepastian
    //   - Bisnis lupa menolak satu-satu manual
    //   - Race condition kalau 2 lamaran di-approve hampir bersamaan
    //
    // Kita hanya auto-reject saat transisi pending/shortlisted → approved.
    // Re-approve (approved → approved) tidak trigger ulang.
    let autoRejectedCount = 0;
    if (dto.status === 'approved' && previousStatus !== 'approved') {
      const otherApps = await this.prisma.applications.findMany({
        where: {
          project_id: application.project_id,
          id: { not: id },
          status: { in: ['pending' as any, 'shortlisted' as any] },
        },
        select: { id: true, student_id: true },
      });

      if (otherApps.length > 0) {
        // Bulk update status — atomic, lebih cepat dari loop
        await this.prisma.applications.updateMany({
          where: {
            id: { in: otherApps.map(a => a.id) },
          },
          data: { status: 'rejected' as any },
        });
        autoRejectedCount = otherApps.length;

        // Kirim notif ke setiap mahasiswa yang otomatis di-reject.
        // Alasannya jelas: bukan karena CV mereka buruk, tapi karena
        // bisnis sudah memilih kandidat lain. Ini penting untuk UX
        // — mahasiswa tidak merasa "ditolak personal".
        // createBulk(userIds, payload) — payload sama untuk semua user.
        const rejectReason = `Bisnis sudah memilih kandidat lain untuk project "${project.title}". Tetap semangat, masih banyak project lain! 💪`;
        await this.notificationsService.createBulk(
          otherApps.map(a => a.student_id),
          {
            type: 'application' as any,
            title: 'Lamaran Tidak Diterima',
            body: rejectReason,
            action_url: `/applications`,
          },
        );
      }
    }

    // Notif ke mahasiswa kalau status berubah
    if (previousStatus !== dto.status) {
      if (dto.status === 'approved') {
        void this.notificationsService.create({
          user_id: application.student_id,
          type: 'application',
          title: '🎉 Lamaran Diterima!',
          body: `Lamaranmu untuk "${project.title}" telah diterima. Kontrak akan segera dibuat.`,
          ref_id: application.id,
          action_url: `/applications/${application.id}`,
        });
      } else if (dto.status === 'rejected') {
        void this.notificationsService.create({
          user_id: application.student_id,
          type: 'application',
          title: 'Lamaran Tidak Diterima',
          body: `Lamaranmu untuk "${project.title}" tidak diterima. Coba project lain!`,
          ref_id: application.id,
          action_url: `/applications`,
        });
      } else if (dto.status === 'shortlisted') {
        void this.notificationsService.create({
          user_id: application.student_id,
          type: 'application',
          title: '⭐ Kamu Masuk Shortlist',
          body: `Lamaranmu untuk "${project.title}" masuk shortlist klien.`,
          ref_id: application.id,
          action_url: `/applications/${application.id}`,
        });
      }
    }

    const message = autoRejectedCount > 0
      ? `Lamaran berhasil di-${dto.status}. ${autoRejectedCount} lamaran lain otomatis ditolak.`
      : `Lamaran berhasil di-${dto.status}`;

    return {
      data: updated,
      message,
      meta: { auto_rejected_count: autoRejectedCount },
    };
  }
}
