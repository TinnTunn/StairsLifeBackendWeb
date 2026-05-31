import type { Request } from 'express';
import type { JwtUser } from '../../common/types/jwt-payload.type';
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { WithdrawalsService } from './withdrawals.service';
import { XenditService } from '../xendit/xendit.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { ProcessWithdrawalDto } from './dto/process-withdrawal.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('withdrawals')
export class WithdrawalsController {
  private readonly logger = new Logger(WithdrawalsController.name);

  constructor(
    private readonly withdrawalsService: WithdrawalsService,
    private readonly xendit: XenditService,
  ) {}

  // ─── USER (mahasiswa) ─────────────────────────────────────

  // GET /api/v1/withdrawals/wallet — saldo mahasiswa
  @Get('wallet')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('mahasiswa')
  async getWallet(@CurrentUser() user: JwtUser) {
    return this.withdrawalsService.getWallet(user.id);
  }

  // POST /api/v1/withdrawals — request penarikan
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('mahasiswa')
  async create(
    @Body() dto: CreateWithdrawalDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.withdrawalsService.create(user.id, dto);
  }

  // GET /api/v1/withdrawals/my
  @Get('my')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('mahasiswa')
  async getMy(@CurrentUser() user: JwtUser) {
    return this.withdrawalsService.findByUser(user.id);
  }

  // ─── ADMIN ────────────────────────────────────────────────

  // GET /api/v1/withdrawals — list semua untuk admin
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async listAll(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page ?? '1') || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '20') || 20));
    return this.withdrawalsService.listAll(status, pageNum, limitNum);
  }

  // PATCH /api/v1/withdrawals/:id/process — approve / reject
  @Patch(':id/process')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async process(
    @Param('id') id: string,
    @Body() dto: ProcessWithdrawalDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.withdrawalsService.process(id, user.id, dto);
  }

  // ─── XENDIT DISBURSEMENT WEBHOOK ──────────────────────────
  // POST /api/v1/withdrawals/webhook/xendit
  // Xendit panggil endpoint ini saat disbursement berubah status.
  @Post('webhook/xendit')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async disbursementWebhook(@Req() req: Request, @Body() payload: any) {
    const token = req.header('x-callback-token');
    if (!this.xendit.verifyCallbackToken(token)) {
      this.logger.warn('Disbursement webhook: token mismatch');
      throw new ForbiddenException('Invalid callback token');
    }
    return this.withdrawalsService.handleDisbursementWebhook(payload);
  }
}
