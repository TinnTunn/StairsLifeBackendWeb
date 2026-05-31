import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  async create(reviewerId: string, dto: CreateReviewDto) {
    const { contract_id, rating, comment, tags } = dto;

    // Cek kontrak ada dan sudah completed
    const contract = await this.prisma.contracts.findFirst({
      where: {
        id: contract_id,
        status: 'completed',
        OR: [{ business_id: reviewerId }, { student_id: reviewerId }],
      },
      include: { projects: { select: { title: true } } },
    });
    if (!contract)
      throw new NotFoundException('Kontrak tidak ditemukan atau belum selesai');

    // Tentukan reviewee — kalau bisnis review, reviewee = mahasiswa;
    // kalau mahasiswa review, reviewee = bisnis.
    // (Reviewee tidak boleh diambil dari body — bisa di-spoof. Wajib derive
    // dari contract.)
    const actualRevieweeId =
      reviewerId === contract.business_id
        ? contract.student_id
        : contract.business_id;

    // Cek review dari reviewer ini untuk kontrak ini belum ada
    const existing = await this.prisma.reviews.findFirst({
      where: { contract_id, reviewer_id: reviewerId },
    });
    if (existing)
      throw new BadRequestException(
        'Kamu sudah pernah memberikan review untuk kontrak ini',
      );

    const review = await this.prisma.reviews.create({
      data: {
        contract_id,
        reviewer_id: reviewerId,
        reviewee_id: actualRevieweeId,
        rating,
        comment: comment || null,
        tags: tags || [],
      },
    });

    // Update rating_avg reviewee
    const allReviews = await this.prisma.reviews.findMany({
      where: { reviewee_id: actualRevieweeId },
      select: { rating: true },
    });
    const avg =
      allReviews.reduce((s, r) => s + (r.rating || 0), 0) / allReviews.length;
    const updatedReviewee = await this.prisma.users.update({
      where: { id: actualRevieweeId },
      data: { rating_avg: avg },
    });

    // BUG FIX: re-evaluate tier kalau reviewee adalah mahasiswa (bisa naik
    // kalau rating baru ini melewati threshold). Sebelumnya tier cuma di-cek
    // saat approve deliverable, jadi mahasiswa yang barusan dapat rating 5
    // dan crossover threshold harus nunggu project berikutnya selesai dulu.
    let tierUpgrade: { from: string; to: string } | null = null;
    if (updatedReviewee.role === 'mahasiswa') {
      tierUpgrade = await this._autoUpgradeTier(
        updatedReviewee.id,
        updatedReviewee.total_projects ?? 0,
        Number(updatedReviewee.rating_avg ?? 0),
        updatedReviewee.tier ?? 'pemula',
      );
    }

    // Notif ke reviewee: dapat review baru
    const reviewer = await this.prisma.users.findUnique({
      where: { id: reviewerId },
      select: { full_name: true },
    });
    const stars = '⭐'.repeat(rating);
    void this.notificationsService.create({
      user_id: actualRevieweeId,
      type: 'review',
      title: `${stars} Review Baru`,
      body: `${reviewer?.full_name || 'Klien'} memberi rating ${rating}/5 untuk project "${contract.projects?.title || 'kamu'}".${comment ? ` "${comment.slice(0, 60)}${comment.length > 60 ? '...' : ''}"` : ''}`,
      ref_id: contract.id,
      action_url: `/profile`,
    });

    // Notif tier upgrade kalau ada
    if (tierUpgrade) {
      void this.notificationsService.create({
        user_id: actualRevieweeId,
        type: 'system',
        title: '🎖️ Tier Naik!',
        body: `Selamat! Tier kamu naik dari ${tierUpgrade.from} ke ${tierUpgrade.to}. Akses project lebih besar terbuka.`,
        ref_id: actualRevieweeId,
        action_url: `/profile`,
      });
    }

    // NOTE: total_projects TIDAK di-increment di sini.
    // Counter project selesai sudah di-handle oleh ContractsService.approveDeliverable —
    // memberi review tidak menambah "project selesai" lagi (sebelumnya double-count).

    return { data: review, message: 'Review berhasil diberikan' };
  }

  /**
   * Sama dengan logika di ContractsService._autoUpgradeTier — di-duplikasi
   * di sini supaya rating update juga bisa trigger naik tier. (Idealnya di-
   * extract ke shared utility / UsersService di refactor selanjutnya.)
   *
   * Return: { from, to } kalau ada upgrade, null kalau tidak berubah.
   */
  private async _autoUpgradeTier(
    studentId: string,
    totalProjects: number,
    avgRating: number,
    currentTier: string,
  ): Promise<{ from: string; to: string } | null> {
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
      return { from: currentTier, to: newTier };
    }
    return null;
  }

  async getByContract(contractId: string) {
    // Ambil semua review untuk kontrak ini (bisa 2: bisnis→mahasiswa dan mahasiswa→bisnis)
    const reviews = await this.prisma.reviews.findMany({
      where: { contract_id: contractId },
      include: {
        users_reviews_reviewer_idTousers: {
          select: { id: true, full_name: true, role: true, avatar_url: true },
        },
        users_reviews_reviewee_idTousers: {
          select: { id: true, full_name: true, role: true, avatar_url: true },
        },
      },
    });
    return { data: reviews, message: 'Berhasil' };
  }

  async getByUser(userId: string) {
    const reviews = await this.prisma.reviews.findMany({
      where: { reviewee_id: userId },
      include: {
        users_reviews_reviewer_idTousers: {
          select: { id: true, full_name: true, avatar_url: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    return { data: reviews, message: 'Berhasil' };
  }
}
