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
import { AdminService } from './admin.service';
import { ReviewVerificationDto } from './dto/review-verification.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { SendAnnouncementDto } from './dto/send-announcement.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // GET /api/v1/admin/stats
  @Get('stats')
  async getStats() {
    return this.adminService.getStats();
  }

  // GET /api/v1/admin/users
  @Get('users')
  async getAllUsers(@Query('role') role?: string) {
    return this.adminService.getAllUsers(role);
  }

  // PATCH /api/v1/admin/users/:id/suspend
  @Patch('users/:id/suspend')
  async suspendUser(@Param('id') id: string, @Body() body: any) {
    return this.adminService.toggleSuspendUser(id, body?.reason);
  }

  // GET /api/v1/admin/verifications
  @Get('verifications')
  async getVerifications(@Query('status') status?: string) {
    return this.adminService.getPendingVerifications(status);
  }

  // PATCH /api/v1/admin/verifications/:id
  @Patch('verifications/:id')
  async reviewVerification(
    @Param('id') id: string,
    @Body() dto: ReviewVerificationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.adminService.reviewVerification(id, dto, user.id);
  }

  // GET /api/v1/admin/disputes
  @Get('disputes')
  async getDisputes(@Query('status') status?: string) {
    return this.adminService.getAllDisputes(status);
  }

  // PATCH /api/v1/admin/disputes/:id
  @Patch('disputes/:id')
  async resolveDispute(
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.adminService.resolveDispute(id, dto, user.id);
  }

  // GET /api/v1/admin/projects
  @Get('projects')
  async getAllProjects(@Query('status') status?: string) {
    return this.adminService.getAllProjects(status);
  }

  // POST /api/v1/admin/announcements
  @Post('announcements')
  async sendAnnouncement(
    @Body() dto: SendAnnouncementDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.adminService.sendAnnouncement(dto, user.id);
  }

  // GET /api/v1/admin/announcements
  @Get('announcements')
  async getAnnouncements() {
    return this.adminService.getAnnouncements();
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  // GET /api/v1/admin/finances
  @Get('finances')
  async getFinances() {
    return this.adminService.getFinances();
  }

  // GET /api/v1/admin/finances/detail
  @Get('finances/detail')
  async getFinancesDetail(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
  ) {
    return this.adminService.getFinancesDetail(
      parseInt(page),
      parseInt(limit),
      status,
    );
  }

  @Get('settings')
  async getSettings() {
    return this.adminService.getSettings();
  }

  @Patch('settings')
  async updateSettings(@Body() body: any) {
    return this.adminService.updateSettings(body);
  }

  @Get('projects/:id/contracts')
  async getProjectContracts(@Param('id') id: string) {
    return this.adminService.getProjectContracts(id);
  }
}
