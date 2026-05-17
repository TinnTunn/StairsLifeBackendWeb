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
    return this.projectsRepository.delete(id);
  }

  async getMyProjects(businessId: string) {
    const projects = await this.projectsRepository.findByBusinessId(businessId);
    return { data: projects, message: 'Berhasil' };
  }
}
