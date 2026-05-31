import type { JwtUser } from '../../common/types/jwt-payload.type';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { FilterProjectDto } from './dto/filter-project.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // GET /api/v1/projects — public
  @Get()
  async getAll(@Query() filter: FilterProjectDto) {
    return this.projectsService.getAllProjects(filter);
  }

  // GET /api/v1/projects/my — bisnis lihat project sendiri
  @Get('my')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('bisnis')
  async getMyProjects(@CurrentUser() user: JwtUser) {
    return this.projectsService.getMyProjects(user.id);
  }

  // GET /api/v1/projects/:id — public
  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.projectsService.getProjectById(id);
  }

  // POST /api/v1/projects — bisnis only
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('bisnis')
  async create(@Body() dto: CreateProjectDto, @CurrentUser() user: JwtUser) {
    return this.projectsService.createProject(dto, user.id);
  }

  // PATCH /api/v1/projects/:id — bisnis only
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('bisnis')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.projectsService.updateProject(id, dto, user.id);
  }

  // DELETE /api/v1/projects/:id — bisnis only
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('bisnis')
  async delete(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.projectsService.deleteProject(id, user.id);
  }
}
