import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ReviewVerificationDto } from './dto/review-verification.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { SendAnnouncementDto } from './dto/send-announcement.dto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════
  // STATS
  // ═══════════════════════════════
  async getStats() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      totalProjects,
      activeProjects,
      pendingVerifications,
      activeDisputes,
    ] = await Promise.all([
      this.prisma.users.count(),
      this.prisma.projects.count(),
      this.prisma.projects.count({ where: { status: 'open' } }),
      this.prisma.verifications.count({ where: { status: 'pending' } }),
      this.prisma.disputes.count({ where: { status: 'open' } }),
    ]);

    // Tren project baru 30 hari
    const recentProjects = await this.prisma.projects.findMany({
      where: { created_at: { gte: thirtyDaysAgo } },
      select: { created_at: true },
      orderBy: { created_at: 'asc' },
    });

    // Tren registrasi 30 hari
    const recentUsers = await this.prisma.users.findMany({
      where: { created_at: { gte: thirtyDaysAgo } },
      select: { created_at: true },
      orderBy: { created_at: 'asc' },
    });

    // Build 30-day map
    const now = new Date();
    const projectMap: Record<string, number> = {};
    const regMap: Record<string, number> = {};

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().split('T')[0];
      projectMap[key] = 0;
      regMap[key] = 0;
    }

    recentProjects.forEach((p) => {
      if (!p.created_at) return;
      const key = new Date(p.created_at).toISOString().split('T')[0];
      if (key in projectMap) projectMap[key]++;
    });

    recentUsers.forEach((u) => {
      if (!u.created_at) return;
      const key = new Date(u.created_at).toISOString().split('T')[0];
      if (key in regMap) regMap[key]++;
    });

    const project_trend = Object.entries(projectMap).map(([date, count]) => ({
      date,
      count,
    }));
    const registration_trend = Object.entries(regMap).map(([date, count]) => ({
      date,
      count,
    }));

    return {
      data: {
        total_users: totalUsers,
        total_projects: totalProjects,
        active_projects: activeProjects,
        pending_verifications: pendingVerifications,
        active_disputes: activeDisputes,
        project_trend,
        registration_trend,
      },
      message: 'Berhasil',
    };
  }

  // ═══════════════════════════════
  // USERS
  // ═══════════════════════════════
  async getAllUsers(role?: string) {
    const users = await this.prisma.users.findMany({
      where: role ? { role: role as any } : undefined,
      select: {
        id: true,
        full_name: true,
        email: true,
        role: true,
        tier: true,
        is_verified: true,
        is_suspended: true,
        suspension_reason: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
    return { data: users, message: 'Berhasil' };
  }

  async toggleSuspendUser(userId: string, reason?: string) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    const updated = await this.prisma.users.update({
      where: { id: userId },
      data: {
        is_suspended: !user.is_suspended,
        suspension_reason: !user.is_suspended
          ? reason || 'Disuspend oleh admin'
          : null,
        updated_at: new Date(),
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        role: true,
        is_suspended: true,
        suspension_reason: true,
      },
    });

    return {
      data: updated,
      message: updated.is_suspended
        ? 'Akun berhasil disuspend'
        : 'Akun berhasil diaktifkan',
    };
  }

  async deleteUser(userId: string) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');
    await this.prisma.users.delete({ where: { id: userId } });
    return { data: null, message: 'Akun berhasil dihapus' };
  }

  // ═══════════════════════════════
  // VERIFICATIONS
  // ═══════════════════════════════
  async getPendingVerifications(status: string = 'pending') {
    const verifications = await this.prisma.verifications.findMany({
      where: { status: status as any },
      include: {
        users_verifications_user_idTousers: {
          select: { id: true, full_name: true, email: true, university: true },
        },
      },
      orderBy: { submitted_at: 'asc' },
    });

    const mapped = verifications.map((v) => ({
      ...v,
      user: v.users_verifications_user_idTousers,
    }));

    return { data: mapped, message: 'Berhasil' };
  }

  async reviewVerification(
    verificationId: string,
    dto: ReviewVerificationDto,
    adminId: string,
  ) {
    const verification = await this.prisma.verifications.findUnique({
      where: { id: verificationId },
    });
    if (!verification)
      throw new NotFoundException('Verifikasi tidak ditemukan');

    const updated = await this.prisma.verifications.update({
      where: { id: verificationId },
      data: {
        status: dto.status as any,
        reviewed_by: adminId,
        rejection_reason: dto.rejection_reason ?? null,
        reviewed_at: new Date(),
      },
    });

    if (dto.status === 'approved') {
      await this.prisma.users.update({
        where: { id: verification.user_id },
        data: { is_verified: true, updated_at: new Date() },
      });
    }

    return {
      data: updated,
      message:
        dto.status === 'approved'
          ? 'Verifikasi disetujui'
          : 'Verifikasi ditolak',
    };
  }

  // ═══════════════════════════════
  // DISPUTES
  // ═══════════════════════════════
  async getAllDisputes(status?: string) {
    const disputes = await this.prisma.disputes.findMany({
      where: status ? { status } : undefined,
      include: {
        contracts: {
          include: {
            projects: { select: { id: true, title: true } },
            users_contracts_student_idTousers: {
              select: { id: true, full_name: true, role: true },
            },
            users_contracts_business_idTousers: {
              select: { id: true, full_name: true, role: true },
            },
          },
        },
        users_disputes_opened_byTousers: {
          select: { id: true, full_name: true, role: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return { data: disputes, message: 'Berhasil' };
  }

  async resolveDispute(
    disputeId: string,
    dto: ResolveDisputeDto,
    adminId: string,
  ) {
    const dispute = await this.prisma.disputes.findUnique({
      where: { id: disputeId },
    });
    if (!dispute) throw new NotFoundException('Dispute tidak ditemukan');

    const updated = await this.prisma.disputes.update({
      where: { id: disputeId },
      data: {
        status: dto.status as any,
        admin_notes: dto.admin_notes,
        resolved_by: adminId,
        resolved_at: dto.status === 'resolved' ? new Date() : null,
      },
    });

    return { data: updated, message: 'Dispute berhasil diupdate' };
  }

  // ═══════════════════════════════
  // PROJECTS
  // ═══════════════════════════════
  async getAllProjects(status?: string) {
    const projects = await this.prisma.projects.findMany({
      where: status ? { status: status as any } : undefined,
      include: { users: { select: { id: true, full_name: true } } },
      orderBy: { created_at: 'desc' },
    });

    const mapped = projects.map((p) => ({ ...p, business: p.users }));
    return { data: mapped, message: 'Berhasil' };
  }

  async getProjectContracts(projectId: string) {
    const contracts = await this.prisma.contracts.findMany({
      where: { project_id: projectId },
      include: {
        users_contracts_student_idTousers: {
          select: { id: true, full_name: true, email: true },
        },
        users_contracts_business_idTousers: {
          select: { id: true, full_name: true, email: true },
        },
        contract_deliverables: { orderBy: { submitted_at: 'desc' } },
      },
    });
    return { data: contracts, message: 'Berhasil' };
  }

  // ═══════════════════════════════
  // ANNOUNCEMENTS
  // ═══════════════════════════════
  async sendAnnouncement(dto: SendAnnouncementDto, adminId: string) {
    const announcement = await this.prisma.announcements.create({
      data: {
        title: dto.title,
        body: dto.body,
        target: dto.target,
        sent_by: adminId,
      },
    });
    return { data: announcement, message: 'Announcement berhasil dikirim' };
  }

  async getAnnouncements() {
    const announcements = await this.prisma.announcements.findMany({
      orderBy: { created_at: 'desc' },
    });
    return { data: announcements, message: 'Berhasil' };
  }

  // ═══════════════════════════════
  // FINANCES
  // ═══════════════════════════════
  async getFinances() {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [allTime, today, thisWeek, thisMonth] = await Promise.all([
      this.prisma.payments.aggregate({
        where: { status: 'released' },
        _sum: { platform_fee: true, amount: true },
        _count: { id: true },
      }),
      this.prisma.payments.aggregate({
        where: { status: 'released', released_at: { gte: todayStart } },
        _sum: { platform_fee: true },
      }),
      this.prisma.payments.aggregate({
        where: { status: 'released', released_at: { gte: weekStart } },
        _sum: { platform_fee: true },
      }),
      this.prisma.payments.aggregate({
        where: { status: 'released', released_at: { gte: monthStart } },
        _sum: { platform_fee: true },
      }),
    ]);

    const last30 = new Date(now);
    last30.setDate(now.getDate() - 29);
    last30.setHours(0, 0, 0, 0);
    const dailyPayments = await this.prisma.payments.findMany({
      where: { status: 'released', released_at: { gte: last30 } },
      select: { platform_fee: true, released_at: true },
      orderBy: { released_at: 'asc' },
    });

    const dailyMap: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().split('T')[0];
      dailyMap[key] = 0;
    }
    dailyPayments.forEach((p) => {
      if (!p.released_at) return;
      const key = p.released_at.toISOString().split('T')[0];
      if (key in dailyMap) dailyMap[key] += p.platform_fee || 0;
    });

    return {
      data: {
        summary: {
          total_komisi: allTime._sum.platform_fee || 0,
          total_gmv: allTime._sum.amount || 0,
          total_transaksi: allTime._count.id || 0,
          komisi_hari_ini: today._sum.platform_fee || 0,
          komisi_minggu_ini: thisWeek._sum.platform_fee || 0,
          komisi_bulan_ini: thisMonth._sum.platform_fee || 0,
        },
        daily_trend: Object.entries(dailyMap).map(([date, komisi]) => ({
          date,
          komisi,
        })),
      },
      message: 'Berhasil',
    };
  }

  async getFinancesDetail(page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status) where.status = status;

    const [payments, total] = await Promise.all([
      this.prisma.payments.findMany({
        where,
        include: {
          contracts: {
            include: {
              projects: { select: { id: true, title: true, category: true } },
              users_contracts_student_idTousers: {
                select: { id: true, full_name: true },
              },
              users_contracts_business_idTousers: {
                select: { id: true, full_name: true },
              },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.payments.count({ where }),
    ]);

    return {
      data: {
        payments,
        pagination: {
          page,
          limit,
          total,
          total_pages: Math.ceil(total / limit),
        },
      },
      message: 'Berhasil',
    };
  }

  // ═══════════════════════════════
  // SETTINGS
  // ═══════════════════════════════
  async getSettings() {
    const settings = await this.prisma.platform_settings.findMany();
    const data: Record<string, any> = {};
    settings.forEach((s) => {
      data[s.key] = isNaN(Number(s.value)) ? s.value : Number(s.value);
    });

    return {
      data: {
        platform_fee: data.platform_fee ?? 10,
        verification_sla_days: data.verification_sla_days ?? 2,
      },
      message: 'Berhasil',
    };
  }

  async updateSettings(payload: any) {
    const updates = [];

    if (payload.platform_fee !== undefined) {
      updates.push(
        this.prisma.platform_settings.upsert({
          where: { key: 'platform_fee' },
          update: {
            value: String(payload.platform_fee),
            updated_at: new Date(),
          },
          create: { key: 'platform_fee', value: String(payload.platform_fee) },
        }),
      );
    }

    if (payload.verification_sla_days !== undefined) {
      updates.push(
        this.prisma.platform_settings.upsert({
          where: { key: 'verification_sla_days' },
          update: {
            value: String(payload.verification_sla_days),
            updated_at: new Date(),
          },
          create: {
            key: 'verification_sla_days',
            value: String(payload.verification_sla_days),
          },
        }),
      );
    }

    await Promise.all(updates);

    return {
      data: {
        platform_fee: payload.platform_fee,
        verification_sla_days: payload.verification_sla_days,
      },
      message: 'Pengaturan berhasil disimpan',
    };
  }
}
