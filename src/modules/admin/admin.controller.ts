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
import { AuditService } from './audit.service';
import { RolesService } from './roles.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
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
  constructor(
    private readonly adminService: AdminService,
    private readonly audit: AuditService,
    private readonly rolesService: RolesService,
  ) {}

  private _actorName(user: JwtUser): string {
    return (user as any).full_name || (user as any).name || (user as any).email || 'Admin';
  }

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
  async suspendUser(
    @Param('id') id: string,
    @Body() body: SuspendUserDto,
    @CurrentUser() user: JwtUser,
  ) {
    const res = await this.adminService.toggleSuspendUser(id, body?.reason);
    void this.audit.log({
      actorId: user.id, actorName: this._actorName(user),
      action: 'user.suspend_toggle', targetType: 'user', targetId: id,
      metadata: { reason: body?.reason ?? null },
    });
    return res;
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
    const res = await this.adminService.reviewVerification(id, dto, user.id);
    void this.audit.log({
      actorId: user.id, actorName: this._actorName(user),
      action: 'verification.review', targetType: 'verification', targetId: id,
      metadata: { status: (dto as any).status, rejection_reason: (dto as any).rejection_reason ?? null },
    });
    return res;
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
    const res = await this.adminService.resolveDispute(id, dto, user.id);
    void this.audit.log({
      actorId: user.id, actorName: this._actorName(user),
      action: 'dispute.resolve', targetType: 'dispute', targetId: id,
      metadata: { status: (dto as any).status, outcome: (dto as any).outcome ?? null },
    });
    return res;
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
    const res = await this.adminService.sendAnnouncement(dto, user.id);
    void this.audit.log({
      actorId: user.id, actorName: this._actorName(user),
      action: 'announcement.send', targetType: 'announcement',
      metadata: { title: (dto as any).title ?? null, target: (dto as any).target ?? null },
    });
    return res;
  }

  // GET /api/v1/admin/announcements
  @Get('announcements')
  async getAnnouncements() {
    return this.adminService.getAnnouncements();
  }

  @Delete('users/:id')
  async deleteUser(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const res = await this.adminService.deleteUser(id);
    void this.audit.log({
      actorId: user.id, actorName: this._actorName(user),
      action: 'user.delete', targetType: 'user', targetId: id,
    });
    return res;
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
  async updateSettings(@Body() body: UpdateSettingsDto, @CurrentUser() user: JwtUser) {
    const res = await this.adminService.updateSettings(body);
    void this.audit.log({
      actorId: user.id, actorName: this._actorName(user),
      action: 'settings.update', targetType: 'settings', metadata: { ...body },
    });
    return res;
  }

  @Get('projects/:id/contracts')
  async getProjectContracts(@Param('id') id: string) {
    return this.adminService.getProjectContracts(id);
  }

  // GET /api/v1/admin/audit-logs
  @Get('audit-logs')
  async getAuditLogs(@Query('limit') limit = '50') {
    const data = await this.audit.list(parseInt(limit, 10) || 50);
    return { data, message: 'Berhasil' };
  }

  // ─── ACCESS CONTROL (admin roles registry) ──────────────────
  @Get('roles')
  async getRoles() {
    return this.rolesService.list();
  }

  @Post('roles')
  async createRole(@Body() dto: CreateRoleDto, @CurrentUser() user: JwtUser) {
    const res = await this.rolesService.create(dto);
    void this.audit.log({
      actorId: user.id, actorName: this._actorName(user),
      action: 'role.create', targetType: 'role', targetId: res.data?.id,
      metadata: { name: dto.name },
    });
    return res;
  }

  @Patch('roles/:id')
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: JwtUser,
  ) {
    const res = await this.rolesService.update(id, dto);
    void this.audit.log({
      actorId: user.id, actorName: this._actorName(user),
      action: 'role.update', targetType: 'role', targetId: id, metadata: { ...dto },
    });
    return res;
  }

  @Delete('roles/:id')
  async deleteRole(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const res = await this.rolesService.remove(id);
    void this.audit.log({
      actorId: user.id, actorName: this._actorName(user),
      action: 'role.delete', targetType: 'role', targetId: id,
    });
    return res;
  }
}
