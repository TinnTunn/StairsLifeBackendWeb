import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SubmitVerificationDto } from './dto/submit-verification.dto';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private usersRepository: UsersRepository,
    private prisma: PrismaService,
  ) {}

  async getMe(userId: string) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }
    return { data: user, message: 'Berhasil' };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(dto)) {
      // bio adalah satu-satunya field yang boleh dikosongkan oleh user.
      // Kalau dikirim sebagai "" atau null → simpan null ke DB (hapus bio).
      // Kalau tidak dikirim sama sekali (undefined) → skip, biarkan nilai lama.
      if (key === 'bio') {
        if (value !== undefined) {
          sanitized[key] = value === '' || value === null ? null : value;
        }
        continue;
      }

      // Field lain: skip kalau kosong/null/undefined — tidak boleh dikosongkan.
      if (value === '' || value === null || value === undefined) continue;
      sanitized[key] = value;
    }

    // Auto-prefix https:// untuk portfolio_url jika user tidak ketik protokol.
    if (
      typeof sanitized.portfolio_url === 'string' &&
      sanitized.portfolio_url.length > 0 &&
      !/^https?:\/\//i.test(sanitized.portfolio_url)
    ) {
      sanitized.portfolio_url = `https://${sanitized.portfolio_url}`;
    }

    const user = await this.usersRepository.update(userId, sanitized);
    return { data: user, message: 'Profil berhasil diperbarui' };
  }

  async submitVerification(userId: string, dto: SubmitVerificationDto) {
    const existing = await this.prisma.verifications.findUnique({
      where: { user_id: userId },
    });

    if (existing) {
      const updated = await this.prisma.verifications.update({
        where: { user_id: userId },
        data: {
          ktm_image_url: dto.ktm_image_url,
          selfie_url: dto.selfie_url ?? null,
          university: dto.university,
          student_id_number: dto.student_id_number,
          status: 'pending',
          submitted_at: new Date(),
        },
      });
      return { data: updated, message: 'Verifikasi berhasil diperbarui' };
    }

    const created = await this.prisma.verifications.create({
      data: {
        user_id: userId,
        ktm_image_url: dto.ktm_image_url,
        selfie_url: dto.selfie_url ?? null,
        university: dto.university,
        student_id_number: dto.student_id_number,
        status: 'pending',
        submitted_at: new Date(),
      },
    });

    return { data: created, message: 'Verifikasi berhasil diajukan' };
  }

  async getVerificationStatus(userId: string) {
    const data = await this.prisma.verifications.findUnique({
      where: { user_id: userId },
      select: {
        id: true,
        status: true,
        submitted_at: true,
        reviewed_at: true,
        rejection_reason: true,
      },
    });

    return {
      data: data ?? null,
      message: data ? 'Berhasil' : 'Belum ada pengajuan verifikasi',
    };
  }

  async getPublicProfile(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        full_name: true,
        role: true,
        tier: true,
        is_verified: true,
        avatar_url: true,
        bio: true,
        university: true,
        major: true,
        semester: true,
        company_name: true,
        business_type: true,
        location: true,
        skills: true,
        portfolio_url: true,
        rating_avg: true,
        total_projects: true,
        created_at: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }

    const reviews = await this.prisma.reviews.findMany({
      where: { reviewee_id: userId },
      include: {
        users_reviews_reviewer_idTousers: {
          select: { id: true, full_name: true, role: true, avatar_url: true },
        },
        contracts: {
          select: {
            id: true,
            projects: { select: { title: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    const allRatings = await this.prisma.reviews.findMany({
      where: { reviewee_id: userId },
      select: { rating: true },
    });
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of allRatings) {
      const k = Number(r.rating);
      if (k >= 1 && k <= 5) distribution[k as 1 | 2 | 3 | 4 | 5]++;
    }

    return {
      data: {
        user,
        reviews,
        review_count: allRatings.length,
        rating_distribution: distribution,
      },
      message: 'Berhasil',
    };
  }

  async getUserPortfolio(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, role: true, full_name: true },
    });
    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }

    const contracts = await this.prisma.contracts.findMany({
      where: {
        student_id: userId,
        status: 'completed',
      },
      select: {
        id: true,
        agreed_budget: true,
        started_at: true,
        completed_at: true,
        created_at: true,
        deliverable_url: true,
        projects: {
          select: {
            id: true,
            title: true,
            category: true,
            tier: true,
            skills: true,
          },
        },
        users_contracts_business_idTousers: {
          select: { id: true, full_name: true, avatar_url: true },
        },
      },
      orderBy: { completed_at: 'desc' },
    });

    if (contracts.length === 0) {
      return {
        data: {
          user_id: userId,
          user_role: user.role,
          total_projects: 0,
          items: [],
          summary: {
            total_completed: 0,
            total_earnings: 0,
            unique_categories: 0,
            average_rating: null,
          },
        },
        message: 'Belum ada karya tersimpan',
      };
    }

    const contractIds = contracts.map((c) => c.id);
    const reviews = await this.prisma.reviews.findMany({
      where: {
        contract_id: { in: contractIds },
        reviewee_id: userId,
      },
      select: {
        contract_id: true,
        rating: true,
        comment: true,
        created_at: true,
      },
    });

    type ReviewSlim = {
      contract_id: string;
      rating: number | null;
      comment: string | null;
      created_at: Date | null;
    };
    const reviewByContract = new Map<string, ReviewSlim>(
      reviews.map((r) => [r.contract_id, r]),
    );

    const items = contracts.map((c) => {
      const review = reviewByContract.get(c.id);
      return {
        contract_id: c.id,
        project: {
          id: c.projects?.id,
          title: c.projects?.title || 'Project',
          category: c.projects?.category || null,
          tier: c.projects?.tier || null,
          skills: c.projects?.skills || [],
        },
        client: {
          id: c.users_contracts_business_idTousers?.id,
          full_name: c.users_contracts_business_idTousers?.full_name || 'Klien',
          avatar_url: c.users_contracts_business_idTousers?.avatar_url || null,
        },
        budget: c.agreed_budget,
        started_at: c.started_at,
        completed_at: c.completed_at,
        deliverable_url: c.deliverable_url || null,
        review: review
          ? {
              rating: review.rating,
              comment: review.comment,
              created_at: review.created_at,
            }
          : null,
      };
    });

    const totalEarnings = contracts.reduce(
      (s, c) => s + (Number(c.agreed_budget) || 0),
      0,
    );
    const categories = new Set(
      contracts.map((c) => c.projects?.category).filter(Boolean),
    );
    const ratedReviews = reviews.filter((r) => r.rating != null);
    const avgRating =
      ratedReviews.length > 0
        ? ratedReviews.reduce((s, r) => s + (r.rating || 0), 0) /
          ratedReviews.length
        : null;

    return {
      data: {
        user_id: userId,
        user_role: user.role,
        total_projects: items.length,
        items,
        summary: {
          total_completed: items.length,
          total_earnings: totalEarnings,
          unique_categories: categories.size,
          average_rating: avgRating ? Number(avgRating.toFixed(2)) : null,
        },
      },
      message: 'Berhasil',
    };
  }
}
