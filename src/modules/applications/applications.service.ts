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

@Injectable()
export class ApplicationsService {
  constructor(
    private applicationsRepository: ApplicationsRepository,
    private projectsRepository: ProjectsRepository,
    private supabaseService: SupabaseService,
    private prisma: PrismaService,
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
    if (project.business_id !== businessId) {
      throw new ForbiddenException('Kamu tidak punya akses ke lamaran ini');
    }

    const updated = await this.applicationsRepository.updateStatus(
      id,
      dto.status,
    );
    return { data: updated, message: `Lamaran berhasil di-${dto.status}` };
  }
}
