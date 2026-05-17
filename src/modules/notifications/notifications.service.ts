import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate notifikasi dari data relasional yang ada (applications, contracts).
   * Karena belum ada tabel notifications tersendiri, notifikasi di-generate
   * dari status record yang sudah ada di DB.
   */
  async getAll(userId: string) {
    const notifications: any[] = [];

    // Dari lamaran mahasiswa yang statusnya berubah
    const applications = await this.prisma.applications
      .findMany({
        where: { student_id: userId },
        include: { projects: { select: { title: true } } },
        orderBy: { created_at: 'desc' },
        take: 20,
      })
      .catch(() => []);

    applications.forEach((app) => {
      if (app.status === 'approved') {
        notifications.push({
          id: `app-approved-${app.id}`,
          title: 'Lamaran Diterima! 🎉',
          body: `Lamaranmu untuk "${app.projects?.title}" telah diterima. Kontrak akan segera dibuat.`,
          message: `Lamaranmu untuk "${app.projects?.title}" telah diterima.`,
          type: 'application',
          is_read: false,
          created_at: app.updated_at || app.created_at,
          action_url: null,
        });
      } else if (app.status === 'rejected') {
        notifications.push({
          id: `app-rejected-${app.id}`,
          title: 'Lamaran Tidak Diterima',
          body: `Lamaranmu untuk "${app.projects?.title}" tidak diterima. Jangan menyerah, coba project lain!`,
          message: `Lamaranmu untuk "${app.projects?.title}" tidak diterima.`,
          type: 'application',
          is_read: false,
          created_at: app.updated_at || app.created_at,
          action_url: null,
        });
      }
    });

    // Dari kontrak mahasiswa
    const studentContracts = await this.prisma.contracts
      .findMany({
        where: { student_id: userId },
        include: { projects: { select: { title: true } } },
        orderBy: { created_at: 'desc' },
        take: 10,
      })
      .catch(() => []);

    studentContracts.forEach((c) => {
      if (c.status === 'active') {
        notifications.push({
          id: `contract-active-${c.id}`,
          title: 'Kontrak Aktif 📋',
          body: `Kontrak untuk "${c.projects?.title}" sudah aktif. Mulai kerjakan dan upload deliverable-mu!`,
          message: `Kontrak untuk "${c.projects?.title}" sudah aktif.`,
          type: 'contract',
          is_read: false,
          created_at: c.started_at || c.created_at,
          action_url: null,
        });
      } else if (c.status === 'completed') {
        notifications.push({
          id: `contract-done-${c.id}`,
          title: 'Project Selesai ✅',
          body: `Project "${c.projects?.title}" telah selesai. Dana sedang dalam proses pencairan.`,
          message: `Project "${c.projects?.title}" telah selesai.`,
          type: 'payment',
          is_read: false,
          created_at: c.completed_at || c.created_at,
          action_url: null,
        });
      } else if (c.status === 'pending_review') {
        notifications.push({
          id: `contract-review-${c.id}`,
          title: 'Deliverable Menunggu Review',
          body: `Deliverable untuk "${c.projects?.title}" sedang ditinjau klien.`,
          message: `Deliverable untuk "${c.projects?.title}" sedang ditinjau.`,
          type: 'contract',
          is_read: false,
          created_at: c.updated_at || c.created_at,
          action_url: null,
        });
      }
    });

    // Dari lamaran ke project bisnis (untuk role bisnis)
    const bizApplications = await this.prisma.applications
      .findMany({
        where: {
          projects: { business_id: userId },
          status: 'pending',
        },
        include: {
          projects: { select: { title: true } },
          users: { select: { full_name: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 10,
      })
      .catch(() => []);

    bizApplications.forEach((app) => {
      notifications.push({
        id: `biz-app-${app.id}`,
        title: 'Lamaran Masuk 📩',
        body: `${app.users?.full_name || 'Mahasiswa'} melamar ke project "${app.projects?.title}".`,
        message: `${app.users?.full_name || 'Mahasiswa'} melamar ke project "${app.projects?.title}".`,
        type: 'application',
        is_read: false,
        created_at: app.created_at,
        action_url: null,
      });
    });

    notifications.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return { data: notifications, message: 'Berhasil' };
  }

  async getUnreadCount(userId: string) {
    const res = await this.getAll(userId);
    const count = (res.data || []).filter((n) => !n.is_read).length;
    return { data: { count }, message: 'Berhasil' };
  }

  // NOTE: markRead dan markAllRead adalah no-op sementara karena notifikasi
  // di-generate secara dinamis. Saat tabel `notifications` persisten dibuat,
  // ganti dengan UPDATE yang sebenarnya.
  markRead(notifId: string, _userId: string) {
    return { data: { id: notifId, is_read: true }, message: 'Berhasil' };
  }

  markAllRead(_userId: string) {
    return { data: null, message: 'Semua notifikasi ditandai dibaca' };
  }
}

