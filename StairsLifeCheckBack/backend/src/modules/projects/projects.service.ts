import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ProjectsRepository } from './projects.repository';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { FilterProjectDto } from './dto/filter-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private projectsRepository: ProjectsRepository) {}

  async getAllProjects(filter: FilterProjectDto) {
    const projects = await this.projectsRepository.findAll(filter);
    return { data: projects, message: 'Berhasil' };
  }

  async getProjectById(id: string) {
    const project = await this.projectsRepository.findById(id);
    if (!project) {
      throw new NotFoundException('Project tidak ditemukan');
    }
    return { data: project, message: 'Berhasil' };
  }

  async createProject(dto: CreateProjectDto, businessId: string) {
    // IDEMPOTENCY GUARD (defense-in-depth)
    // ------------------------------------------------------------------
    // Frontend sudah punya submit lock (withSubmitLock di helpers.js),
    // tapi kita tidak boleh percaya frontend 100%. Skenario yang harus
    // diblokir di sini:
    //   - Frontend lock bug (mis. exception sebelum disable)
    //   - User pakai curl/Postman dan tap-tap script
    //   - Network retry oleh browser/ekstensi
    //
    // Strategi: tolak create kedua jika business yang sama bikin project
    // dengan title + budget + deadline + category yang IDENTIK dalam
    // 10 detik terakhir. Window 10 detik cukup lama untuk menangkap
    // double-submit (biasanya <1 detik), tapi cukup pendek supaya tidak
    // menghalangi user yang sengaja post project mirip di lain waktu.
    //
    // Catatan: kita TIDAK pakai @@unique di DB level karena bisnis valid
    // saja punya 2 project dengan title sama (mis. "Desain Logo" untuk
    // klien berbeda) — itu use case sah. Yang ingin kita block hanyalah
    // double-submit accidental dalam window pendek.
    const tenSecondsAgo = new Date(Date.now() - 10_000);
    const duplicate = await this.projectsRepository.findRecentDuplicate({
      businessId,
      title: dto.title,
      budgetMin: dto.budget_min,
      budgetMax: dto.budget_max,
      deadline: new Date(dto.deadline),
      category: dto.category,
      since: tenSecondsAgo,
    });

    if (duplicate) {
      // Kembalikan project yang sudah ada — bukan throw error.
      // Ini idempotent: caller dapat respons sukses seolah create berhasil,
      // tapi DB tidak ada row ganda. Pattern ini sama dengan idempotency
      // key di Stripe — caller bisa retry aman.
      return {
        data: duplicate,
        message: 'Project sudah dibuat sebelumnya',
      };
    }

    const payload = {
      ...dto,
      deadline: new Date(dto.deadline),
      business_id: businessId,
      status: 'open',
      applicant_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const project = await this.projectsRepository.create(payload);
    return { data: project, message: 'Project berhasil dibuat' };
  }

  async updateProject(id: string, dto: UpdateProjectDto, businessId: string) {
    const project = await this.projectsRepository.findById(id);
    if (!project) {
      throw new NotFoundException('Project tidak ditemukan');
    }
    if (project.business_id !== businessId) {
      throw new ForbiddenException('Kamu tidak punya akses ke project ini');
    }
    const updated = await this.projectsRepository.update(id, dto);
    return { data: updated, message: 'Project berhasil diperbarui' };
  }

  async deleteProject(id: string, businessId: string) {
    const project = await this.projectsRepository.findById(id);
    if (!project) {
      throw new NotFoundException('Project tidak ditemukan');
    }
    if (project.business_id !== businessId) {
      throw new ForbiddenException('Kamu tidak punya akses ke project ini');
    }
    await this.projectsRepository.delete(id);
    return { data: { id }, message: 'Project berhasil dihapus' };
  }

  async getMyProjects(businessId: string) {
    const projects = await this.projectsRepository.findByBusinessId(businessId);
    return { data: projects, message: 'Berhasil' };
  }
}
