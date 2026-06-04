import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { XenditService } from '../xendit/xendit.service';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { ProcessWithdrawalDto } from './dto/process-withdrawal.dto';

/**
 * WithdrawalsService — mahasiswa cair dari saldo wallet ke rekening.
 *
 * Flow:
 *   1. Mahasiswa POST /withdrawals dengan bank_account_id + amount
 *      → record withdrawal status='pending'
 *      → wallet.amount turun, wallet.pending_amount naik (lock dana)
 *   2. Admin lihat list di dashboard
 *   3a. Admin approve manual: status='completed', wallet.pending_amount turun
 *       (admin transfer via mobile banking sendiri)
 *   3b. Admin approve dengan Xendit: call Disbursement API, status='processing',
 *       tunggu webhook untuk update 'completed' / 'failed'
 *   3c. Admin reject: status='rejected', refund pending_amount ke amount
 */
@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);
  private readonly adminFee: number;
  private readonly minAmount: number;

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private paymentsService: PaymentsService,
    private xendit: XenditService,
  ) {
    this.adminFee = Number(process.env.WITHDRAWAL_ADMIN_FEE ?? 2500);
    this.minAmount = Number(process.env.WITHDRAWAL_MIN_AMOUNT ?? 50_000);
  }

  // ─── USER FLOWS ────────────────────────────────────────────

  async create(userId: string, dto: CreateWithdrawalDto) {
    if (dto.amount < this.minAmount) {
      throw new BadRequestException(
        `Minimal penarikan Rp ${this.minAmount.toLocaleString('id-ID')}`,
      );
    }

    if (dto.amount <= this.adminFee) {
      throw new BadRequestException(
        `Nominal harus lebih besar dari biaya admin Rp ${this.adminFee.toLocaleString('id-ID')}`,
      );
    }

    // Validate bank account
    const bankAccount = await this.prisma.bank_accounts.findUnique({
      where: { id: dto.bank_account_id },
    });
    if (!bankAccount) {
      throw new NotFoundException('Rekening tidak ditemukan');
    }
    if (bankAccount.user_id !== userId) {
      throw new ForbiddenException('Bukan rekening kamu');
    }

    // Check saldo cukup
    const wallet = await this.prisma.wallets.findUnique({
      where: { user_id: userId },
    });
    if (!wallet) {
      throw new BadRequestException(
        'Saldo belum tersedia. Selesaikan kontrak dulu untuk mengisi saldo.',
      );
    }

    const balance = Number(wallet.amount);
    if (balance < dto.amount) {
      throw new BadRequestException(
        `Saldo tidak cukup. Tersedia: Rp ${balance.toLocaleString('id-ID')}`,
      );
    }

    const amountNet = dto.amount - this.adminFee;

    // Lock saldo via $transaction
    const withdrawal = await this.prisma.$transaction(async (tx) => {
      // Lock saldo ATOMIK: kurangi hanya bila saldo masih cukup pada saat
      // UPDATE dijalankan. Cek `Number(wallet.amount) < dto.amount` di atas
      // bisa balapan (TOCTOU) — dua permintaan konkuren sama-sama lolos lalu
      // membuat saldo negatif. `WHERE amount >= X` menutup celah itu.
      const locked = await tx.wallets.updateMany({
        where: { id: wallet.id, amount: { gte: dto.amount } },
        data: {
          amount: { decrement: dto.amount },
          pending_amount: { increment: dto.amount },
          updated_at: new Date(),
        },
      });
      if (locked.count === 0) {
        throw new BadRequestException(
          'Saldo tidak cukup atau berubah. Muat ulang halaman lalu coba lagi.',
        );
      }

      const wd = await tx.withdrawals.create({
        data: {
          user_id: userId,
          bank_account_id: dto.bank_account_id,
          amount_gross: dto.amount,
          admin_fee: this.adminFee,
          amount_net: amountNet,
          status: 'pending',
        },
      });

      await tx.wallet_transactions.create({
        data: {
          wallet_id: wallet.id,
          user_id: userId,
          type: 'withdrawal_lock',
          amount: BigInt(dto.amount),
          ref_type: 'withdrawal',
          ref_id: wd.id,
          description: `Penarikan ke ${bankAccount.bank_name} •••${bankAccount.account_number.slice(-4)}`,
        },
      });

      return wd;
    });

    void this.notificationsService.create({
      user_id: userId,
      type: 'withdrawal' as any,
      title: '🕐 Penarikan Diminta',
      body: `Rp ${amountNet.toLocaleString('id-ID')} akan dikirim ke ${bankAccount.bank_name} setelah di-approve admin (estimasi 1-2 hari kerja).`,
      ref_id: withdrawal.id,
      action_url: `/wallet`,
    });

    return {
      data: { ...withdrawal, bank_account: bankAccount },
      message: 'Permintaan penarikan dikirim. Menunggu persetujuan admin.',
    };
  }

  async findByUser(userId: string) {
    const items = await this.prisma.withdrawals.findMany({
      where: { user_id: userId },
      include: { bank_account: true },
      orderBy: { requested_at: 'desc' },
    });
    return { data: items, message: 'Berhasil' };
  }

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallets.upsert({
      where: { user_id: userId },
      update: {},
      create: { user_id: userId },
    });

    const recentTx = await this.prisma.wallet_transactions.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    // BigInt → number untuk JSON serialization (di response interceptor)
    return {
      data: {
        amount: Number(wallet.amount),
        pending_amount: Number(wallet.pending_amount),
        total_earned: Number(wallet.total_earned),
        total_withdrawn: Number(wallet.total_withdrawn),
        recent_transactions: recentTx.map((t) => ({
          ...t,
          amount: Number(t.amount),
        })),
      },
      message: 'Berhasil',
    };
  }

  // ─── ADMIN FLOWS ───────────────────────────────────────────

  async listAll(status?: string, page = 1, limit = 20) {
    const where: any = status ? { status } : {};
    const [items, total] = await Promise.all([
      this.prisma.withdrawals.findMany({
        where,
        include: {
          bank_account: true,
          users: { select: { id: true, full_name: true, email: true } },
        },
        orderBy: { requested_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.withdrawals.count({ where }),
    ]);
    return {
      data: {
        items,
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
      },
      message: 'Berhasil',
    };
  }

  async process(id: string, adminId: string, dto: ProcessWithdrawalDto) {
    const wd = await this.prisma.withdrawals.findUnique({
      where: { id },
      include: { bank_account: true },
    });
    if (!wd) throw new NotFoundException('Withdrawal tidak ditemukan');

    if (wd.status !== 'pending') {
      throw new BadRequestException(
        `Withdrawal ini sudah dalam status ${wd.status}, tidak bisa diproses ulang`,
      );
    }

    if (dto.action === 'reject') {
      return this._reject(wd, adminId, dto.reason || 'Ditolak admin');
    }

    if (dto.action === 'approve') {
      return dto.use_xendit
        ? this._approveViaXendit(wd, adminId)
        : this._approveManual(wd, adminId);
    }

    throw new BadRequestException('action harus "approve" atau "reject"');
  }

  private async _reject(wd: any, adminId: string, reason: string) {
    const wallet = await this.prisma.wallets.findUnique({
      where: { user_id: wd.user_id },
    });
    if (!wallet) {
      throw new BadRequestException('Wallet user tidak ditemukan');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.withdrawals.update({
        where: { id: wd.id },
        data: {
          status: 'rejected',
          rejection_reason: reason,
          processed_by: adminId,
          processed_at: new Date(),
        },
      });

      // Refund: pending_amount → amount
      await tx.wallets.update({
        where: { id: wallet.id },
        data: {
          pending_amount: { decrement: wd.amount_gross },
          amount: { increment: wd.amount_gross },
          updated_at: new Date(),
        },
      });

      await tx.wallet_transactions.create({
        data: {
          wallet_id: wallet.id,
          user_id: wd.user_id,
          type: 'withdrawal_refund',
          amount: BigInt(wd.amount_gross),
          ref_type: 'withdrawal',
          ref_id: wd.id,
          description: `Penarikan ditolak: ${reason}`,
        },
      });
    });

    void this.notificationsService.create({
      user_id: wd.user_id,
      type: 'withdrawal' as any,
      title: '❌ Penarikan Ditolak',
      body: `Permintaan penarikan Rp ${wd.amount_gross.toLocaleString('id-ID')} ditolak: ${reason}. Saldo dikembalikan.`,
      ref_id: wd.id,
      action_url: `/wallet`,
    });

    return { data: { id: wd.id, status: 'rejected' }, message: 'Penarikan ditolak' };
  }

  private async _approveManual(wd: any, adminId: string) {
    const wallet = await this.prisma.wallets.findUnique({
      where: { user_id: wd.user_id },
    });
    if (!wallet) throw new BadRequestException('Wallet user tidak ditemukan');

    await this.prisma.$transaction(async (tx) => {
      await tx.withdrawals.update({
        where: { id: wd.id },
        data: {
          status: 'completed',
          processed_by: adminId,
          processed_at: new Date(),
        },
      });

      // pending_amount keluar, total_withdrawn naik
      await tx.wallets.update({
        where: { id: wallet.id },
        data: {
          pending_amount: { decrement: wd.amount_gross },
          total_withdrawn: { increment: wd.amount_gross },
          updated_at: new Date(),
        },
      });

      await tx.wallet_transactions.create({
        data: {
          wallet_id: wallet.id,
          user_id: wd.user_id,
          type: 'withdrawal_done',
          amount: BigInt(wd.amount_gross),
          ref_type: 'withdrawal',
          ref_id: wd.id,
          description: `Penarikan dicairkan manual ke ${wd.bank_account.bank_name}`,
        },
      });
    });

    void this.notificationsService.create({
      user_id: wd.user_id,
      type: 'withdrawal' as any,
      title: '✅ Dana Sudah Cair',
      body: `Rp ${wd.amount_net.toLocaleString('id-ID')} sudah dikirim ke ${wd.bank_account.bank_name} •••${wd.bank_account.account_number.slice(-4)}. Cek mutasi rekening kamu.`,
      ref_id: wd.id,
      action_url: `/wallet`,
    });

    return {
      data: { id: wd.id, status: 'completed' },
      message: 'Penarikan ditandai cair (manual)',
    };
  }

  private async _approveViaXendit(wd: any, adminId: string) {
    if (!this.xendit.isConfigured()) {
      throw new BadRequestException(
        'Xendit belum dikonfigurasi. Gunakan manual mode atau set XENDIT_SECRET_KEY.',
      );
    }

    const externalId = `stairslife-wd-${wd.id}`;
    let disbursement;
    try {
      disbursement = await this.xendit.createDisbursement({
        externalId,
        bankCode: wd.bank_account.bank_code,
        accountHolderName: wd.bank_account.account_holder,
        accountNumber: wd.bank_account.account_number,
        description: `Penarikan StairsLife - ${wd.id.slice(0, 8)}`,
        amount: wd.amount_net,
      });
    } catch (e) {
      this.logger.error(
        `Xendit disbursement gagal untuk withdrawal ${wd.id}: ${(e as Error).message}`,
      );
      throw e;
    }

    await this.prisma.withdrawals.update({
      where: { id: wd.id },
      data: {
        status: 'processing',
        processed_by: adminId,
        processed_at: new Date(),
        xendit_disbursement_id: disbursement.id,
        xendit_payload: disbursement as any,
      },
    });

    void this.notificationsService.create({
      user_id: wd.user_id,
      type: 'withdrawal' as any,
      title: '🚚 Penarikan Diproses',
      body: `Penarikan Rp ${wd.amount_net.toLocaleString('id-ID')} sedang dicairkan via Xendit. Akan masuk ke rekening dalam beberapa menit hingga 1 jam kerja.`,
      ref_id: wd.id,
      action_url: `/wallet`,
    });

    return {
      data: { id: wd.id, status: 'processing', disbursement_id: disbursement.id },
      message: 'Disbursement Xendit dikirim. Menunggu konfirmasi.',
    };
  }

  /**
   * Handle webhook disbursement dari Xendit.
   * Status mungkin COMPLETED atau FAILED.
   */
  async handleDisbursementWebhook(payload: {
    id: string;
    external_id: string;
    status: 'COMPLETED' | 'FAILED';
    failure_code?: string;
    amount: number;
  }) {
    const wd = await this.prisma.withdrawals.findFirst({
      where: { xendit_disbursement_id: payload.id },
      include: { bank_account: true },
    });
    if (!wd) {
      this.logger.warn(
        `Disbursement webhook ${payload.id} tapi withdrawal tidak ditemukan`,
      );
      return { success: true, message: 'Withdrawal not found, ignored' };
    }

    if (wd.status === 'completed' || wd.status === 'failed') {
      return { success: true, message: 'Already processed' };
    }

    const wallet = await this.prisma.wallets.findUnique({
      where: { user_id: wd.user_id },
    });
    if (!wallet) {
      this.logger.error(
        `Wallet user ${wd.user_id} hilang saat process disbursement webhook`,
      );
      return { success: true, message: 'Wallet missing' };
    }

    if (payload.status === 'COMPLETED') {
      await this.prisma.$transaction(async (tx) => {
        await tx.withdrawals.update({
          where: { id: wd.id },
          data: {
            status: 'completed',
            xendit_payload: payload as any,
          },
        });

        await tx.wallets.update({
          where: { id: wallet.id },
          data: {
            pending_amount: { decrement: wd.amount_gross },
            total_withdrawn: { increment: wd.amount_gross },
            updated_at: new Date(),
          },
        });

        await tx.wallet_transactions.create({
          data: {
            wallet_id: wallet.id,
            user_id: wd.user_id,
            type: 'withdrawal_done',
            amount: BigInt(wd.amount_gross),
            ref_type: 'withdrawal',
            ref_id: wd.id,
            description: `Penarikan dicairkan via Xendit ke ${wd.bank_account.bank_name}`,
          },
        });
      });

      void this.notificationsService.create({
        user_id: wd.user_id,
        type: 'withdrawal' as any,
        title: '✅ Dana Sudah Cair',
        body: `Rp ${wd.amount_net.toLocaleString('id-ID')} sudah masuk ke ${wd.bank_account.bank_name} •••${wd.bank_account.account_number.slice(-4)}.`,
        ref_id: wd.id,
        action_url: `/wallet`,
      });
    } else {
      // FAILED — refund saldo
      await this.prisma.$transaction(async (tx) => {
        await tx.withdrawals.update({
          where: { id: wd.id },
          data: {
            status: 'failed',
            rejection_reason: `Disbursement gagal: ${payload.failure_code || 'unknown'}`,
            xendit_payload: payload as any,
          },
        });

        await tx.wallets.update({
          where: { id: wallet.id },
          data: {
            pending_amount: { decrement: wd.amount_gross },
            amount: { increment: wd.amount_gross },
            updated_at: new Date(),
          },
        });

        await tx.wallet_transactions.create({
          data: {
            wallet_id: wallet.id,
            user_id: wd.user_id,
            type: 'withdrawal_refund',
            amount: BigInt(wd.amount_gross),
            ref_type: 'withdrawal',
            ref_id: wd.id,
            description: `Disbursement gagal: ${payload.failure_code || 'unknown'}`,
          },
        });
      });

      void this.notificationsService.create({
        user_id: wd.user_id,
        type: 'withdrawal' as any,
        title: '⚠️ Penarikan Gagal',
        body: `Penarikan Rp ${wd.amount_gross.toLocaleString('id-ID')} gagal cair. Saldo dikembalikan. Silakan cek rekening atau coba lagi.`,
        ref_id: wd.id,
        action_url: `/wallet`,
      });
    }

    return { success: true, message: 'OK' };
  }
}
