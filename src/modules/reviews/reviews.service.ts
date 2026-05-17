import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async create(reviewerId: string, dto: CreateReviewDto) {
    const { contract_id, rating, comment, tags } = dto;

    // Cek kontrak ada dan sudah completed
    const contract = await this.prisma.contracts.findFirst({
      where: {
        id: contract_id,
        status: 'completed',
        OR: [{ business_id: reviewerId }, { student_id: reviewerId }],
      },
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
    await this.prisma.users.update({
      where: { id: actualRevieweeId },
      data: { rating_avg: avg },
    });

    // NOTE: total_projects TIDAK di-increment di sini.
    // Counter project selesai sudah di-handle oleh ContractsService.approveDeliverable —
    // memberi review tidak menambah "project selesai" lagi (sebelumnya double-count).

    return { data: review, message: 'Review berhasil diberikan' };
  }

  async getByContract(contractId: string) {
    // Ambil semua review untuk kontrak ini (bisa 2: bisnis→mahasiswa dan mahasiswa→bisnis)
    const reviews = await this.prisma.reviews.findMany({
      where: { contract_id: contractId },
      include: {
        users_reviews_reviewer_idTousers: {
          select: { id: true, full_name: true, role: true },
        },
        users_reviews_reviewee_idTousers: {
          select: { id: true, full_name: true, role: true },
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
          select: { id: true, full_name: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    return { data: reviews, message: 'Berhasil' };
  }
}
