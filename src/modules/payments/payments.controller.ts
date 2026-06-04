import type { Request } from 'express';
import type { JwtUser } from '../../common/types/jwt-payload.type';
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { XenditService } from '../xendit/xendit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly xenditService: XenditService,
  ) {}

  // ─── XENDIT INVOICE (primary flow) ────────────────────────
  // POST /api/v1/payments/invoice
  // Bisnis trigger pembayaran. Backend create Xendit invoice & return
  // invoice_url. FE redirect / buka tab ke URL itu.
  @Post('invoice')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('bisnis')
  @Throttle({ medium: { limit: 30, ttl: 60_000 } })
  async createInvoice(
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.paymentsService.createInvoice(dto, user.id);
  }

  // ─── XENDIT WEBHOOK (callback dari Xendit) ────────────────
  // POST /api/v1/payments/webhook/xendit
  // - Publik (no auth) — Xendit panggil dari server mereka
  // - Verifikasi via header `x-callback-token`
  // - Idempotent — Xendit retry sampai dapat 200
  //
  // PENTING: rate limit di-skip supaya retry Xendit tidak ke-throttle.
  @Post('webhook/xendit')
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async xenditWebhook(@Req() req: Request, @Body() payload: any) {
    const token = req.header('x-callback-token');
    if (!this.xenditService.verifyCallbackToken(token)) {
      this.logger.warn(
        `Webhook ditolak: token mismatch (received=${token?.slice(0, 6)}...)`,
      );
      throw new ForbiddenException('Invalid callback token');
    }

    // Xendit kirim 2 jenis webhook ke URL yang sama:
    // (a) Invoice paid/expired — bedanya ada field `external_id` & `payer_email`
    // (b) Disbursement (kalau di-config di dashboard) — punya `is_instant`
    //
    // Untuk MVP, kita handle invoice di sini. Disbursement webhook diarahkan
    // ke URL terpisah (lihat WithdrawalsController) atau bisa diteruskan
    // dari sini.
    if (payload && typeof payload === 'object' && 'external_id' in payload) {
      return this.paymentsService.handleXenditInvoiceWebhook(payload);
    }

    // Unknown payload — log & return 200 supaya Xendit tidak retry.
    this.logger.warn(
      `Webhook payload tidak dikenali: ${JSON.stringify(payload).slice(0, 200)}`,
    );
    return { success: true, message: 'Unknown payload type, ignored' };
  }

  // ─── SYNC PAYMENT STATUS (fallback jika webhook miss) ─────
  // GET /api/v1/payments/:id/sync
  // FE bisa panggil ini setelah user balik dari Xendit redirect, supaya
  // status di FE langsung update tanpa nunggu webhook.
  @Get(':id/sync')
  @UseGuards(JwtAuthGuard)
  async syncPayment(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.paymentsService.syncPaymentWithXendit(id, user.id);
  }

  // ─── MANUAL ESCROW (ADMIN OVERRIDE saja) ──────────────────
  // POST /api/v1/payments/escrow
  // SECURITY: dulu @Roles('bisnis') — bisnis mana pun bisa menandai escrow
  // 'held' TANPA pembayaran nyata (phantom money) → dicairkan ke wallet
  // student. Sekarang dikunci ke admin. Flow pembayaran normal = createInvoice.
  @Post('escrow')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async holdEscrow(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.paymentsService.holdEscrow(dto, user.id);
  }

  // ─── RELEASE ESCROW ───────────────────────────────────────
  // PATCH /api/v1/payments/escrow/:id/release
  @Patch('escrow/:id/release')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('bisnis')
  async releaseEscrow(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.paymentsService.releaseEscrow(id, user.id);
  }

  // ─── QUERIES ──────────────────────────────────────────────
  // GET /api/v1/payments/my
  @Get('my')
  @UseGuards(JwtAuthGuard)
  async getMyPayments(@CurrentUser() user: JwtUser) {
    return this.paymentsService.getMyPayments(user.id);
  }

  // GET /api/v1/payments/contract/:contractId
  @Get('contract/:contractId')
  @UseGuards(JwtAuthGuard)
  async getByContract(
    @Param('contractId') contractId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.paymentsService.getPaymentByContract(contractId, user.id);
  }
}
