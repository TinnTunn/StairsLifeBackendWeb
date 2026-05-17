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
    const user = await this.usersRepository.update(userId, dto);
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
}
